-- Student messaging goes live to students (Years 7–12).
--
-- Until now student-audience channels (a student's thread with CUBE, one
-- channel per high school class) were visible to directors only. This opens
-- them to their student members, and closes the gaps that mattered once a
-- student session can write to the chat tables:
--
--   • Reading: a student lists the student channels they belong to and the
--     members of those channels (chat_channels_read, chat_members_read).
--     Names come from chat_member_names(): to staff, full names; to a student,
--     first names, and every director reads as CUBE.
--   • A student can't leave a class channel — membership follows enrolment.
--   • What a student sends is bounded (chat_students_persona, the BEFORE
--     INSERT trigger every message passes through): their display name is
--     their student record, never the client's text; they never speak as
--     CUBE; 4000 characters; 20 messages a minute; attachments only from
--     CUBE's own storage, so a marker can't embed an outside image.
--   • A student opens their own thread with CUBE (chat_open_my_thread).
--   • A director takes a message down with chat_hide_message — it is marked
--     deleted and its text kept in chat_message_history like any other.
--   • Posting into an archived channel is refused (chat_can_post already).
--   • Attachments: the chat-uploads bucket, where a member of a channel may
--     upload under that channel's folder; the old staff-only qbank-images
--     route stays readable for messages already sent.
--   • The student-chat functions are no longer callable by the anonymous role.
--   • The chat tables, functions and triggers join the schema snapshot, so
--     tests/access.db.test.mjs can sign in as a student and check all this.

-- ── Reading ──────────────────────────────────────────────────────────────────
drop policy if exists chat_channels_read on public.chat_channels;
create policy chat_channels_read on public.chat_channels for select to authenticated
  using (
    (audience = 'staff' and public.is_staff() and (kind = 'channel' or public.chat_is_member(id)))
    or (audience = 'students' and public.is_admin(auth.uid()))
    or (audience = 'students' and public.chat_is_member(id))
  );

drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members for select to authenticated
  using (public.chat_is_member(channel_id) or (public.is_staff() and public.chat_channel_open(channel_id)));

-- Nobody leaves the everyone channel or a student channel.
drop policy if exists chat_members_leave on public.chat_members;
create policy chat_members_leave on public.chat_members for delete to authenticated
  using (user_id = auth.uid() and not exists (
    select 1 from public.chat_channels c where c.id = channel_id and (c.is_default or c.audience = 'students')));

-- The people in the caller's conversations, named for the caller: staff see
-- full names; a student sees first names and every director as CUBE.
create or replace function public.chat_member_names()
returns table(user_id uuid, display_name text, role text)
language sql stable security definer set search_path = public as $$
  with mine as (
    select distinct m2.user_id
    from public.chat_members m join public.chat_members m2 on m2.channel_id = m.channel_id
    where m.user_id = auth.uid()
  ), me as (select exists (select 1 from public.chat_staff_ids() s where s = auth.uid()) as staff)
  select d.id, case when (select staff from me) then d.full_name else 'CUBE' end, 'director'
    from public.directors d join mine on mine.user_id = d.id
  union all
  select t.id, case when (select staff from me) then t.full_name else split_part(t.full_name, ' ', 1) end, 'tutor'
    from public.tutors t join mine on mine.user_id = t.id
  union all
  select s.id, case when (select staff from me) then s.full_name else split_part(s.full_name, ' ', 1) end, 'student'
    from public.students s join mine on mine.user_id = s.id
$$;
revoke all on function public.chat_member_names() from public, anon;
grant execute on function public.chat_member_names() to authenticated, service_role;

-- ── A student's own thread with CUBE ─────────────────────────────────────────
create or replace function public.chat_open_my_thread() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.students s where s.id = auth.uid() and s.status in ('active', 'trial')) then
    raise exception 'Students only';
  end if;
  if not public.is_high_school_student(auth.uid()) then
    raise exception 'Messaging is for high school students (Years 7–12)';
  end if;
  v_key := 'student:' || auth.uid()::text;
  select id into v_id from public.chat_channels where dm_key = v_key;
  if v_id is null then
    insert into public.chat_channels (kind, name, dm_key, created_by, audience)
      values ('dm', '', v_key, auth.uid(), 'students') returning id into v_id;
    insert into public.chat_members (channel_id, user_id) values (v_id, auth.uid());
  end if;
  insert into public.chat_members (channel_id, user_id) select v_id, d.id from public.directors d on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.chat_open_my_thread() from public, anon;
grant execute on function public.chat_open_my_thread() to authenticated, service_role;

-- ── What a student may send ──────────────────────────────────────────────────
create or replace function public.chat_students_persona() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_audience text; v_class integer; v_teacher uuid; v_sender uuid; v_name text; v_m text[];
begin
  v_sender := coalesce(new.sender_id, auth.uid());
  if v_sender is null then return new; end if;
  select audience, class_id into v_audience, v_class from public.chat_channels where id = new.channel_id;

  if not exists (select 1 from public.chat_staff_ids() s where s = v_sender) then
    -- A student. The name on the message is their record, never the
    -- client's text; they never speak as CUBE; what they send is bounded.
    select full_name into v_name from public.students where id = v_sender;
    new.sender_name := coalesce(nullif(trim(v_name), ''), 'Student');
    new.as_cube := false;
    if length(new.body) > 4000 then
      raise exception 'Messages are limited to 4000 characters';
    end if;
    if tg_table_name = 'chat_messages' and (
      select count(*) from public.chat_messages m
      where m.sender_id = v_sender and m.created_at > now() - interval '1 minute') >= 20 then
      raise exception 'Too many messages in a minute — wait a moment';
    end if;
    -- Pictures and files come only from CUBE's own storage, so a marker can't
    -- pull in an outside image.
    for v_m in select regexp_matches(new.body, '\[\[(?:img|file):([^\]|]+)', 'g') loop
      if v_m[1] !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/(chat-uploads|qbank-images)/' then
        raise exception 'Attachments must be uploaded through the chat';
      end if;
    end loop;
    return new;
  end if;

  -- Staff. A director in student chat speaks as CUBE, except in a class
  -- channel for a class they teach.
  if not exists (select 1 from public.directors d where d.id = v_sender) then return new; end if;
  if v_audience is distinct from 'students' then return new; end if;
  if v_class is not null then
    select public.resolve_tutor_by_first_name(c.teacher) into v_teacher from public.classes c where c.id = v_class;
    if v_teacher = v_sender then
      new.as_cube := false;
      return new;
    end if;
  end if;
  new.as_cube := true;
  new.sender_name := 'CUBE';
  return new;
end $$;

-- ── A director takes a message down ──────────────────────────────────────────
create or replace function public.chat_hide_message(p_message uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'directors only'; end if;
  -- Blanking the body is what makes chat_messages_keep_record file the
  -- original text, as a sender's own delete does.
  update public.chat_messages m set deleted_at = now(), body = ''
    from public.chat_channels c
   where m.id = p_message and c.id = m.channel_id and c.audience = 'students' and m.deleted_at is null;
end $$;
revoke all on function public.chat_hide_message(uuid) from public, anon;
grant execute on function public.chat_hide_message(uuid) to authenticated, service_role;

-- ── The anonymous role has no business here ──────────────────────────────────
revoke execute on function public.chat_open_student_dm(uuid) from anon;
revoke execute on function public.chat_class_channel(integer) from anon;
revoke execute on function public.chat_set_student_replies(uuid, boolean) from anon;
revoke execute on function public.chat_report_message(uuid, text) from anon;
revoke execute on function public.chat_resolve_report(uuid) from anon;
revoke execute on function public.chat_can_post(uuid) from anon;
revoke execute on function public.chat_channel_open(uuid) from anon;
revoke execute on function public.chat_is_member(uuid) from anon;
revoke execute on function public.chat_is_director() from anon;
revoke execute on function public.chat_current_term() from anon;
revoke execute on function public.chat_today() from anon;

-- ── Attachments ──────────────────────────────────────────────────────────────
-- chat-uploads/<channel id>/<random name>: anyone who may post in the channel
-- may upload under its folder; the bucket is public (unguessable paths) so a
-- marker's URL renders without signing, as the staff chat's images do.
insert into storage.buckets (id, name, public, file_size_limit)
  values ('chat-uploads', 'chat-uploads', true, 20971520)
  on conflict (id) do update set public = true, file_size_limit = 20971520;
drop policy if exists chat_uploads_read on storage.objects;
create policy chat_uploads_read on storage.objects for select
  using (bucket_id = 'chat-uploads');
drop policy if exists chat_uploads_insert on storage.objects;
create policy chat_uploads_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-uploads'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.chat_can_post(((storage.foldername(name))[1])::uuid)
  );
drop policy if exists chat_uploads_staff_delete on storage.objects;
create policy chat_uploads_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-uploads' and public.is_staff());

-- ── Into the schema snapshot (tests/db/schema.sql) ───────────────────────────
insert into public.test_snapshot_objects (kind, name, ord)
select v.kind, v.name, coalesce((select max(ord) from public.test_snapshot_objects o where o.kind = v.kind), 0) + v.n
  from (values
    ('table', 'chat_channels', 1), ('table', 'chat_members', 2), ('table', 'chat_messages', 3), ('table', 'chat_reads', 4),
    ('table', 'chat_reactions', 5), ('table', 'chat_scheduled_messages', 6), ('table', 'chat_reports', 7), ('table', 'chat_message_history', 8),
    ('function', 'chat_staff_ids', 1), ('function', 'chat_is_member', 2), ('function', 'chat_channel_open', 3), ('function', 'chat_is_director', 4),
    ('function', 'is_high_school_student', 5), ('function', 'chat_can_post', 6), ('function', 'chat_can_manage', 7),
    ('function', 'chat_today', 8), ('function', 'chat_current_term', 9),
    ('function', 'chat_open_student_dm', 10), ('function', 'chat_open_my_thread', 11), ('function', 'chat_class_members_sync', 12),
    ('function', 'chat_class_channel', 13), ('function', 'chat_member_names', 14), ('function', 'chat_students_persona', 15),
    ('function', 'chat_messages_keep_record', 16), ('function', 'chat_report_message', 17), ('function', 'chat_resolve_report', 18),
    ('function', 'chat_set_student_replies', 19), ('function', 'chat_hide_message', 20), ('function', 'chat_unread_counts', 21),
    ('function', 'chat_create_channel', 22), ('function', 'chat_open_dm', 23),
    ('trigger', 'chat_messages_students_persona', 1), ('trigger', 'chat_scheduled_students_persona', 2), ('trigger', 'chat_messages_keep_record', 3)
  ) v(kind, name, n)
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = v.kind and o.name = v.name);

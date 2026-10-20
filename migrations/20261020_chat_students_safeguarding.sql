-- Student messaging: class channels that keep themselves in step, and the
-- safeguards to have in place before students can see any of it.
--
-- Membership (was: synced only when a director opened the channel)
--   • chat_class_members_sync(channel) — the class's Year 7–12 students
--     (active / trial enrolments), its teacher and the directors. Students who
--     left the class are removed; staff someone added by hand are kept.
--   • enrolments trigger — every enrolment change syncs its class's channel.
--   • classes trigger — a teacher change adds the new teacher and removes the
--     old one (unless a director).
--   • chat_roll_class_channels() — run each morning (api/reminders/daily):
--     every high school class of the current term (lib/terms getCurrentTerm:
--     the teaching term now, or the next one in the holidays) has a channel;
--     a channel whose class is from an earlier term moves onto that class's
--     copy in the current term (classes.source_class_id, the transition
--     wizard's link), keeping its history; one with no copy is archived once
--     the current term is running. One live channel per class, never two.
--
-- Safeguarding
--   • Class channels are announcement-only for students unless a director
--     turns replies on (chat_channels.student_replies). Staff post as before.
--     A student's thread with CUBE is always open to them.
--   • Archived channels are read-only for everyone.
--   • Nothing said in a student conversation is lost: an edit or a delete
--     keeps the earlier text in chat_message_history (directors only), and a
--     message's channel, sender and time can't be changed afterwards.
--   • A student channel can't be deleted (its history would go with it) —
--     the term roll archives it instead.
--   • Any member can report a message (chat_report_message); directors get a
--     push (api/chat/report) and resolve it in the thread.
-- Student-to-student and private teacher–student threads were already
-- impossible: chat_open_dm takes staff only, and a student's thread is with
-- CUBE (every director) via chat_open_student_dm, directors only.

alter table public.chat_channels
  add column if not exists student_replies boolean not null default false,
  add column if not exists archived_at timestamptz;

-- ── The current term, as the pages pick it ───────────────────────────────────
create or replace function public.chat_today() returns date
language sql stable as $$ select (now() at time zone 'Australia/Sydney')::date $$;

create or replace function public.chat_current_term() returns uuid
language sql stable security definer set search_path = public as $$
  with teaching as (select id, start_date, end_date from public.terms where coalesce(term_number, 0) <= 10)
  select coalesce(
    (select id from teaching where public.chat_today() between start_date and end_date order by start_date desc limit 1),
    (select id from teaching where start_date > public.chat_today() order by start_date limit 1))
$$;

-- ── Membership ───────────────────────────────────────────────────────────────
create or replace function public.chat_class_members_sync(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_class integer; v_teacher uuid;
begin
  select class_id into v_class from public.chat_channels where id = p_channel and audience = 'students';
  if v_class is null then return; end if;
  select public.resolve_tutor_by_first_name(c.teacher) into v_teacher from public.classes c where c.id = v_class;
  insert into public.chat_members (channel_id, user_id)
    select p_channel, e.student_id from public.enrolments e
    where e.class_id = v_class and e.status in ('active', 'trial') and e.ended_at is null
      and e.student_id is not null and public.is_high_school_student(e.student_id)
  on conflict do nothing;
  delete from public.chat_members m
    where m.channel_id = p_channel
      and not exists (select 1 from public.chat_staff_ids() s where s = m.user_id)
      and not exists (select 1 from public.enrolments e
        where e.class_id = v_class and e.student_id = m.user_id and e.status in ('active', 'trial')
          and e.ended_at is null and public.is_high_school_student(e.student_id));
  if v_teacher is not null then
    insert into public.chat_members (channel_id, user_id) values (p_channel, v_teacher) on conflict do nothing;
  end if;
  insert into public.chat_members (channel_id, user_id) select p_channel, d.id from public.directors d on conflict do nothing;
end $$;
revoke all on function public.chat_class_members_sync(uuid) from public, anon, authenticated;

-- Directors opening a class's channel by hand: same sync (now removals too).
create or replace function public.chat_class_channel(p_class integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_year integer;
begin
  if not public.is_admin(auth.uid()) then raise exception 'directors only'; end if;
  select c.class_name, public.course_year(co.course_code, c.class_name) into v_name, v_year
    from public.classes c left join public.courses co on co.id = c.course_id where c.id = p_class;
  if v_name is null then raise exception 'no such class'; end if;
  if v_year is null or v_year < 7 then
    raise exception 'Class channels are for high school classes (Years 7–12) only';
  end if;
  select id into v_id from public.chat_channels where class_id = p_class;
  if v_id is null then
    insert into public.chat_channels (kind, name, created_by, audience, class_id)
      values ('channel', v_name, auth.uid(), 'students', p_class) returning id into v_id;
  end if;
  update public.chat_channels set archived_at = null where id = v_id and archived_at is not null;
  perform public.chat_class_members_sync(v_id);
  return v_id;
end $$;

create or replace function public.chat_enrolment_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ch uuid;
begin
  -- Never block an enrolment over the chat.
  begin
    for v_ch in
      select id from public.chat_channels
      where audience = 'students' and class_id is not null
        and class_id in (case when tg_op <> 'INSERT' then old.class_id end, case when tg_op <> 'DELETE' then new.class_id end)
    loop
      perform public.chat_class_members_sync(v_ch);
    end loop;
  exception when others then
    raise warning 'chat_enrolment_sync: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists enrolments_chat_sync on public.enrolments;
create trigger enrolments_chat_sync after insert or update or delete on public.enrolments
  for each row execute function public.chat_enrolment_sync();

create or replace function public.chat_class_teacher_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ch uuid; v_old uuid; v_new uuid;
begin
  if new.teacher is not distinct from old.teacher then return null; end if;
  begin
    select id into v_ch from public.chat_channels where class_id = new.id and audience = 'students' limit 1;
    if v_ch is null then return null; end if;
    v_old := public.resolve_tutor_by_first_name(old.teacher);
    v_new := public.resolve_tutor_by_first_name(new.teacher);
    if v_old is not null and v_old is distinct from v_new
       and not exists (select 1 from public.directors d where d.id = v_old) then
      delete from public.chat_members where channel_id = v_ch and user_id = v_old;
    end if;
    perform public.chat_class_members_sync(v_ch);
  exception when others then
    raise warning 'chat_class_teacher_sync: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists classes_chat_teacher_sync on public.classes;
create trigger classes_chat_teacher_sync after update of teacher on public.classes
  for each row execute function public.chat_class_teacher_sync();

-- ── One live channel per current-term class ──────────────────────────────────
create or replace function public.chat_roll_class_channels() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_term uuid := public.chat_current_term();
  v_running boolean;
  r record; v_next integer; v_name text; v_ch uuid;
  n_created int := 0; n_rolled int := 0; n_archived int := 0; n_synced int := 0;
begin
  if v_term is null then return jsonb_build_object('term', null); end if;
  select public.chat_today() between start_date and end_date into v_running from public.terms where id = v_term;

  for r in
    select ch.id, ch.class_id, ch.archived_at, c.term_id, c.status
    from public.chat_channels ch join public.classes c on c.id = ch.class_id
    where ch.audience = 'students'
  loop
    if r.term_id = v_term then
      if coalesce(r.status, 'active') = 'active' then
        update public.chat_channels set archived_at = null where id = r.id and archived_at is not null;
        perform public.chat_class_members_sync(r.id);
        n_synced := n_synced + 1;
      elsif v_running and r.archived_at is null then
        update public.chat_channels set archived_at = now() where id = r.id;
        n_archived := n_archived + 1;
      end if;
      continue;
    end if;
    -- The class's copy in the current term (through any terms between).
    with recursive chain(id, term_id, depth) as (
      select c.id, c.term_id, 1 from public.classes c where c.source_class_id = r.class_id
      union all
      select c.id, c.term_id, chain.depth + 1 from public.classes c join chain on c.source_class_id = chain.id where chain.depth < 8
    )
    select chain.id into v_next from chain join public.classes c on c.id = chain.id
      where chain.term_id = v_term and coalesce(c.status, 'active') = 'active'
        and not exists (select 1 from public.chat_channels x where x.class_id = chain.id)
      order by chain.depth limit 1;
    if v_next is not null then
      select class_name into v_name from public.classes where id = v_next;
      update public.chat_channels set class_id = v_next, name = coalesce(v_name, name), archived_at = null where id = r.id;
      perform public.chat_class_members_sync(r.id);
      n_rolled := n_rolled + 1;
    elsif v_running and r.archived_at is null then
      update public.chat_channels set archived_at = now() where id = r.id;
      n_archived := n_archived + 1;
    end if;
    v_next := null;
  end loop;

  for r in
    select c.id, c.class_name from public.classes c left join public.courses co on co.id = c.course_id
    where c.term_id = v_term and coalesce(c.status, 'active') = 'active'
      and coalesce(public.course_year(co.course_code, c.class_name), 0) >= 7
      and not exists (select 1 from public.chat_channels x where x.class_id = c.id)
  loop
    insert into public.chat_channels (kind, name, audience, class_id)
      values ('channel', r.class_name, 'students', r.id) returning id into v_ch;
    perform public.chat_class_members_sync(v_ch);
    n_created := n_created + 1;
  end loop;

  return jsonb_build_object('term', v_term, 'created', n_created, 'rolled', n_rolled, 'archived', n_archived, 'synced', n_synced);
end $$;
revoke all on function public.chat_roll_class_channels() from public, anon, authenticated;
grant execute on function public.chat_roll_class_channels() to service_role;

-- ── Who may post ─────────────────────────────────────────────────────────────
create or replace function public.chat_can_post(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.chat_is_member(p_channel) and not exists (
    select 1 from public.chat_channels c
    where c.id = p_channel and (
      c.archived_at is not null
      or (c.directors_only and not exists (select 1 from public.directors d where d.id = auth.uid()))
      or (c.audience = 'students' and c.kind = 'channel' and not c.student_replies
          and not exists (select 1 from public.chat_staff_ids() s where s = auth.uid()))))
$$;

create or replace function public.chat_set_student_replies(p_channel uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'Only a director can change who may reply'; end if;
  update public.chat_channels set student_replies = p_on where id = p_channel and audience = 'students' and kind = 'channel';
end $$;

-- ── Nothing in a student conversation is lost ────────────────────────────────
create table if not exists public.chat_message_history (
  id          bigserial primary key,
  message_id  uuid not null references public.chat_messages(id) on delete cascade,
  channel_id  uuid not null,
  body        text not null,
  action      text not null check (action in ('edited', 'deleted')),
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index if not exists chat_message_history_msg_idx on public.chat_message_history(message_id);
alter table public.chat_message_history enable row level security;
drop policy if exists chat_message_history_directors on public.chat_message_history;
create policy chat_message_history_directors on public.chat_message_history for select to authenticated
  using (public.is_admin(auth.uid()));

create or replace function public.chat_messages_keep_record() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Who said it, where and when is fixed once sent.
  new.channel_id := old.channel_id; new.sender_id := old.sender_id;
  new.created_at := old.created_at; new.as_cube := old.as_cube; new.sender_name := old.sender_name;
  -- A deleted message stays deleted.
  if old.deleted_at is not null then new.deleted_at := old.deleted_at; new.body := old.body; return new; end if;
  if new.body is distinct from old.body and coalesce(old.body, '') <> ''
     and exists (select 1 from public.chat_channels c where c.id = old.channel_id and c.audience = 'students') then
    insert into public.chat_message_history (message_id, channel_id, body, action, changed_by)
      values (old.id, old.channel_id, old.body, case when new.deleted_at is not null then 'deleted' else 'edited' end, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists chat_messages_keep_record on public.chat_messages;
create trigger chat_messages_keep_record before update on public.chat_messages
  for each row execute function public.chat_messages_keep_record();

-- ── Reports ──────────────────────────────────────────────────────────────────
create table if not exists public.chat_reports (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.chat_messages(id) on delete cascade,
  channel_id    uuid not null references public.chat_channels(id) on delete cascade,
  reported_by   uuid not null,
  reason        text,
  body_snapshot text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid,
  unique (message_id, reported_by)
);
create index if not exists chat_reports_open_idx on public.chat_reports(channel_id) where resolved_at is null;
alter table public.chat_reports enable row level security;
drop policy if exists chat_reports_read on public.chat_reports;
create policy chat_reports_read on public.chat_reports for select to authenticated
  using (public.is_admin(auth.uid()) or reported_by = auth.uid());

create or replace function public.chat_report_message(p_message uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_channel uuid; v_body text; v_audience text; v_id uuid;
begin
  select m.channel_id, m.body, c.audience into v_channel, v_body, v_audience
    from public.chat_messages m join public.chat_channels c on c.id = m.channel_id where m.id = p_message;
  if v_channel is null or not public.chat_is_member(v_channel) then raise exception 'You can only report messages in your own conversations'; end if;
  if v_audience <> 'students' then raise exception 'Reporting is for student conversations'; end if;
  insert into public.chat_reports (message_id, channel_id, reported_by, reason, body_snapshot)
    values (p_message, v_channel, auth.uid(), nullif(left(trim(coalesce(p_reason, '')), 500), ''), v_body)
  on conflict (message_id, reported_by) do update set reason = excluded.reason, resolved_at = null, resolved_by = null, created_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.chat_resolve_report(p_report uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'directors only'; end if;
  update public.chat_reports set resolved_at = now(), resolved_by = auth.uid() where id = p_report and resolved_at is null;
end $$;

-- A student conversation is never deleted outright — archived instead.
create or replace function public.chat_delete_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_can_manage(p_channel) then raise exception 'Only the channel''s creator or a director can delete it'; end if;
  if exists (select 1 from public.chat_channels where id = p_channel and is_default) then raise exception 'The everyone channel cannot be deleted'; end if;
  if exists (select 1 from public.chat_channels where id = p_channel and audience = 'students') then
    raise exception 'Student channels are kept for the record — they archive themselves when the class ends';
  end if;
  delete from public.chat_channels where id = p_channel;
end $$;

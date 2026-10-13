-- Student messaging, inside the staff chat tables. A channel carries an
-- audience: 'staff' (every channel so far) or 'students'. Student threads are
-- a DM between a student and CUBE (every director, like a CUBE thread with a
-- teacher) and one channel per class holding its students and the directors.
--
-- Not published yet: only directors can see student-audience channels. When it
-- opens to students, chat_channels_read (and the student-side reads) widen.

alter table public.chat_channels
  add column if not exists audience text not null default 'staff' check (audience in ('staff', 'students')),
  add column if not exists class_id integer;
create index if not exists chat_channels_class_idx on public.chat_channels(class_id) where class_id is not null;

-- Listing: staff channels as before; student channels to directors only (for now).
drop policy if exists chat_channels_read on public.chat_channels;
create policy chat_channels_read on public.chat_channels for select to authenticated
  using (
    (audience = 'staff' and public.is_staff() and (kind = 'channel' or public.chat_is_member(id)))
    or (audience = 'students' and public.is_admin(auth.uid()))
  );

-- "Open" (joinable, members listed to all staff) means a STAFF channel only.
create or replace function public.chat_channel_open(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_channels c where c.id = p_channel and c.kind = 'channel' and c.audience = 'staff')
$$;

-- The thread between a student and CUBE: the student plus every director.
create or replace function public.chat_open_student_dm(p_student uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'directors only'; end if;
  if not exists (select 1 from public.students s where s.id = p_student) then raise exception 'not a student'; end if;
  v_key := 'student:' || p_student::text;
  select id into v_id from public.chat_channels where dm_key = v_key;
  if v_id is null then
    insert into public.chat_channels (kind, name, dm_key, created_by, audience) values ('dm', '', v_key, auth.uid(), 'students') returning id into v_id;
    insert into public.chat_members (channel_id, user_id) values (v_id, p_student);
  end if;
  insert into public.chat_members (channel_id, user_id) select v_id, d.id from public.directors d on conflict do nothing;
  return v_id;
end $$;

-- A class's channel: created on first use, named after the class, holding its
-- current students (active or on trial, not ended) and the directors. Calling
-- it again brings in students enrolled since.
create or replace function public.chat_class_channel(p_class integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  if not public.is_admin(auth.uid()) then raise exception 'directors only'; end if;
  select class_name into v_name from public.classes where id = p_class;
  if v_name is null then raise exception 'no such class'; end if;
  select id into v_id from public.chat_channels where class_id = p_class;
  if v_id is null then
    insert into public.chat_channels (kind, name, created_by, audience, class_id)
      values ('channel', v_name, auth.uid(), 'students', p_class) returning id into v_id;
  end if;
  insert into public.chat_members (channel_id, user_id)
    select v_id, e.student_id from public.enrolments e
    where e.class_id = p_class and e.status in ('active', 'trial') and e.ended_at is null and e.student_id is not null
  on conflict do nothing;
  insert into public.chat_members (channel_id, user_id) select v_id, d.id from public.directors d on conflict do nothing;
  return v_id;
end $$;

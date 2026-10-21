-- Soft launch: a class channel is opened to its students by a director.
--
-- chat_channels.student_visible: while false, a class channel's students
-- can't see it (nor its messages, members or unread count) — the teacher and
-- the directors still can. A student's thread with CUBE is always visible to
-- them. Every class channel that existed when this went in starts hidden, so
-- the directors open them one at a time; new ones (next term's roll) start
-- open, as by then the platform is launched.
--
-- Enforced in chat_is_member, which every chat policy and function goes
-- through, so a hidden channel is invisible by every route.
alter table public.chat_channels add column if not exists student_visible boolean not null default true;
update public.chat_channels set student_visible = false where audience = 'students' and kind = 'channel';

create or replace function public.chat_is_member(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_members m join public.chat_channels c on c.id = m.channel_id
    where m.channel_id = p_channel and m.user_id = auth.uid()
      and (c.audience <> 'students' or c.student_visible
           or exists (select 1 from public.chat_staff_ids() s where s = auth.uid())))
$$;

create or replace function public.chat_member_names()
returns table(user_id uuid, display_name text, role text)
language sql stable security definer set search_path = public as $$
  with me as (select exists (select 1 from public.chat_staff_ids() s where s = auth.uid()) as staff),
  mine as (
    select distinct m2.user_id
    from public.chat_members m
    join public.chat_channels c on c.id = m.channel_id
    join public.chat_members m2 on m2.channel_id = m.channel_id
    where m.user_id = auth.uid()
      and (c.audience <> 'students' or c.student_visible or (select staff from me))
  )
  select d.id, case when (select staff from me) then d.full_name else 'CUBE' end, 'director'
    from public.directors d join mine on mine.user_id = d.id
  union all
  select t.id, case when (select staff from me) then t.full_name else split_part(t.full_name, ' ', 1) end, 'tutor'
    from public.tutors t join mine on mine.user_id = t.id
  union all
  select s.id, case when (select staff from me) then s.full_name else split_part(s.full_name, ' ', 1) end, 'student'
    from public.students s join mine on mine.user_id = s.id
$$;

create or replace function public.chat_unread_counts()
returns table(channel_id uuid, n bigint)
language sql stable security definer set search_path = public as $$
  select m.channel_id, count(msg.id)
  from public.chat_members m
  join public.chat_channels c on c.id = m.channel_id
  left join public.chat_reads r on r.channel_id = m.channel_id and r.user_id = auth.uid()
  left join public.chat_messages msg on msg.channel_id = m.channel_id
    and msg.sender_id <> auth.uid() and msg.deleted_at is null
    and msg.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)
  where m.user_id = auth.uid()
    and (c.audience <> 'students' or c.student_visible or exists (select 1 from public.chat_staff_ids() s where s = auth.uid()))
  group by m.channel_id
$$;

create or replace function public.chat_set_student_visible(p_channel uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'Only a director can open a channel to students'; end if;
  update public.chat_channels set student_visible = p_on where id = p_channel and audience = 'students' and kind = 'channel';
end $$;
revoke all on function public.chat_set_student_visible(uuid, boolean) from public, anon;
grant execute on function public.chat_set_student_visible(uuid, boolean) to authenticated, service_role;

insert into public.test_snapshot_objects (kind, name, ord)
select 'function', 'chat_set_student_visible', (select max(ord) from public.test_snapshot_objects where kind = 'function') + 1
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = 'function' and o.name = 'chat_set_student_visible');

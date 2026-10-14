-- Class channels include the class's teacher.
--
-- A class channel held the class's (high school) students and the directors.
-- Its teacher now belongs too: chat_class_channel adds them (resolved from the
-- class's teacher name, as payroll does) whenever the channel is opened or
-- refreshed, and the existing channels get theirs now. A teacher can see the
-- class channels they are a member of (until now only directors could see any
-- student channel); reading and posting already follow membership.
-- If a class changes teacher, refreshing the channel adds the new one.

create or replace function public.chat_class_channel(p_class integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_year integer; v_teacher uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'directors only'; end if;
  select c.class_name, public.course_year(co.course_code, c.class_name), public.resolve_tutor_by_first_name(c.teacher)
    into v_name, v_year, v_teacher
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
  insert into public.chat_members (channel_id, user_id)
    select v_id, e.student_id from public.enrolments e
    where e.class_id = p_class and e.status in ('active', 'trial') and e.ended_at is null and e.student_id is not null
      and public.is_high_school_student(e.student_id)
  on conflict do nothing;
  if v_teacher is not null then
    insert into public.chat_members (channel_id, user_id) values (v_id, v_teacher) on conflict do nothing;
  end if;
  insert into public.chat_members (channel_id, user_id) select v_id, d.id from public.directors d on conflict do nothing;
  return v_id;
end $$;

-- The teachers of the class channels that already exist.
insert into public.chat_members (channel_id, user_id)
select ch.id, public.resolve_tutor_by_first_name(cl.teacher)
  from public.chat_channels ch join public.classes cl on cl.id = ch.class_id
 where ch.audience = 'students' and public.resolve_tutor_by_first_name(cl.teacher) is not null
on conflict do nothing;

-- Listing: staff channels as before; student channels to directors, and a
-- class channel to the staff in it (its teacher).
drop policy if exists chat_channels_read on public.chat_channels;
create policy chat_channels_read on public.chat_channels for select to authenticated
  using (
    (audience = 'staff' and public.is_staff() and (kind = 'channel' or public.chat_is_member(id)))
    or (audience = 'students' and public.is_admin(auth.uid()))
    or (audience = 'students' and class_id is not null and public.is_staff() and public.chat_is_member(id))
  );

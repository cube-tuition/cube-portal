-- Student messaging is for high school students only (Years 7–12).
--
-- The Students tab (20261014_chat_students_audience.sql) offered every active
-- student — including Years 5–6 — a thread with CUBE, and a class channel
-- took every student in the class. Primary students are now left out, here in
-- the database as well as on the page:
--   • chat_open_student_dm refuses a student not in Years 7–12;
--   • chat_class_channel refuses a primary class (its year from the course
--     code, else the class name — course_year), and only ever adds Year 7–12
--     students to a channel.
-- No primary student was in a thread or channel when this went in.

create or replace function public.is_high_school_student(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select s.year ~ '^\d{1,2}$' and s.year::int between 7 and 12
                     from public.students s where s.id = p_student), false)
$$;
revoke all on function public.is_high_school_student(uuid) from public, anon;
grant execute on function public.is_high_school_student(uuid) to authenticated, service_role;

-- The thread between a student and CUBE: the student plus every director.
create or replace function public.chat_open_student_dm(p_student uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'directors only'; end if;
  if not exists (select 1 from public.students s where s.id = p_student) then raise exception 'not a student'; end if;
  if not public.is_high_school_student(p_student) then
    raise exception 'Student messaging is for high school students (Years 7–12) only';
  end if;
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
-- current high school students (active or on trial, not ended) and the
-- directors. Calling it again brings in students enrolled since.
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
  insert into public.chat_members (channel_id, user_id)
    select v_id, e.student_id from public.enrolments e
    where e.class_id = p_class and e.status in ('active', 'trial') and e.ended_at is null and e.student_id is not null
      and public.is_high_school_student(e.student_id)
  on conflict do nothing;
  insert into public.chat_members (channel_id, user_id) select v_id, d.id from public.directors d on conflict do nothing;
  return v_id;
end $$;

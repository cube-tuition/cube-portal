-- Absence cases, phase 2.
--
-- notice_given: the family told us before the session (logged by hand from
-- the Absences page ahead of the date). Kept for a future credit policy that
-- may depend on notice; today credits stay at the director's discretion.
-- The tutor's roll pre-fills these students as absent, with a badge, without
-- writing attendance — an attendance row marks the session as saved.
--
-- 'email' notes: an email sent to the family from the case (makeup options,
-- makeup confirmation, or a custom message), logged by the send route.
--
-- The attendance trigger also notes when a student with an open case is
-- marked present on the day (e.g. the family said they'd be away, then came).
alter table public.absence_cases
  add column if not exists notice_given boolean not null default false;

alter table public.absence_case_notes drop constraint if exists absence_case_notes_kind_check;
alter table public.absence_case_notes
  add constraint absence_case_notes_kind_check check (kind in ('note','contact','stage','system','email'));

comment on column public.absence_cases.notice_given is
  'The family gave notice before the session (logged ahead from the Absences page).';

create or replace function public.absence_sync_attendance() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ml   record;
  cid  uuid;
  src  integer;
  mlid integer;
  changed boolean := tg_op = 'INSERT' or new.status is distinct from old.status;
begin
  select l.id, l.lesson_date, l.makeup_source_lesson_id into ml
  from public.lessons l
  where l.is_makeup and l.makeup_student_id = new.student_id
    and l.class_id = new.class_id and l.lesson_date = new.session_date
  order by l.id desc limit 1;
  if found then
    if new.status in ('present','late') and new.session_date <= public.absence_today() then
      for cid in
        update public.absence_cases c
           set stage = 'closed', outcome = 'makeup', makeup_lesson_id = ml.id,
               closed_at = now(), updated_at = now()
         where c.stage <> 'closed' and c.student_id = new.student_id
           and (c.makeup_lesson_id = ml.id or c.lesson_id = ml.makeup_source_lesson_id)
        returning c.id
      loop
        perform public.absence_note(cid, 'Makeup attended on ' || to_char(new.session_date, 'Dy DD Mon') || '.');
      end loop;
    elsif new.status = 'absent' and changed then
      for cid in
        update public.absence_cases c
           set stage = 'new', outcome = null, makeup_lesson_id = null,
               closed_at = null, updated_at = now()
         where c.student_id = new.student_id
           and (c.makeup_lesson_id = ml.id or c.lesson_id = ml.makeup_source_lesson_id)
           and coalesce(c.outcome, 'makeup') = 'makeup'
        returning c.id
      loop
        perform public.absence_note(cid, 'Missed the makeup on ' || to_char(new.session_date, 'Dy DD Mon') || ' — reopened.');
      end loop;
    end if;
    return new;
  end if;

  if not changed then return new; end if;

  if new.status = 'absent' then
    insert into public.absence_cases (student_id, class_id, session_date, lesson_id)
    values (new.student_id, new.class_id, new.session_date,
            public.absence_source_lesson(new.class_id, new.session_date))
    on conflict (student_id, class_id, session_date) do nothing;

  elsif tg_op = 'UPDATE' and old.status = 'absent' and new.status in ('present','late') then
    delete from public.absence_cases c
     where c.student_id = new.student_id and c.class_id = new.class_id
       and c.session_date = new.session_date
       and c.stage = 'new' and c.makeup_lesson_id is null and c.cancellation_id is null
       and not exists (select 1 from public.absence_case_notes n where n.case_id = c.id);
    if not found then
      select id into cid from public.absence_cases
       where student_id = new.student_id and class_id = new.class_id and session_date = new.session_date;
      if cid is not null then
        perform public.absence_note(cid, 'Attendance changed from absent to ' || new.status || '.');
      end if;
    end if;

  elsif new.status in ('present','late') then
    -- Present on a session someone had logged as an absence ahead of time.
    select id into cid from public.absence_cases
     where student_id = new.student_id and class_id = new.class_id
       and session_date = new.session_date and stage <> 'closed';
    if cid is not null then
      perform public.absence_note(cid, 'Marked ' || new.status || ' on the day — they came after all.');
    end if;

  elsif new.status = 'makeup' then
    src := public.absence_source_lesson(new.class_id, new.session_date);
    select id into mlid from public.lessons
     where is_makeup and makeup_student_id = new.student_id and makeup_source_lesson_id = src
     order by id desc limit 1;
    insert into public.absence_cases (student_id, class_id, session_date, lesson_id, stage, makeup_lesson_id)
    values (new.student_id, new.class_id, new.session_date, src, 'booked', mlid)
    on conflict (student_id, class_id, session_date) do update
      set stage = case when absence_cases.stage = 'closed' then 'closed' else 'booked' end,
          makeup_lesson_id = coalesce(excluded.makeup_lesson_id, absence_cases.makeup_lesson_id),
          updated_at = now();
  end if;
  return new;
end $$;

-- reconcile_absence_cases(): an absence logged before its session's lessons
-- row existed (next term's lessons not generated yet) picks up lesson_id once
-- it does — credits and makeups need it.
create or replace function public.reconcile_absence_cases() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n integer := 0;
begin
  if not public.is_staff() and auth.role() <> 'service_role' then return 0; end if;
  update public.absence_cases c
     set lesson_id = public.absence_source_lesson(c.class_id, c.session_date), updated_at = now()
   where c.lesson_id is null and public.absence_source_lesson(c.class_id, c.session_date) is not null;
  for r in
    select c.id, l.lesson_date, a.status
      from public.absence_cases c
      join public.lessons l on l.id = c.makeup_lesson_id
      join public.attendance a on a.student_id = c.student_id
                              and a.class_id = l.class_id and a.session_date = l.lesson_date
     where c.stage = 'booked' and l.lesson_date <= public.absence_today()
       and a.status in ('present','late','absent')
  loop
    if r.status = 'absent' then
      update public.absence_cases set stage = 'new', makeup_lesson_id = null, updated_at = now() where id = r.id;
      perform public.absence_note(r.id, 'Missed the makeup on ' || to_char(r.lesson_date, 'Dy DD Mon') || ' — reopened.');
    else
      update public.absence_cases set stage = 'closed', outcome = 'makeup', closed_at = now(), updated_at = now() where id = r.id;
      perform public.absence_note(r.id, 'Makeup attended on ' || to_char(r.lesson_date, 'Dy DD Mon') || '.');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

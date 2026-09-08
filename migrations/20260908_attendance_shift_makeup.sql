-- attendance_to_shift: two fixes.
--
-- 1. A 'makeup' attendance row means the student did NOT attend this session —
--    it's the marker left on the original lesson when a make-up is scheduled.
--    The trigger treated it like any other row and paid the tutor for a
--    session that never ran (a 1:1 moved to another day produced a shift on
--    both days). Such rows now create no shift; in a group class the other
--    students' rows still do.
-- 2. Start/end came from the CLASS row, so a make-up held at a different time
--    was paid at the class's regular hours. The matching lessons row (the
--    regular lesson first, else the make-up) now supplies the times, falling
--    back to the class. A draft shift picks up corrected times on re-save.

create or replace function public.create_shift_from_class_attendance()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_class        public.classes%rowtype;
  v_lesson       public.lessons%rowtype;
  v_tutor_id     uuid;
  v_start        time;
  v_end          time;
  v_hours        numeric(5,2);
  v_rate         numeric(10,2);
  v_source_key   text;
begin
  -- The student was moved to a make-up: this session didn't happen for them.
  if new.status = 'makeup' then return new; end if;

  select * into v_class from public.classes where id = new.class_id;
  if not found then return new; end if;

  select * into v_lesson
  from public.lessons
  where class_id = new.class_id and lesson_date = new.session_date
  order by coalesce(is_makeup, false), id
  limit 1;

  v_tutor_id := v_lesson.scheduled_teacher_id;
  if v_tutor_id is null then
    v_tutor_id := public.resolve_tutor_by_first_name(v_class.teacher);
  end if;
  if v_tutor_id is null then return new; end if;

  -- Pay tutors AND directors; skip anyone who is neither.
  if not exists (select 1 from public.tutors where id = v_tutor_id)
     and not exists (select 1 from public.directors where id = v_tutor_id) then
    return new;
  end if;

  v_start := coalesce(public.parse_class_time(v_lesson.start_time), public.parse_class_time(v_class.start_time));
  v_end   := coalesce(public.parse_class_time(v_lesson.end_time),   public.parse_class_time(v_class.end_time));
  if v_start is null or v_end is null then return new; end if;

  if v_end < v_start then v_end := v_end + interval '12 hours'; end if;

  v_hours := extract(epoch from (v_end - v_start)) / 3600.0;
  if v_hours <= 0 or v_hours > 12 then return new; end if;

  v_rate := public.resolve_matrix_rate(v_tutor_id, v_class.class_name, new.session_date);

  v_source_key := v_class.id::text || '_' || new.session_date::text;

  insert into public.shifts (
    tutor_id, work_date, start_time, end_time, hours, kind,
    source_table, source_id, rate_snapshot, notes, status, created_by
  )
  values (
    v_tutor_id, new.session_date, v_start, v_end, v_hours, 'class',
    'class_session', v_source_key, v_rate,
    'Auto: ' || coalesce(v_class.class_name, 'class #' || v_class.id::text),
    'draft', v_tutor_id
  )
  on conflict (source_table, source_id)
    where source_table is not null and source_id is not null
  do update set
    tutor_id      = excluded.tutor_id,
    start_time    = excluded.start_time,
    end_time      = excluded.end_time,
    hours         = excluded.hours,
    rate_snapshot = excluded.rate_snapshot,
    notes         = excluded.notes
  where shifts.status = 'draft';

  return new;
end;
$function$;

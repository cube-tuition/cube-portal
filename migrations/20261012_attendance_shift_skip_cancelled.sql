-- attendance_to_shift: a cancelled lesson pays nobody.
--
-- Cancelling a lesson (/api/cancel-lesson) leaves a 'cancelled' attendance row
-- for the student — often days ahead. The trigger turned that row into a draft
-- class shift for the teacher straight away, so:
--   • payroll showed a shift for a class nobody had marked yet (William's
--     Saturday Y5 English / Maths shifts appeared nine days early), and
--   • a 1:1 whose only student cancelled was paid for a lesson that never ran.
-- Policy (Ryan, Oct 2026): only lessons that run are paid. A 'cancelled' row
-- now creates no shift, like a 'makeup' row; in a group class the other
-- students' rows still create it when the teacher marks the roll.
--
-- The trigger also fires on a STATUS CHANGE now, not just on insert: a student
-- whose cancellation is overridden by being marked present (an update of the
-- existing row) must still produce the shift.

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
  -- The student was moved to a make-up, or the lesson was cancelled for them:
  -- this session didn't run on their account, so it creates no shift.
  if new.status in ('makeup', 'cancelled') then return new; end if;

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

drop trigger if exists attendance_to_shift on public.attendance;
create trigger attendance_to_shift
  after insert or update of status on public.attendance
  for each row execute function public.create_shift_from_class_attendance();

-- Directors teach (makeups, cover) and should be paid via shifts. The
-- pay_run_shifts view already resolves names from tutors ∪ directors, so we just
-- (1) stop the tutor-only FK from blocking director shifts, and (2) let the
-- attendance→shift trigger create shifts for directors as well as tutors.

-- 1. Drop the tutor-only FK on shifts.tutor_id.
alter table public.shifts drop constraint if exists shifts_tutor_id_fkey;

-- 2. Trigger: skip only when the resolved teacher is NEITHER a tutor NOR a director.
create or replace function public.create_shift_from_class_attendance()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  v_class        public.classes%rowtype;
  v_tutor_id     uuid;
  v_start        time;
  v_end          time;
  v_hours        numeric(5,2);
  v_rate         numeric(10,2);
  v_source_key   text;
begin
  select * into v_class from public.classes where id = new.class_id;
  if not found then return new; end if;

  select scheduled_teacher_id into v_tutor_id
  from public.lessons
  where class_id = new.class_id and lesson_date = new.session_date
  limit 1;

  if v_tutor_id is null then
    v_tutor_id := public.resolve_tutor_by_first_name(v_class.teacher);
  end if;

  if v_tutor_id is null then return new; end if;

  -- Pay tutors AND directors; skip anyone who is neither.
  if not exists (select 1 from public.tutors where id = v_tutor_id)
     and not exists (select 1 from public.directors where id = v_tutor_id) then
    return new;
  end if;

  v_start := public.parse_class_time(v_class.start_time);
  v_end   := public.parse_class_time(v_class.end_time);
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
    rate_snapshot = excluded.rate_snapshot,
    notes         = excluded.notes
  where shifts.status = 'draft';

  return new;
end;
$function$;

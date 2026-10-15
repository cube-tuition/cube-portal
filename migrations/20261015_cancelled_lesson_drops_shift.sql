-- A cancelled lesson takes its draft pay shift with it.
--
-- The roll trigger skipped 'cancelled' and 'makeup' marks, but never undid a
-- shift it had already made. So when a director first saved the roll with
-- only a comment (SessionMarker saves that as 'present') and then cancelled
-- the lesson with a credit, the teacher kept a draft shift for a lesson that
-- never ran (Y7 English 1:1, 15 Oct 2026).
--
-- Now a class/date loses its DRAFT class shift when
--   • its last running mark (anything but cancelled / makeup) becomes
--     cancelled or makeup, or
--   • its lesson is cancelled (lessons.status → 'cancelled');
-- and a roll saved on a cancelled lesson makes no shift.
-- Approved and paid shifts are never touched: payroll matching already flags
-- them ("The lesson was cancelled") for a director to decide.

create or replace function public.drop_draft_class_shift(p_class integer, p_date date)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  delete from public.shifts
   where source_table = 'class_session'
     and source_id = p_class::text || '_' || p_date::text
     and status = 'draft'
$$;
revoke all on function public.drop_draft_class_shift(integer, date) from public, anon, authenticated;

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
  -- this session didn't run on their account, so it creates no shift — and if
  -- nobody else's mark says it ran, a draft shift made earlier goes too.
  if new.status in ('makeup', 'cancelled') then
    if not exists (select 1 from public.attendance a
                    where a.class_id = new.class_id and a.session_date = new.session_date
                      and a.status not in ('makeup', 'cancelled')) then
      perform public.drop_draft_class_shift(new.class_id, new.session_date);
    end if;
    return new;
  end if;

  select * into v_class from public.classes where id = new.class_id;
  if not found then return new; end if;

  select * into v_lesson
  from public.lessons
  where class_id = new.class_id and lesson_date = new.session_date
  order by coalesce(is_makeup, false), id
  limit 1;

  -- The lesson itself was cancelled: no pay for it, whatever the roll says.
  if v_lesson.status = 'cancelled' and not coalesce(v_lesson.is_makeup, false) then
    perform public.drop_draft_class_shift(new.class_id, new.session_date);
    return new;
  end if;

  v_tutor_id := v_lesson.scheduled_teacher_id;
  if v_tutor_id is null then
    v_tutor_id := public.resolve_tutor_by_first_name(v_class.teacher);
  end if;
  if v_tutor_id is null then return new; end if;

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

-- Cancelling a (regular) lesson drops its draft shift.
create or replace function public.lesson_cancelled_drops_shift()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and not coalesce(new.is_makeup, false) then
    perform public.drop_draft_class_shift(new.class_id, new.lesson_date);
  end if;
  return new;
end $$;

drop trigger if exists lesson_cancelled_drops_shift on public.lessons;
create trigger lesson_cancelled_drops_shift
  after update of status on public.lessons
  for each row execute function public.lesson_cancelled_drops_shift();

-- The test database covers the new pieces.
insert into public.test_snapshot_objects (kind, name, ord)
select v.kind, v.name, coalesce((select max(ord) from public.test_snapshot_objects o where o.kind = v.kind), 0) + v.n
  from (values ('function', 'drop_draft_class_shift', 1),
               ('function', 'lesson_cancelled_drops_shift', 2),
               ('trigger',  'lesson_cancelled_drops_shift', 1)) v(kind, name, n)
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = v.kind and o.name = v.name);

-- The one stray draft: Y7 English 1:1 on 15 Oct 2026, cancelled with a credit.
delete from public.shifts
 where source_table = 'class_session' and source_id = '681_2026-10-15' and status = 'draft';

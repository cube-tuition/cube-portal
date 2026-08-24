-- "Create lessons" looked only at the exact scheduled DATE, so a class whose
-- lesson had been moved to another day that week (Y10 English sitting on a
-- Wednesday instead of its Saturday) still counted the Saturday as empty and
-- created a second lesson for the same week. One class had run on Fridays for
-- five straight weeks and would have gained five duplicate Thursdays.
--
-- The unit is now the TERM WEEK, not the date: each week is topped up to the
-- number of lessons it is supposed to have. A single-day class with any lesson
-- that week is left alone; a two-day class missing one of its two days still
-- gets that one (a blanket "skip the week" would have broken those).
--
--   full_wanted(week) = scheduled dates for the class in that week
--   have(week)        = class lessons the week already holds
--   owed              = full_wanted - have, filled on the earliest free dates
--
-- What counts as "have":
--   * makeups do NOT — is_makeup carries a makeup_student_id, so it is one
--     student's catch-up and the rest of the class still needs the lesson;
--   * cancelled ones DO — the slot was deliberately cancelled, and creating a
--     replacement on the normal day would undo that.
--
-- Everything else is unchanged: past dates are never filled, nothing is ever
-- updated or deleted, and p_apply = false still returns exactly what a real
-- run would write.

create or replace function public.add_lessons_for_class(p_class_id integer, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_class    classes%rowtype;
  v_term     terms%rowtype;
  v_days     text[];
  v_tutor    uuid;
  v_today    date := current_date;
  v_missing  jsonb;
  v_stranded jsonb;
  v_added    integer := 0;
begin
  select * into v_class from classes where id = p_class_id;
  if not found then raise exception 'Class % not found', p_class_id; end if;
  select * into v_term from terms where id = v_class.term_id;
  if not found then raise exception 'No term linked to class %', p_class_id; end if;

  select array(select btrim(d) from unnest(string_to_array(v_class.day_of_week, ',')) d
               where btrim(d) <> '') into v_days;
  if array_length(v_days, 1) is null then
    raise exception 'Class % has no day_of_week set', p_class_id;
  end if;

  v_tutor := public.resolve_tutor_by_first_name(v_class.teacher);

  with wanted as (
    -- every date the class is scheduled to run this term, with its term week
    select d::date as lesson_date,
           floor((d::date - v_term.start_date)::numeric / 7)::int + 1 as week
    from generate_series(v_term.start_date, v_term.end_date, interval '1 day') d
    where (case extract(dow from d)
             when 0 then 'Sunday'    when 1 then 'Monday'   when 2 then 'Tuesday'
             when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
             when 6 then 'Saturday' end) = any (v_days)
  ),
  per_week as (
    select week, count(*)::int as full_wanted from wanted group by week
  ),
  have as (
    -- what the week already holds, wherever in the week it sits: a lesson
    -- moved to another day still IS that week's lesson
    select floor((l.lesson_date - v_term.start_date)::numeric / 7)::int + 1 as week,
           count(*)::int as n
    from lessons l
    where l.class_id = p_class_id
      and coalesce(l.is_makeup, false) = false
      and (l.lesson_type is null or l.lesson_type = 'class')
      and l.lesson_date between v_term.start_date and v_term.end_date
    group by 1
  ),
  owed as (
    select p.week, p.full_wanted - coalesce(h.n, 0) as owed
    from per_week p left join have h on h.week = p.week
  ),
  open_dates as (
    -- scheduled dates still ahead of us with nothing on them yet
    select w.lesson_date, w.week,
           row_number() over (partition by w.week order by w.lesson_date) as rn
    from wanted w
    where w.lesson_date >= v_today
      and not exists (
        select 1 from lessons l
        where l.class_id = p_class_id and l.lesson_date = w.lesson_date
          and coalesce(l.is_makeup, false) = false)
  ),
  gaps as (
    select o.lesson_date, o.week
    from open_dates o join owed od on od.week = o.week
    where o.rn <= od.owed
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_date', lesson_date, 'week', week,
           'start_time', v_class.start_time, 'end_time', v_class.end_time,
           'room', v_class.room) order by lesson_date), '[]'::jsonb)
    into v_missing from gaps;

  -- Upcoming lessons parked on a weekday the class no longer runs.
  select coalesce(jsonb_agg(jsonb_build_object('lesson_id', l.id, 'lesson_date', l.lesson_date)
                            order by l.lesson_date), '[]'::jsonb)
    into v_stranded
  from lessons l
  where l.class_id = p_class_id and coalesce(l.is_makeup, false) = false
    and (l.lesson_type is null or l.lesson_type = 'class')
    and l.lesson_date >= v_today and l.status <> 'cancelled'
    and not exists (
      select 1 from generate_series(v_term.start_date, v_term.end_date, interval '1 day') d
      where d::date = l.lesson_date
        and (case extract(dow from d)
               when 0 then 'Sunday'    when 1 then 'Monday'   when 2 then 'Tuesday'
               when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
               when 6 then 'Saturday' end) = any (v_days));

  if p_apply and jsonb_array_length(v_missing) > 0 then
    with ins as (
      insert into lessons (class_id, lesson_date, start_time, end_time, room,
                           status, week, main_teacher, scheduled_teacher_id, is_makeup)
      select p_class_id, (x->>'lesson_date')::date, v_class.start_time, v_class.end_time,
             v_class.room, 'scheduled', (x->>'week')::int, v_class.teacher, v_tutor, false
      from jsonb_array_elements(v_missing) x
      on conflict (class_id, lesson_date) where (is_makeup = false) do nothing
      returning 1
    )
    select count(*) into v_added from ins;
  end if;

  return jsonb_build_object(
    'class_id', p_class_id, 'class_name', v_class.class_name,
    'applied', p_apply, 'count', jsonb_array_length(v_missing),
    'added', v_added, 'lessons', v_missing, 'stranded', v_stranded);
end;
$function$;

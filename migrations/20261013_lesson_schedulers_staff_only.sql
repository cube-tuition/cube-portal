-- Lesson schedulers: staff only.
--
-- add_lessons_for_class and update_lessons_for_class are SECURITY DEFINER, so
-- they run with full rights whoever calls them — and neither checked who was
-- calling. Any logged-in account (a student's included) could create lessons
-- for any class, or move its future lessons to other dates. The database
-- explorer's Add / Update lessons buttons (staff only) are their only callers.
--
-- Both now refuse anyone who is not staff — the same is_staff() rule as
-- sync_lessons_for_class and as writing to the lessons table directly. The
-- service role (server scripts) is still allowed. Bodies are otherwise
-- unchanged: copied from the live definitions.

CREATE OR REPLACE FUNCTION public.add_lessons_for_class(p_class_id integer, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if not public.is_staff() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden: staff only';
  end if;

  select * into v_class from classes where id = p_class_id;
  if not found then raise exception 'Class % not found', p_class_id; end if;
  select * into v_term from terms where id = v_class.term_id;
  if not found then raise exception 'No term linked to class %', p_class_id; end if;
  -- Weeks run Monday–Sunday: a term stored as starting on a Tuesday (NSW
  -- calendar after a long weekend) starts on that week's Monday for us.
  v_term.start_date := date_trunc('week', v_term.start_date)::date;

  select array(select btrim(d) from unnest(string_to_array(v_class.day_of_week, ',')) d
               where btrim(d) <> '') into v_days;
  if array_length(v_days, 1) is null then
    raise exception 'Class % has no day_of_week set', p_class_id;
  end if;

  v_tutor := public.resolve_tutor_by_first_name(v_class.teacher);

  with wanted as (
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_lessons_for_class(p_class_id integer, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_class    classes%rowtype;
  v_term     terms%rowtype;
  v_days     text[];
  v_today    date := current_date;
  v_plan     jsonb;
  v_changes  jsonb;
  v_stranded jsonb;
  v_applied  integer := 0;
begin
  if not public.is_staff() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden: staff only';
  end if;

  select * into v_class from classes where id = p_class_id;
  if not found then raise exception 'Class % not found', p_class_id; end if;
  select * into v_term from terms where id = v_class.term_id;
  if not found then raise exception 'No term linked to class %', p_class_id; end if;
  -- Weeks run Monday–Sunday: a term stored as starting on a Tuesday (NSW
  -- calendar after a long weekend) starts on that week's Monday for us.
  v_term.start_date := date_trunc('week', v_term.start_date)::date;

  select array(select btrim(d) from unnest(string_to_array(v_class.day_of_week, ',')) d
               where btrim(d) <> '') into v_days;
  if array_length(v_days, 1) is null then
    raise exception 'Class % has no day_of_week set', p_class_id;
  end if;

  with sched as (
    select d::date as lesson_date,
           floor((d::date - v_term.start_date)::numeric / 7)::int + 1 as week
    from generate_series(v_term.start_date, v_term.end_date, interval '1 day') d
    where (case extract(dow from d)
             when 0 then 'Sunday'    when 1 then 'Monday'   when 2 then 'Tuesday'
             when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
             when 6 then 'Saturday' end) = any (v_days)
      and d::date >= v_today
  ),
  mine as (
    select l.* from lessons l
    where l.class_id = p_class_id
      and coalesce(l.is_makeup, false) = false
      and (l.lesson_type is null or l.lesson_type = 'class')
      and l.lesson_date >= v_today
      and l.status <> 'cancelled'
      and not exists (select 1 from attendance a
                      where a.class_id = p_class_id and a.session_date = l.lesson_date)
  ),
  on_day as (select * from mine where lesson_date in (select lesson_date from sched)),
  stranded as (
    select m.*, row_number() over (order by m.lesson_date) rn
    from mine m where m.lesson_date not in (select lesson_date from sched)
  ),
  free as (
    select s.*, row_number() over (order by s.lesson_date) rn
    from sched s
    where not exists (select 1 from lessons l
                      where l.class_id = p_class_id and l.lesson_date = s.lesson_date
                        and coalesce(l.is_makeup, false) = false)
  ),
  -- A lesson stranded on a day the class no longer runs is MOVED onto the next
  -- free scheduled date, in order, so the row (and its notes) survives.
  moves as (
    select st.id as lesson_id, st.lesson_date as old_date, f.lesson_date as new_date,
           st.start_time as old_start, st.end_time as old_end, st.room as old_room,
           st.week as old_week, f.week as new_week, true as moved
    from stranded st join free f on f.rn = st.rn
  ),
  retimes as (
    select o.id, o.lesson_date, o.lesson_date,
           o.start_time, o.end_time, o.room, o.week,
           (select week from sched s where s.lesson_date = o.lesson_date), false
    from on_day o
    where o.start_time is distinct from v_class.start_time
       or o.end_time   is distinct from v_class.end_time
       or o.room       is distinct from v_class.room
       or o.week       is distinct from (select week from sched s where s.lesson_date = o.lesson_date)
  ),
  plan as (select * from moves union all select * from retimes)
  select coalesce(jsonb_agg(to_jsonb(plan) order by old_date), '[]'::jsonb)
    into v_plan from plan;

  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_id', (x->>'lesson_id')::int, 'moved', (x->>'moved')::boolean,
           'from_date', x->>'old_date', 'to_date', x->>'new_date',
           'from_time', coalesce(x->>'old_start','')||'-'||coalesce(x->>'old_end',''),
           'to_time',   coalesce(v_class.start_time,'')||'-'||coalesce(v_class.end_time,''),
           'from_room', x->>'old_room', 'to_room', v_class.room,
           'from_week', (x->>'old_week')::int, 'to_week', (x->>'new_week')::int)
           order by x->>'old_date'), '[]'::jsonb)
    into v_changes from jsonb_array_elements(v_plan) x;

  -- Stranded with nowhere free to go: left exactly where they are, reported.
  select coalesce(jsonb_agg(jsonb_build_object('lesson_id', l.id, 'lesson_date', l.lesson_date)
                            order by l.lesson_date), '[]'::jsonb)
    into v_stranded
  from lessons l
  where l.class_id = p_class_id and coalesce(l.is_makeup, false) = false
    and (l.lesson_type is null or l.lesson_type = 'class')
    and l.lesson_date >= v_today and l.status <> 'cancelled'
    and not exists (select 1 from jsonb_array_elements(v_plan) x
                    where (x->>'lesson_id')::int = l.id)
    and not exists (
      select 1 from generate_series(v_term.start_date, v_term.end_date, interval '1 day') d
      where d::date = l.lesson_date
        and (case extract(dow from d)
               when 0 then 'Sunday'    when 1 then 'Monday'   when 2 then 'Tuesday'
               when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
               when 6 then 'Saturday' end) = any (v_days));

  if p_apply and jsonb_array_length(v_plan) > 0 then
    -- Move targets are only ever dates with no lesson on them, so nothing can
    -- collide on (class_id, lesson_date) and the order of updates is free.
    with upd as (
      update lessons l
      set lesson_date = (x->>'new_date')::date,
          start_time  = v_class.start_time,
          end_time    = v_class.end_time,
          room        = v_class.room,
          week        = (x->>'new_week')::int
      from jsonb_array_elements(v_plan) x
      where l.id = (x->>'lesson_id')::int
      returning 1
    )
    select count(*) into v_applied from upd;
  end if;

  return jsonb_build_object(
    'class_id', p_class_id, 'class_name', v_class.class_name,
    'applied', p_apply, 'count', jsonb_array_length(v_changes),
    'updated', v_applied, 'changes', v_changes, 'stranded', v_stranded);
end;
$function$
;

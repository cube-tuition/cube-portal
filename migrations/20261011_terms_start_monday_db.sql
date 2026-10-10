-- Terms start on the Monday of their first week — in the database too.
--
-- The terms table follows the NSW calendar, so Term 4 2026 is stored as
-- starting Tuesday 13 Oct (after the Labour Day long weekend). The portal
-- already reads every term from its Monday (lib/termDates normaliseTerms,
-- 2026-10-07), but the database's lesson functions still counted from the
-- stored Tuesday: Monday 12 Oct got no lessons, Monday classes' "Week 1" was
-- 19 Oct, and pay_period_for filed 12 Oct in the holiday pay period while
-- the payroll page called it fortnight 1.
--
-- 1. generate / sync / add / update_lessons_for_class: right after loading the
--    term, v_term.start_date := date_trunc('week', start_date)::date. Applied
--    by text substitution so the rest of each function is untouched:
do $$
declare
  f record; def text; new_def text;
  up_anchor text := E'SELECT * INTO v_term FROM terms WHERE id = v_class.term_id;\n  IF NOT FOUND THEN RAISE EXCEPTION ''No term linked to class %'', p_class_id; END IF;';
  lo_anchor text := E'select * into v_term from terms where id = v_class.term_id;\n  if not found then raise exception ''No term linked to class %'', p_class_id; end if;';
  line text := E'\n  -- Weeks run Monday–Sunday: a term stored as starting on a Tuesday (NSW\n  -- calendar after a long weekend) starts on that week''s Monday for us.\n  v_term.start_date := date_trunc(''week'', v_term.start_date)::date;';
begin
  for f in select oid, proname from pg_proc where pronamespace = 'public'::regnamespace
           and proname in ('generate_lessons_for_class','sync_lessons_for_class','add_lessons_for_class','update_lessons_for_class') loop
    def := pg_get_functiondef(f.oid);
    if position('date_trunc(''week'', v_term.start_date)' in def) > 0 then continue; end if;  -- already applied
    new_def := replace(replace(def, up_anchor, up_anchor || line), lo_anchor, lo_anchor || line);
    if new_def = def then raise exception 'anchor not found in %', f.proname; end if;
    execute new_def;
  end loop;
end $$;

-- 2. pay_period_for: a term's pay fortnights count from its Monday, and the
--    holiday period before it ends the day before that Monday.
create or replace function public.pay_period_for(p_date date)
 returns table(period_start date, period_end date, fortnight_index integer, term_id uuid)
 language plpgsql stable
as $function$
declare
  v_term       public.terms%rowtype;
  v_start      date;
  v_next_start date;
  v_diff       int;
  v_idx        int;
begin
  select * into v_term from public.terms
   where p_date between date_trunc('week', start_date)::date and end_date
     and coalesce(term_number, 0) <= 10
   order by start_date desc limit 1;
  if found then
    v_start := date_trunc('week', v_term.start_date)::date;
    v_diff := p_date - v_start;
    v_idx  := least(5, greatest(1, (v_diff / 14)::int + 1));
    period_start    := v_start + (v_idx - 1) * 14;
    period_end      := period_start + 13;
    fortnight_index := v_idx;
    term_id         := v_term.id;
    return next; return;
  end if;

  select * into v_term from public.terms
   where end_date < p_date and coalesce(term_number, 0) <= 10
   order by end_date desc limit 1;
  if found then
    select min(date_trunc('week', start_date)::date) into v_next_start from public.terms
     where start_date > v_term.end_date and coalesce(term_number, 0) <= 10;
    period_start    := v_term.end_date + 1;
    period_end      := coalesce(v_next_start - 1, v_term.end_date + 42);
    fortnight_index := 0;
    term_id         := v_term.id;
    return next; return;
  end if;

  select * into v_term from public.terms
   where coalesce(term_number, 0) <= 10 order by start_date asc limit 1;
  if not found then return; end if;
  period_start    := date_trunc('week', v_term.start_date)::date;
  period_end      := period_start + 13;
  fortnight_index := 1;
  term_id         := v_term.id;
  return next;
end;
$function$;

-- 3. Data (applied 2026-10-11): the six Monday classes of Term 4 2026 get a
--    lesson on Monday 12 Oct (Week 1), and Term 4 lessons are renumbered from
--    that Monday — only the Monday classes' 54 lessons changed (19 Oct → Week 2
--    … 14 Dec → Week 10); every other day's weeks were already right.
insert into public.lessons (class_id, lesson_date, start_time, end_time, room, status, week, main_teacher, scheduled_teacher_id, is_makeup)
select c.id, '2026-10-12'::date, c.start_time, c.end_time, c.room, 'scheduled', 1, c.teacher, public.resolve_tutor_by_first_name(c.teacher), false
from public.classes c join public.terms t on t.id = c.term_id
where t.name = 'Term 4 2026' and coalesce(c.status, 'active') = 'active'
  and 'Monday' = any (select btrim(d) from unnest(string_to_array(c.day_of_week, ',')) d)
on conflict (class_id, lesson_date) where (is_makeup = false) do nothing;

update public.lessons l set week = floor((l.lesson_date - '2026-10-12'::date)::numeric / 7)::int + 1
from public.classes c join public.terms t on t.id = c.term_id
where c.id = l.class_id and t.name = 'Term 4 2026'
  and l.lesson_date between '2026-10-12' and '2026-12-20'
  and l.week is distinct from floor((l.lesson_date - '2026-10-12'::date)::numeric / 7)::int + 1;

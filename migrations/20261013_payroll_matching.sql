-- Payroll matching: shifts that match the timetable approve themselves.
--
-- Until now every shift was approved by hand. payroll_match() lays a pay
-- period's waiting shifts against what SHOULD have happened:
--   • a class shift matches its scheduled lesson — same class and date, the
--     lesson not cancelled, paid to the lesson's teacher (a cover teacher set
--     on the lesson counts), for the lesson's length, at the rate-table rate;
--   • a drop-in shift matches its session — the tutor was rostered, the shift
--     sits inside the session's times, at the rate-table rate;
--   • a shift added by hand never matches: a person looks at it.
-- It also lists lessons that should have been paid but have no shift — the
-- roll wasn't marked, or no shift could be made — unless every student was
-- cancelled or moved (a lesson that didn't run pays nobody).
--
-- auto_approve_matched_shifts() approves every match into the period's pay
-- run (unless that run is already exported or paid). A shift an admin
-- un-approves is never re-approved automatically; it is listed until they act. The payroll page runs it
-- for the fortnight on screen; the daily cron runs auto_approve_due_shifts()
-- for this fortnight and the last. Everything else shows as a discrepancy.
--
-- Admin or service role only.

create or replace function public.payroll_match(p_period_start date, p_period_end date, p_today date default null)
returns table (
  category   text,      -- 'match' | 'issue'
  kind       text,      -- 'class' | 'dropin' | 'manual' | 'missing'
  shift_id   uuid,
  tutor_id   uuid,
  tutor_name text,
  work_date  date,
  class_id   integer,
  title      text,
  problems   text[]
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_today   date := coalesce(p_today, (now() at time zone 'Australia/Sydney')::date);
  s         record;
  c         record;
  l         record;
  ds        record;
  d         record;
  v_cid     integer;
  v_probs   text[];
  v_tutor   uuid;
  v_start   time;
  v_end     time;
  v_hours   numeric;
  v_rate    numeric;
  v_marked  boolean;
  v_closed  text;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'forbidden: admin only';
  end if;
  -- A fortnight already exported or paid: anything still waiting in it was
  -- left out of that pay — say so, whatever else is true of the shift.
  select status into v_closed from public.pay_runs
   where period_start = p_period_start and period_end = p_period_end and status in ('exported', 'paid');

  -- ── Shifts waiting for approval in this pay period ───────────────────────
  for s in
    select sh.* from public.shifts sh
    cross join lateral public.pay_period_for(sh.work_date) pp
    where pp.period_start = p_period_start and pp.period_end = p_period_end
      and sh.status in ('draft', 'submitted') and sh.work_date <= v_today
    order by sh.work_date, sh.start_time, sh.id
  loop
    v_probs := '{}';
    v_cid := null;
    v_rate := null;
    title := coalesce(nullif(regexp_replace(coalesce(s.notes, ''), '^Auto: ', ''), ''), 'Shift');

    if s.source_table = 'class_session' and s.source_id ~ '^\d+_' then
      kind := 'class';
      v_cid := split_part(s.source_id, '_', 1)::int;
      select * into c from public.classes where id = v_cid;
      title := coalesce(c.class_name, title);
      select * into l from public.lessons
       where lessons.class_id = v_cid and lesson_date = s.work_date
       order by coalesce(is_makeup, false), id limit 1;
      if l.id is null then
        v_probs := v_probs || 'No lesson was scheduled for this class on this day'::text;
      elsif l.status = 'cancelled' then
        v_probs := v_probs || 'The lesson was cancelled'::text;
      end if;

      v_tutor := coalesce(l.scheduled_teacher_id, public.resolve_tutor_by_first_name(c.teacher));
      if v_tutor is distinct from s.tutor_id then
        v_probs := v_probs || format('The lesson''s teacher is %s',
          coalesce((select full_name from public.tutors where id = v_tutor),
                   (select full_name from public.directors where id = v_tutor), 'not set'));
      end if;

      v_start := coalesce(public.parse_class_time(l.start_time), public.parse_class_time(c.start_time));
      v_end   := coalesce(public.parse_class_time(l.end_time),   public.parse_class_time(c.end_time));
      if v_start is not null and v_end is not null then
        if v_end < v_start then v_end := v_end + interval '12 hours'; end if;
        v_hours := round(extract(epoch from (v_end - v_start)) / 3600.0, 2);
        if v_hours is distinct from s.hours then
          v_probs := v_probs || format('Scheduled for %sh, the shift is %sh', trim_scale(v_hours), trim_scale(s.hours));
        end if;
      else
        v_probs := v_probs || 'The class has no times to check the hours against'::text;
      end if;

      v_rate := public.resolve_matrix_rate(s.tutor_id, c.class_name, s.work_date);

    elsif s.source_table = 'dropin_sessions' then
      kind := 'dropin';
      select * into ds from public.dropin_sessions where id::text = split_part(s.source_id, '_', 1);
      title := 'Drop-in' || coalesce(' @ ' || nullif(ds.location, ''), '');
      if ds.id is null then
        v_probs := v_probs || 'The drop-in session no longer exists'::text;
      else
        if not exists (select 1 from unnest(coalesce(ds.tutors, '{}'::text[])) n
                        where public.resolve_tutor_by_first_name(n) = s.tutor_id) then
          v_probs := v_probs || 'Not rostered on this drop-in'::text;
        end if;
        if s.work_date <> ds.session_date then
          v_probs := v_probs || 'Dated differently from the session'::text;
        end if;
        if s.start_time is null or s.end_time is null
           or s.start_time < ds.start_time or s.end_time > ds.end_time then
          v_probs := v_probs || format('Outside the session''s times (%s–%s)',
            to_char(ds.start_time, 'FMHH12:MIam'), to_char(ds.end_time, 'FMHH12:MIam'));
        elsif round(extract(epoch from (s.end_time - s.start_time)) / 3600.0, 2) is distinct from s.hours then
          v_probs := v_probs || 'The hours don''t match its start and finish'::text;
        end if;
        v_rate := public.dropin_matrix_rate(s.tutor_id, ds.year_groups, ds.session_date);
      end if;

    else
      kind := 'manual';
      v_probs := v_probs || 'Added by hand'::text;
      v_rate := null;
    end if;

    if s.rate_snapshot is null then
      v_probs := v_probs || 'No rate set'::text;
    elsif kind <> 'manual' and v_rate is distinct from s.rate_snapshot then
      v_probs := v_probs || coalesce(format('The rate table says $%s/h', trim_scale(v_rate)), 'The rate table has no rate for this');
    end if;

    -- An admin took it back out of approval: it waits for them, it is not
    -- re-approved behind their back.
    if s.status = 'submitted' then
      v_probs := v_probs || 'Taken out of approval by hand — approve it when it''s right'::text;
    end if;

    if v_closed is not null then
      v_probs := v_probs || format('Left out of this fortnight''s pay run, which is already %s — it still needs paying', v_closed);
    end if;

    category := case when cardinality(v_probs) = 0 then 'match' else 'issue' end;
    shift_id := s.id;
    tutor_id := s.tutor_id;
    tutor_name := coalesce((select full_name from public.tutors where id = s.tutor_id),
                           (select full_name from public.directors where id = s.tutor_id));
    work_date := s.work_date;
    class_id := v_cid;
    problems := v_probs;
    return next;
  end loop;

  -- ── Lessons that should have been paid but have no shift ─────────────────
  -- Up to yesterday: today's classes may simply not have run yet.
  for d in
    select distinct on (l2.class_id, l2.lesson_date)
           l2.class_id as cid, l2.lesson_date, l2.scheduled_teacher_id, l2.start_time, l2.end_time,
           c2.class_name, c2.teacher, c2.start_time as c_start, c2.end_time as c_end
    from public.lessons l2
    join public.classes c2 on c2.id = l2.class_id
    cross join lateral public.pay_period_for(l2.lesson_date) pp
    where pp.period_start = p_period_start and pp.period_end = p_period_end
      and l2.lesson_date < v_today and l2.status <> 'cancelled'
      and coalesce(c2.status, 'active') = 'active'
    order by l2.class_id, l2.lesson_date, coalesce(l2.is_makeup, false), l2.id
  loop
    continue when exists (select 1 from public.shifts x
                           where x.source_table = 'class_session' and x.source_id = d.cid || '_' || d.lesson_date);
    v_marked := exists (select 1 from public.attendance a where a.class_id = d.cid and a.session_date = d.lesson_date);
    -- Marked, and every student cancelled or moved: the lesson didn't run.
    continue when v_marked and not exists (
      select 1 from public.attendance a where a.class_id = d.cid and a.session_date = d.lesson_date
         and a.status not in ('cancelled', 'makeup'));

    v_tutor := coalesce(d.scheduled_teacher_id, public.resolve_tutor_by_first_name(d.teacher));
    v_probs := array[case when v_marked then 'The roll was marked but no shift was created'
                          else 'No shift — the roll hasn''t been marked' end];
    if v_marked and v_tutor is null then
      v_probs := v_probs || format('No staff member matches the teacher "%s"', coalesce(d.teacher, ''));
    end if;
    if v_marked and coalesce(public.parse_class_time(d.start_time), public.parse_class_time(d.c_start)) is null then
      v_probs := v_probs || 'The class has no start or finish time'::text;
    end if;

    category := 'issue';
    kind := 'missing';
    shift_id := null;
    tutor_id := v_tutor;
    tutor_name := coalesce((select full_name from public.tutors where id = v_tutor),
                           (select full_name from public.directors where id = v_tutor), d.teacher);
    work_date := d.lesson_date;
    class_id := d.cid;
    title := d.class_name;
    problems := v_probs;
    return next;
  end loop;
end;
$function$;

create or replace function public.auto_approve_matched_shifts(p_period_start date, p_period_end date, p_today date default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_run public.pay_runs%rowtype;
  n     integer;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'forbidden: admin only';
  end if;

  insert into public.pay_runs (period_start, period_end, status)
  values (p_period_start, p_period_end, 'open')
  on conflict (period_start, period_end) do nothing;
  select * into v_run from public.pay_runs where period_start = p_period_start and period_end = p_period_end;
  -- An exported or paid run is settled: nothing joins it now.
  if v_run.status in ('exported', 'paid', 'void') then return 0; end if;

  update public.shifts
     set status = 'approved', pay_run_id = v_run.id, approved_at = now(), approved_by = auth.uid()
   where id in (select m.shift_id from public.payroll_match(p_period_start, p_period_end, p_today) m
                 where m.category = 'match')
     and status = 'draft';
  get diagnostics n = row_count;

  if n > 0 then
    update public.pay_runs pr
       set total_hours  = t.h, total_amount = t.a
      from (select coalesce(sum(hours), 0)::numeric(10,2) as h,
                   coalesce(sum(hours * coalesce(rate_snapshot, 0)), 0)::numeric(12,2) as a
              from public.shifts where pay_run_id = v_run.id) t
     where pr.id = v_run.id;
  end if;
  return n;
end;
$function$;

-- The daily cron: this fortnight and the one before (rolls marked late).
create or replace function public.auto_approve_due_shifts(p_today date default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Australia/Sydney')::date);
  cur  record;
  prev record;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'forbidden: admin only';
  end if;
  select * into cur from public.pay_period_for(v_today);
  if cur.period_start is null then return 0; end if;
  select * into prev from public.pay_period_for(cur.period_start - 1);
  return public.auto_approve_matched_shifts(cur.period_start, cur.period_end, v_today)
       + coalesce(case when prev.period_start is not null and prev.period_start <> cur.period_start
                       then public.auto_approve_matched_shifts(prev.period_start, prev.period_end, v_today) end, 0);
end;
$function$;

revoke all on function public.payroll_match(date, date, date) from public, anon;
revoke all on function public.auto_approve_matched_shifts(date, date, date) from public, anon;
revoke all on function public.auto_approve_due_shifts(date) from public, anon;
grant execute on function public.payroll_match(date, date, date) to authenticated, service_role;
grant execute on function public.auto_approve_matched_shifts(date, date, date) to authenticated, service_role;
grant execute on function public.auto_approve_due_shifts(date) to authenticated, service_role;

-- A teacher may trim a drop-in shift but never extend it: the session's rostered
-- times are the ceiling. Anything longer is a claim for time the centre did not
-- roster, and payroll should see it as an edit to the session, not to the shift.
--
-- Replaces save_dropin_shift from 20260821d with the two bounds checks added;
-- everything else is unchanged.
create or replace function public.save_dropin_shift(
  p_session_id uuid,
  p_start      time default null,
  p_end        time default null
)
returns public.shifts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_sess   public.dropin_sessions%rowtype;
  v_name   text;
  v_listed boolean := false;
  v_hours  numeric(5,2);
  v_rate   numeric(10,2);
  v_key    text;
  v_row    public.shifts%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_sess from public.dropin_sessions where id = p_session_id;
  if not found then
    raise exception 'That drop-in session no longer exists';
  end if;

  -- Only a tutor rostered on this drop-in may raise a shift for it. Names are
  -- stored as free text, so resolve each the same way the trigger does.
  foreach v_name in array coalesce(v_sess.tutors, '{}'::text[]) loop
    if public.resolve_tutor_by_first_name(v_name) = v_uid then
      v_listed := true;
    end if;
  end loop;
  if not v_listed then
    raise exception 'Only a tutor rostered on this drop-in can save its shift';
  end if;

  p_start := coalesce(p_start, v_sess.start_time);
  p_end   := coalesce(p_end,   v_sess.end_time);
  if p_start is null or p_end is null then
    raise exception 'This drop-in has no start or finish time';
  end if;

  -- The shift must sit inside the rostered session: start no earlier, finish no
  -- later. Shorter is fine — that is the whole point of letting them edit it.
  if p_start < v_sess.start_time then
    raise exception 'A drop-in shift cannot start before the session does (%)',
      to_char(v_sess.start_time, 'HH12:MIam');
  end if;
  if p_end > v_sess.end_time then
    raise exception 'A drop-in shift cannot run past the end of the session (%)',
      to_char(v_sess.end_time, 'HH12:MIam');
  end if;

  v_hours := extract(epoch from (p_end - p_start)) / 3600.0;
  if v_hours <= 0 then
    raise exception 'The finish time must be after the start time';
  end if;

  v_rate := public.dropin_matrix_rate(v_uid, v_sess.year_groups, v_sess.session_date);
  v_key  := v_sess.id::text || '_' || v_uid::text;

  insert into public.shifts (
    tutor_id, work_date, start_time, end_time, hours, kind,
    source_table, source_id, rate_snapshot, notes, status, created_by
  )
  values (
    v_uid, v_sess.session_date, p_start, p_end, v_hours, 'dropin',
    'dropin_sessions', v_key, v_rate,
    'Drop-in' || case when coalesce(v_sess.location, '') <> ''
                      then ' @ ' || v_sess.location else '' end,
    'draft', v_uid
  )
  on conflict (source_table, source_id)
    where source_table is not null and source_id is not null
  do update set
    start_time    = excluded.start_time,
    end_time      = excluded.end_time,
    hours         = excluded.hours,
    -- Keep whatever rate the shift was raised at; only fill a missing one.
    rate_snapshot = coalesce(public.shifts.rate_snapshot, excluded.rate_snapshot),
    notes         = excluded.notes
  -- An approved / paid / void shift is settled: never rewrite it from here.
  where public.shifts.status = 'draft'
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.shifts
    where source_table = 'dropin_sessions' and source_id = v_key;
  end if;

  return v_row;
end;
$$;

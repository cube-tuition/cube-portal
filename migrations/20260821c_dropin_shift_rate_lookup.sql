-- create_shifts_from_dropin called public.current_tutor_rate(uuid, date), which
-- has never existed — so saving any drop-in with a tutor assigned failed with
-- "function does not exist" and no shift was ever raised for a drop-in.
--
-- The real rate lookup is the matrix: (tutor, year_band, mode, effective_from).
-- A drop-in has no class name to parse a band out of, but now that sessions
-- carry year_groups we can use them: a session aimed at one band is paid at
-- that band; one spanning bands (or aimed at nobody in particular) falls back
-- to 'other', which the matrix already carries a row for. Mode is always
-- 'class' — a drop-in is a group session, not 1:1.

create or replace function public.dropin_rate_band(p_year_groups text[])
returns text
language sql
immutable
as $$
  select coalesce(
    (select case when count(distinct b) = 1 then min(b) else 'other' end
       from (
         select public.year_band_for(nullif(regexp_replace(y, '\D', '', 'g'), '')::int) as b
         from unnest(coalesce(p_year_groups, '{}'::text[])) as y
       ) t
      where b is not null),
    'other');
$$;

create or replace function public.dropin_matrix_rate(p_tutor uuid, p_year_groups text[], p_on date)
returns numeric
language sql
stable
as $$
  select hourly_rate
  from public.tutor_rate_matrix
  where tutor_id = p_tutor
    and year_band = public.dropin_rate_band(p_year_groups)
    and mode = 'class'
    and effective_from <= p_on
  order by effective_from desc
  limit 1;
$$;

-- Provided because the trigger has always named it, and anything else written
-- against that shape keeps working: the untargeted drop-in rate for a tutor.
create or replace function public.current_tutor_rate(p_tutor uuid, p_on date)
returns numeric
language sql
stable
as $$
  select public.dropin_matrix_rate(p_tutor, null::text[], p_on);
$$;

create or replace function public.create_shifts_from_dropin()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name        text;
  v_tutor_id    uuid;
  v_hours       numeric(5,2);
  v_rate        numeric(10,2);
  v_source_key  text;
begin
  if new.tutors is null or array_length(new.tutors,1) is null then
    return new;
  end if;
  if new.start_time is null or new.end_time is null then return new; end if;

  v_hours := extract(epoch from (new.end_time - new.start_time)) / 3600.0;
  if v_hours <= 0 or v_hours > 12 then return new; end if;

  foreach v_name in array new.tutors loop
    if v_name is null or btrim(v_name) = '' then continue; end if;

    v_tutor_id := public.resolve_tutor_by_first_name(v_name);
    if v_tutor_id is null then continue; end if;

    v_rate := public.dropin_matrix_rate(v_tutor_id, new.year_groups, new.session_date);
    v_source_key := new.id::text || '_' || v_tutor_id::text;

    insert into public.shifts (
      tutor_id, work_date, start_time, end_time, hours, kind,
      source_table, source_id, rate_snapshot, notes, status, created_by
    )
    values (
      v_tutor_id, new.session_date, new.start_time, new.end_time, v_hours, 'dropin',
      'dropin_sessions', v_source_key, v_rate,
      'Auto: drop-in' || case when new.location is not null and new.location <> ''
                              then ' @ ' || new.location else '' end,
      'draft', v_tutor_id
    )
    on conflict (source_table, source_id)
      where source_table is not null and source_id is not null
    do nothing;
  end loop;

  return new;
end;
$function$;

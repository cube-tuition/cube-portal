-- Classes without a year in the name (e.g. "Speaking Development 1:1",
-- "HW Help/Mentoring 1:1") resolved to no year band, so their shifts got no
-- rate. Add an 'other' band that such classes fall back to.
alter table tutor_rate_matrix drop constraint tutor_rate_matrix_year_band_check;
alter table tutor_rate_matrix add constraint tutor_rate_matrix_year_band_check
  check (year_band = any (array['1-6'::text, '7-8'::text, '9-10'::text, '11-12'::text, 'other'::text]));

create or replace function public.resolve_matrix_rate(p_tutor uuid, p_class_name text, p_on date)
returns numeric
language plpgsql
stable
as $function$
declare
  -- Year-less class names fall back to the 'other' band.
  v_band text := coalesce(public.year_band_for(public.parse_class_year(p_class_name)), 'other');
  v_mode text := public.parse_class_mode(p_class_name);
  v_rate numeric;
begin
  select hourly_rate into v_rate
  from public.tutor_rate_matrix
  where tutor_id = p_tutor
    and year_band = v_band
    and mode = v_mode
    and effective_from <= p_on
  order by effective_from desc
  limit 1;
  return v_rate;
end;
$function$;

-- Aiden Kim: $40/h for Speaking Development (and any other year-less class).
insert into tutor_rate_matrix (tutor_id, year_band, mode, hourly_rate, effective_from, notes)
values
  ('ad015503-a35b-454d-a02c-e5e71e59c21c', 'other', 'tutor', 40.00, '2026-01-01', 'Speaking Development / classes without a year in the name'),
  ('ad015503-a35b-454d-a02c-e5e71e59c21c', 'other', 'class', 40.00, '2026-01-01', 'Speaking Development / classes without a year in the name')
on conflict (tutor_id, year_band, mode, effective_from) do update set hourly_rate = excluded.hourly_rate;

-- Human-friendly tutor codes: <yy>-<initials>, e.g. 26-KP (Kevin Park, joined
-- 2026). Collisions within a year get a numeric suffix in join order: Daniel
-- Leem 26-DL, David Lee 26-DL2. The uuid id stays the primary key everywhere;
-- tutor_code is display-only identity for humans (database explorer etc.).

alter table public.tutors add column if not exists tutor_code text unique;

-- Initials = first letter of each word of the full name, uppercased.
create or replace function public.tutor_initials(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(string_agg(left(w, 1), '' order by ord))
  from unnest(regexp_split_to_array(trim(coalesce(p_name, '')), '\s+'))
       with ordinality as t(w, ord)
  where w <> ''
$$;

-- Next free code for a name joining in a given year: yy-XX, then yy-XX2, ...
create or replace function public.next_tutor_code(p_name text, p_year int)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_base text := to_char(p_year % 100, 'FM00') || '-' || public.tutor_initials(p_name);
  v_code text := v_base;
  v_n    int  := 1;
begin
  if public.tutor_initials(p_name) is null or public.tutor_initials(p_name) = '' then
    return null;
  end if;
  while exists (select 1 from public.tutors where tutor_code = v_code) loop
    v_n := v_n + 1;
    v_code := v_base || v_n::text;
  end loop;
  return v_code;
end;
$$;

-- Backfill existing tutors: year = year of their first shift (the portal's
-- record of when they started), falling back to the current year; suffix
-- order follows first-shift date so the earlier namesake gets the bare code.
do $$
declare
  rec record;
begin
  for rec in
    select t.id, t.full_name,
           extract(year from coalesce(min(s.work_date), current_date))::int as join_year
    from public.tutors t
    left join public.shifts s on s.tutor_id = t.id
    where t.tutor_code is null
    group by t.id, t.full_name
    order by min(s.work_date) nulls last, t.full_name
  loop
    update public.tutors
       set tutor_code = public.next_tutor_code(rec.full_name, rec.join_year)
     where id = rec.id;
  end loop;
end;
$$;

-- New tutors get a code automatically (year = year they were added). An
-- explorer insert may send '' for an untouched text field — treat as null.
create or replace function public.tutors_set_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tutor_code is null or trim(new.tutor_code) = '' then
    new.tutor_code := public.next_tutor_code(new.full_name, extract(year from current_date)::int);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tutors_set_code on public.tutors;
create trigger trg_tutors_set_code
  before insert on public.tutors
  for each row execute function public.tutors_set_code();

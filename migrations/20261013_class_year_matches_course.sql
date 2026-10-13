-- A class's year must match its course's year.
--
-- Class 656 was named "Y12 Adv Maths 1:1" but linked to the Y11 Advanced Maths
-- 1:1 course, so the curriculum and booklet pages (which read the year from
-- the course code) treated a Year 12 student's class as Year 11 — the same
-- mix-up as Ryan's Year 12 chemistry classes. The two are entered separately,
-- so nothing kept them in step.
--
-- Rules, enforced on write (rows already in the table are left alone until
-- their name or course is changed):
--   • classes: the year in the class name ("Y12 …") must equal its course's
--     year. Names without a year ("HW Help/Mentoring 1:1") are not checked.
--   • courses: a course's name year and code year must agree ("Y11 …" with
--     code "11.…"), and changing a course's year may not strand its classes.
--
-- A course's year is read from its code first ("12.M2T" → 12), as the
-- curriculum and booklet pages do, then from its name.

create or replace function public.course_year(p_code text, p_name text)
returns integer
language sql
immutable
as $$
  select coalesce(nullif(substring(coalesce(p_code, '') from '^(\d{1,2})\.'), '')::int,
                  public.parse_class_year(p_name));
$$;

create or replace function public.class_year_matches_course()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_class_year  integer := public.parse_class_year(new.class_name);
  v_course      record;
  v_course_year integer;
begin
  -- Only a new class, a rename or a course change is checked.
  if tg_op = 'UPDATE' and new.class_name is not distinct from old.class_name
                      and new.course_id is not distinct from old.course_id then
    return new;
  end if;
  if v_class_year is null or new.course_id is null then return new; end if;

  select course_name, course_code into v_course from public.courses where id = new.course_id;
  if not found then return new; end if;
  v_course_year := public.course_year(v_course.course_code, v_course.course_name);

  if v_course_year is not null and v_course_year <> v_class_year then
    raise exception using
      errcode = 'check_violation',
      message = format('"%s" is Year %s, but its course "%s" (%s) is Year %s.',
                       new.class_name, v_class_year, v_course.course_name, v_course.course_code, v_course_year),
      hint    = format('Choose the Year %s course, or rename the class.', v_class_year);
  end if;
  return new;
end;
$function$;

create or replace function public.course_year_consistent()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name_year integer := public.parse_class_year(new.course_name);
  v_code_year integer := nullif(substring(coalesce(new.course_code, '') from '^(\d{1,2})\.'), '')::int;
  v_year      integer := public.course_year(new.course_code, new.course_name);
  v_clash     text;
begin
  if tg_op = 'UPDATE' and new.course_name is not distinct from old.course_name
                      and new.course_code is not distinct from old.course_code then
    return new;
  end if;

  if v_name_year is not null and v_code_year is not null and v_name_year <> v_code_year then
    raise exception using
      errcode = 'check_violation',
      message = format('Course "%s" says Year %s in its name but Year %s in its code (%s).',
                       new.course_name, v_name_year, v_code_year, new.course_code),
      hint    = 'Make the name and the code agree.';
  end if;

  if tg_op = 'UPDATE' and v_year is distinct from public.course_year(old.course_code, old.course_name) then
    select string_agg(format('%s (%s)', c.class_name, c.id), ', ' order by c.id) into v_clash
      from public.classes c
     where c.course_id = new.id
       and public.parse_class_year(c.class_name) is not null
       and public.parse_class_year(c.class_name) is distinct from v_year;
    if v_clash is not null then
      raise exception using
        errcode = 'check_violation',
        message = format('Changing course "%s" to Year %s would leave classes of another year on it: %s.',
                         new.course_name, v_year, v_clash),
        hint    = 'Move or rename those classes first.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists classes_year_matches_course on public.classes;
create trigger classes_year_matches_course
  before insert or update of class_name, course_id on public.classes
  for each row execute function public.class_year_matches_course();

drop trigger if exists courses_year_consistent on public.courses;
create trigger courses_year_consistent
  before insert or update of course_name, course_code on public.courses
  for each row execute function public.course_year_consistent();

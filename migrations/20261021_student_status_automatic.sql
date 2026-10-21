-- A student's status is worked out from their enrolments — never set by hand.
--
-- students.status and enrolments.status were two separate hand-kept fields, so
-- they drifted: a student marked "pending" while still enrolled (and billed)
-- in a class, a paused student still "active", a converted trial still
-- "trial". The class roll, invoices and payroll only ever read the enrolment,
-- so the enrolment is the truth; the student's status now follows it:
--
--   active    in a class now — or a class still to come (next term, a holiday
--             course) — and not disenrolled. A disenrolment with a future end
--             date stays active until that date.
--   trial     not active, but on a trial (trial / trial complete), including a
--             trial enquiry that has no class yet.
--   inactive  has been enrolled before, but nothing current: left, paused, or
--             finished (e.g. Year 12 after the HSC).
--   pending   has never had an enrolment — a lead.
--
-- "Current" is anchored on the latest TEACHING term that has started (holiday
-- terms carry term_number > 10): enrolments in that term or anything after it
-- count. So through the summer break Term 4's students stay active, and on
-- the first day of Term 1 the ones without a Term 1 class turn inactive.
--
-- Kept up to date three ways:
--   1. any enrolment change recomputes that student (trigger below);
--   2. any write to a student recomputes it, so a hand-set value never sticks;
--   3. the morning job runs refresh_student_statuses() for every student, for
--      the changes that come from the calendar alone (a new term starting).

create or replace function public.derived_student_status(
  p_student uuid,
  p_today date default (now() at time zone 'Australia/Sydney')::date
) returns text
 language sql stable
 set search_path to 'public'
as $function$
  with anchor as (
    select max(start_date) as a from terms where term_number <= 10 and start_date <= p_today
  ),
  live as (
    select e.status
      from enrolments e
      left join classes c on c.id = e.class_id
      left join terms t on t.id = c.term_id
      cross join anchor
     where e.student_id = p_student
       and (e.status <> 'disenrol' or e.ended_at >= p_today)
       and ((t.id is not null and t.end_date >= coalesce(anchor.a, '-infinity'::date))
            or (e.class_id is null and e.status in ('trial', 'trial complete')))
  )
  select case
    when exists (select 1 from live where status in ('active', 'disenrol')) then 'active'
    when exists (select 1 from live where status in ('trial', 'trial complete')) then 'trial'
    when exists (select 1 from enrolments where student_id = p_student) then 'inactive'
    else 'pending'
  end
$function$;

-- 2. Whatever a page writes, the stored status is the derived one.
create or replace function public.students_status_derived()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.status := derived_student_status(new.id);
  return new;
end;
$function$;

drop trigger if exists students_status_derived on public.students;
create trigger students_status_derived
  before insert or update on public.students
  for each row execute function public.students_status_derived();

-- 1. An enrolment change recomputes its student (both, if it moved student).
-- SECURITY DEFINER: the change may come from someone who cannot write students
-- under row-level security (a tutor marking a trial), and the status must
-- still follow.
create or replace function public.enrolment_refreshes_student_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update students s set status = derived_student_status(s.id)
   where s.id in (case when tg_op <> 'INSERT' then old.student_id end,
                  case when tg_op <> 'DELETE' then new.student_id end)
     and s.status is distinct from derived_student_status(s.id);
  return null;
end;
$function$;

drop trigger if exists enrolments_refresh_student_status on public.enrolments;
create trigger enrolments_refresh_student_status
  after insert or update or delete on public.enrolments
  for each row execute function public.enrolment_refreshes_student_status();

-- 3. Every student, for the morning job. Returns how many changed.
create or replace function public.refresh_student_statuses()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  update students s set status = derived_student_status(s.id)
   where s.status is distinct from derived_student_status(s.id);
  get diagnostics n = row_count;
  return n;
end;
$function$;
revoke execute on function public.refresh_student_statuses() from public, anon, authenticated;

-- Bring every student into line now.
select public.refresh_student_statuses();

insert into public.test_snapshot_objects (kind, name, ord)
select v.kind, v.name, coalesce((select max(ord) from public.test_snapshot_objects o where o.kind = v.kind), 0) + v.n
  from (values ('function', 'derived_student_status', 1), ('function', 'students_status_derived', 2),
               ('function', 'enrolment_refreshes_student_status', 3), ('function', 'refresh_student_statuses', 4),
               ('trigger', 'students_status_derived', 1), ('trigger', 'enrolments_refresh_student_status', 2)) v(kind, name, n)
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = v.kind and o.name = v.name);

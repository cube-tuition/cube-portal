-- Unify the student status vocabulary to a single field: active, pending, trial,
-- inactive. Supersedes the separate is_active column added in
-- 20260627_students_is_active.sql (dropped here).
--   active   = enrolled & attending
--   pending  = prospective lead (not yet enrolled)
--   trial    = on a trial
--   inactive = left / disenrolled
--
-- Migration of existing values: disenrol → inactive, quit trial → inactive.

-- 1. Remove the is_active machinery (replaced by the unified status).
drop trigger if exists students_sync_is_active on public.students;
drop function if exists public.students_sync_is_active();
alter table public.students drop constraint if exists students_is_active_check;
alter table public.students drop column if exists is_active;

-- 2. Drop the old constraint first so we can remap to the new vocabulary.
alter table public.students drop constraint if exists students_status_check;

-- 3. Migrate existing values.
update public.students set status = 'inactive' where status in ('disenrol', 'quit trial');

-- 4. Add the new constraint.
alter table public.students
  add constraint students_status_check
  check (status = any (array['active', 'pending', 'trial', 'inactive']));

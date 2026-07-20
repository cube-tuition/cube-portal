-- Classes get an active/inactive status. Inactive classes (e.g. a 1:1 whose
-- only student disenrolled) keep their history but drop out of the calendar
-- and are skipped by lesson generation.
alter table classes add column if not exists status text not null default 'active';
alter table classes add constraint classes_status_check check (status in ('active','inactive'));

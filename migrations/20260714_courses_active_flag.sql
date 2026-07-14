-- Active/inactive flag for courses — retire a course without deleting its
-- history (classes/enrolments keep referencing it).
alter table public.courses add column if not exists active boolean not null default true;

-- When each staff member started with CUBE, so the Tutors view can show how
-- long they have been with us. Portal data only begins in Term 2 2026, so this
-- is entered by hand rather than derived.
alter table public.tutors    add column if not exists started_on date;
alter table public.directors add column if not exists started_on date;

-- Free-text student name for ad-hoc lessons added in the explorer (1:1 / level test),
-- which are not tied to a student record.
alter table public.lessons
  add column if not exists student_name text;

-- Free-text notes per student, editable in the database explorer (longtext
-- textarea on the student record).
alter table public.students add column if not exists notes text;

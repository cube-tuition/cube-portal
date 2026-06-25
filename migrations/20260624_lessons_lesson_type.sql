-- Categorise lessons added via the explorer: 1:1 tuition vs a level/placement test.
alter table public.lessons
  add column if not exists lesson_type text;

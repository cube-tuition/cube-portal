-- Level-test marking + feedback report support.
-- Link a level-test lesson to the level test (booklet_builds doc_type='level_test').
alter table public.lessons
  add column if not exists level_test_build_id uuid references public.booklet_builds(id) on delete set null;

-- Per-question marks for a level-test lesson (one student per lesson).
-- question_id is the level test block id (stable within the test).
create table if not exists public.level_test_marks (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   integer not null references public.lessons(id) on delete cascade,
  question_id text not null,
  awarded     numeric,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (lesson_id, question_id)
);

create index if not exists level_test_marks_lesson_idx on public.level_test_marks (lesson_id);

alter table public.level_test_marks enable row level security;
drop policy if exists staff_all on public.level_test_marks;
create policy staff_all on public.level_test_marks
  for all using (is_staff()) with check (is_staff());

-- Practice stream: how hard each question felt, per student.
--
-- Resources becomes a stream of practice questions (no more generated
-- worksheets). After doing a question the student rates it Easy, Medium, Hard
-- or Very hard; it leaves the stream and files under that tab, to revisit.
-- Rating it again (from a tab) moves it. Every rating is kept — the latest one
-- is where the question sits; the rest is the student's history with it.
--
-- PRIVATE to the student: they read and write only their own rows; no staff
-- policy, so tutors and directors cannot read them through the API either
-- (Ryan, Oct 2026). A student may delete their own rating (the Undo button
-- right after rating), and may only rate a question they can actually see.

create table if not exists public.practice_ratings (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  question_id uuid not null references public.qbank_questions(id) on delete cascade,
  rating      text not null check (rating in ('easy', 'medium', 'hard', 'very_hard')),
  rated_at    timestamptz not null default now()
);
create index if not exists practice_ratings_student_idx
  on public.practice_ratings (student_id, question_id, rated_at desc);

alter table public.practice_ratings enable row level security;

drop policy if exists practice_ratings_own_read on public.practice_ratings;
create policy practice_ratings_own_read on public.practice_ratings
  for select to authenticated using (student_id = auth.uid());

drop policy if exists practice_ratings_own_insert on public.practice_ratings;
create policy practice_ratings_own_insert on public.practice_ratings
  for insert to authenticated
  with check (student_id = auth.uid() and public.qbank_question_open_to_student(question_id));

drop policy if exists practice_ratings_own_delete on public.practice_ratings;
create policy practice_ratings_own_delete on public.practice_ratings
  for delete to authenticated using (student_id = auth.uid());

-- Covered by the test snapshot (tests/access.db.test.mjs).
insert into public.test_snapshot_objects (kind, name, ord) values ('table', 'practice_ratings', 30)
on conflict (kind, name) do nothing;

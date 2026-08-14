-- Past paper tracker (Years 11–12): one row per paper a student attempts.
-- Students own their rows; staff can read them (same trust model as the
-- Help Page — a teacher can glance at progress before a lesson).
create table public.past_paper_attempts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null,
  paper        text not null,
  subject      text,
  attempt_date date,
  mark         numeric,
  total        numeric,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index past_paper_attempts_student_idx
  on public.past_paper_attempts (student_id, attempt_date desc);

alter table public.past_paper_attempts enable row level security;

create policy own_attempts on public.past_paper_attempts
  for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

create policy staff_read on public.past_paper_attempts
  for select to authenticated using (is_staff());

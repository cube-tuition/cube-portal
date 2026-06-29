-- Per-report exclusions for the end-of-term report email. A report is uniquely
-- a (term, student, class); a row here means "do NOT attach this report" when
-- emailing the family (e.g. a student who only attended a couple of lessons in
-- one subject). Absence of a row = included (the default).
create table if not exists public.email_report_exclusions (
  id          bigint generated always as identity primary key,
  term_id     uuid not null,
  student_id  uuid not null,
  class_id    bigint not null,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique (term_id, student_id, class_id)
);

alter table public.email_report_exclusions enable row level security;
drop policy if exists staff_all on public.email_report_exclusions;
create policy staff_all on public.email_report_exclusions
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

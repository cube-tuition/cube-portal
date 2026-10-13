-- job_runs: a record of every scheduled job, so a failure gets noticed.
--
-- Until now a cron that failed (or never ran) left no trace anyone looked at:
-- problems were found by people using the portal. Each job now writes one row
-- when it finishes — ok or not, with what it did or the error. The morning job
-- then runs a system check (lib/systemHealth) over these rows, the invoice
-- sync queue and the browser crash log (client_errors), shows the result in
-- the Action Centre's System card, and pushes the directors' phones when
-- something is wrong. The Xero reconcile cron checks that the morning job ran,
-- so a job that dies outright is noticed too.
--
-- Written by the service role only; directors read it.

create table if not exists public.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  ok          boolean not null,
  detail      jsonb,
  error       text
);
create index if not exists job_runs_job_finished_idx on public.job_runs (job, finished_at desc);

alter table public.job_runs enable row level security;
drop policy if exists job_runs_admin_read on public.job_runs;
create policy job_runs_admin_read on public.job_runs
  for select to authenticated using (public.is_admin(auth.uid()));

-- Covered by the test snapshot (tests/access.db.test.mjs checks who reads it).
insert into public.test_snapshot_objects (kind, name, ord) values ('table', 'job_runs', 28)
on conflict (kind, name) do nothing;

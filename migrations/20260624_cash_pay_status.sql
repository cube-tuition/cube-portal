-- Cash pay tracking for the payroll Cash tab.
-- Records whether a cash tutor has been marked paid for a given pay run, and
-- links to the cash_log row created on "mark paid" so unmarking can reverse it.

create table if not exists public.cash_pay_status (
  id           uuid primary key default gen_random_uuid(),
  pay_run_id   uuid not null references public.pay_runs(id) on delete cascade,
  tutor_id     uuid not null references public.tutors(id)   on delete cascade,
  amount       numeric not null default 0,
  cash_log_id  integer references public.cash_log(id) on delete set null,
  paid_at      timestamptz not null default now(),
  paid_by      uuid,
  created_at   timestamptz not null default now(),
  unique (pay_run_id, tutor_id)
);

create index if not exists cash_pay_status_pay_run_idx on public.cash_pay_status (pay_run_id);
create index if not exists cash_pay_status_tutor_idx   on public.cash_pay_status (tutor_id);

alter table public.cash_pay_status enable row level security;

drop policy if exists staff_all on public.cash_pay_status;
create policy staff_all on public.cash_pay_status
  for all using (is_staff()) with check (is_staff());

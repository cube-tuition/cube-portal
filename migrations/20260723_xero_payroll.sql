-- Xero Payroll (AU) link — lets the portal push an approved fortnight into Xero
-- Payroll as a DRAFT pay run. Xero then withholds PAYG, accrues super, and files
-- STP when a human posts the pay run (the portal never posts — draft only).
--
-- Two small admin-only tables:
--   xero_payroll_settings — which Xero pay calendar + ordinary-hours earnings
--                           rate the portal maps hours onto (single row id=1).
--   xero_employee_map     — links each portal tutor/director to a Xero Payroll
--                           employee, so hours land on the right payslip.

create table if not exists public.xero_payroll_settings (
  id                  integer primary key default 1,
  payroll_calendar_id text,          -- Xero PayrollCalendarID (the fortnightly cycle)
  earnings_rate_id    text,          -- Xero EarningsRateID for ordinary hours
  send_rate           boolean not null default false,  -- also push the portal's $/h (else Xero's employee rate wins)
  updated_at          timestamptz not null default now(),
  constraint xero_payroll_settings_singleton check (id = 1)
);
insert into public.xero_payroll_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.xero_employee_map (
  staff_id          uuid primary key,          -- tutors.id or directors.id
  staff_table       text not null,             -- 'tutors' | 'directors'
  xero_employee_id  text not null,             -- Xero EmployeeID
  xero_name         text,                      -- cached display name for the UI
  updated_at        timestamptz not null default now()
);

alter table public.xero_payroll_settings enable row level security;
alter table public.xero_employee_map     enable row level security;

-- Admin-only. API routes use the service-role key (bypasses RLS) and verify the
-- caller with requireApiRole; these policies guard any client-side access.
create policy xps_admin_all on public.xero_payroll_settings
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy xem_admin_all on public.xero_employee_map
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

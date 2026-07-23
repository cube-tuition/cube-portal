-- Xero Payroll catch-up support.
--
-- Problem: Xero pay calendars only open periods forward from the calendar's
-- first period (2026-07-20 here), but approved portal hours can predate it —
-- e.g. the Term 2→3 holiday break (2026-06-29 → 2026-07-19). Those hours must
-- be paid as a CATCH-UP inside the current draft run.
--
-- shifts.xero_pay_run_id — stamped with the Xero pay run a shift's hours were
-- last written into. A shift is excluded from future pushes only once that run
-- is POSTED in Xero; stamps pointing at a draft (re-push refresh) or a deleted
-- run are re-swept, so nothing is lost or double-paid.
--
-- xero_payroll_settings.payroll_from — hard cutoff: shifts before this date are
-- never pushed (they were paid via the old Bills flow). Seeded to 2026-06-29,
-- the first period the new payroll flow owns.

alter table public.shifts add column if not exists xero_pay_run_id text;

alter table public.xero_payroll_settings add column if not exists payroll_from date;
update public.xero_payroll_settings set payroll_from = '2026-06-29' where id = 1 and payroll_from is null;

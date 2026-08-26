-- Payroll RLS tighten — drop the legacy is_staff() catch-alls now that scoped
-- policies exist. Before this, ANY tutor could read and write every shift,
-- pay run and rate-matrix row (policies OR together, so the scoped policies
-- added alongside were decorative).
--
-- What remains after the drop:
--   shifts:            shifts_admin_all (admins full) + shifts_tutor_* (own
--                      rows: select; insert/delete drafts; update draft/submitted)
--   pay_runs:          pay_runs_admin_all
--   tutor_rate_matrix: trm_admin_all + trm_tutor_select (own rates)
--   cash_log:          admin-only (was any staff)
--   cash_pay_status:   admin-only (was any staff)
--
-- Directors verified to carry JWT app_metadata.role = 'admin', so is_admin()
-- covers them. Payroll RPCs are SECURITY DEFINER and unaffected.

drop policy if exists authenticated_full_access on public.shifts;
drop policy if exists authenticated_full_access on public.pay_runs;
drop policy if exists authenticated_full_access on public.tutor_rate_matrix;

drop policy if exists staff_all on public.cash_log;
create policy cash_log_admin_all on public.cash_log
  for all to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

drop policy if exists staff_all on public.cash_pay_status;
create policy cash_pay_status_admin_all on public.cash_pay_status
  for all to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

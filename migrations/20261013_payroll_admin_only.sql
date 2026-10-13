-- Payroll money is admin-only; a tutor sees only their own shifts and rates.
--
-- The blanket authenticated_full_access / staff_all policies (is_staff(), which
-- includes every tutor) gave any tutor full read AND write on the payroll
-- tables through the API — bypassing the portal's admin-only screens and the
-- admin-only approve_* functions. Confirmed on production with a tutor login
-- (rolled back): they could change their own pay rate, read every tutor's
-- rates and all 472 other shifts, create a 10-hour draft shift at $500/h
-- (which approving the pay run would sweep in and pay), and read the pay runs,
-- the cash log and the director balances.
--
-- After this:
--   shifts             admin: everything · tutor: read their own
--   tutor_rate_matrix  admin: everything · tutor: read their own
--   pay_runs, cash_log, director_balances: admin only
--
-- Tutors never write these tables from the portal: class shifts come from
-- marking the roll and drop-in shifts from save_dropin_shift — both SECURITY
-- DEFINER, unaffected — so the tutor insert / update / delete policies on
-- shifts go too. "My pay" and the drop-in page only read the tutor's own rows.
-- Directors sign in with the admin role (is_admin), so nothing changes for them.

drop policy if exists authenticated_full_access on public.shifts;
drop policy if exists shifts_tutor_insert       on public.shifts;
drop policy if exists shifts_tutor_update       on public.shifts;
drop policy if exists shifts_tutor_delete       on public.shifts;
-- kept: shifts_admin_all (is_admin), shifts_tutor_select (own rows)

drop policy if exists authenticated_full_access on public.tutor_rate_matrix;
-- kept: trm_admin_all (is_admin), trm_tutor_select (own rows)

drop policy if exists authenticated_full_access on public.pay_runs;
-- kept: pay_runs_admin_all (is_admin)

drop policy if exists staff_all on public.cash_log;
create policy cash_log_admin_all on public.cash_log
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists staff_all on public.director_balances;
create policy director_balances_admin_all on public.director_balances
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

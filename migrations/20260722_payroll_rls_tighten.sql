-- Payroll RLS tighten — remove the blanket staff-wide policies that let any
-- tutor read/write payroll tables directly, defeating the scoped policies.
--
-- Permissive policies OR together, so `authenticated_full_access` (is_staff())
-- on shifts / pay_runs / tutor_rate_matrix made the careful per-tutor policies
-- (own rows, draft-only) meaningless: any logged-in tutor could update another
-- tutor's rate_snapshot, the rate matrix, or a pay run.
--
-- After this migration the intended model holds:
--   shifts            admin: all · tutor: select own; insert/update/delete own drafts
--   pay_runs          admin only (tutors never query pay_runs; My Pay computes
--                     periods client-side)
--   tutor_rate_matrix admin: all · tutor: select own rates
--   cash_log          admin only (accounting pages are admin-gated)
--   cash_pay_status   admin only (payroll cash panel is admin-gated)
--
-- Safe because: both directors carry JWT app_metadata.role = 'admin' (so
-- is_admin() passes for everyone who runs payroll/accounting), the
-- attendance→shift and dropin→shift triggers plus ensure/approve/export RPCs
-- are all SECURITY DEFINER (unaffected by RLS), and pay_run_shifts /
-- current_tutor_rates are security_invoker views (RLS applies through them).

drop policy if exists authenticated_full_access on public.shifts;
drop policy if exists authenticated_full_access on public.pay_runs;
drop policy if exists authenticated_full_access on public.tutor_rate_matrix;

-- cash_log / cash_pay_status only had the blanket staff policy — replace it
-- with admin-only rather than leaving them policy-less (which would lock the
-- admin pages out too).
drop policy if exists staff_all on public.cash_log;
create policy cash_log_admin_all on public.cash_log
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists staff_all on public.cash_pay_status;
create policy cash_pay_status_admin_all on public.cash_pay_status
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

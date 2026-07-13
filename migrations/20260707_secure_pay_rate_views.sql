-- Secure the two payroll/rate views.
--
-- Problem: `current_tutor_rates` and `pay_run_shifts` were SECURITY DEFINER
-- views (the Postgres default) with SELECT granted to `anon` and
-- `authenticated`. Because a SECURITY DEFINER view runs with the view owner's
-- privileges, it BYPASSED row-level security on the underlying
-- `tutor_rate_matrix` / `shifts` tables. Result: any logged-in student — and
-- anyone holding the public anon key — could read every tutor's hourly pay
-- rate and every shift's pay amount via PostgREST.
--
-- Fix:
--   1. security_invoker = on  → the view now runs with the CALLER's rights, so
--      the existing RLS on tutor_rate_matrix/shifts applies. Staff (is_staff())
--      still see all rows; tutors see their own; students/anon see nothing.
--      Service-role API routes are unaffected (service_role bypasses RLS).
--   2. Revoke anon access entirely; leave authenticated with SELECT only
--      (writes were inert anyway — these views are not updatable).

alter view public.current_tutor_rates set (security_invoker = on);
alter view public.pay_run_shifts     set (security_invoker = on);

revoke all on public.current_tutor_rates from anon, authenticated;
revoke all on public.pay_run_shifts     from anon, authenticated;

grant select on public.current_tutor_rates to authenticated;
grant select on public.pay_run_shifts     to authenticated;

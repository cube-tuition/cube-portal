-- Lock down pre/post test RLS.
--
-- Problem: both tables carried allow-all policies applied out-of-band (they are
-- in no migration file):
--
--   prepost_scores_write / prepost_tests_write : FOR ALL  USING (true) WITH CHECK (true)
--   prepost_scores_read  / prepost_tests_read  : FOR SELECT USING (true)
--
-- Postgres ORs permissive policies together, so these `true` policies nullified
-- the `authenticated_full_access` (is_staff()) policy on the same tables. Any
-- authenticated student could read EVERY student's pre/post assessment scores
-- and INSERT/UPDATE/DELETE any row — cross-student PII disclosure plus silent
-- grade tampering.
--
-- Fix: drop the four allow-all policies. Staff access is already provided by
-- the existing `authenticated_full_access` policy (is_staff() for ALL), which
-- covers every read/write path in the app — the only consumers are
-- components/PrePostSection.js and components/resources/PreTestsPanel.js, both
-- rendered exclusively from staff-only pages under app/tutor/**.
--
-- We additionally grant students read access to their OWN scores, matching the
-- established pattern on sibling grade tables (results, quiz_results,
-- attendance, term_comments). prepost_tests holds class-level teaching targets
-- (expected_pre/expected_post) with no student_id, so it stays staff-only.

drop policy if exists prepost_scores_write on public.prepost_scores;
drop policy if exists prepost_scores_read  on public.prepost_scores;
drop policy if exists prepost_tests_write  on public.prepost_tests;
drop policy if exists prepost_tests_read   on public.prepost_tests;

create policy prepost_scores_student_read
  on public.prepost_scores
  for select
  to authenticated
  using (auth.uid() = student_id);

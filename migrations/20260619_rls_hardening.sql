-- =====================================================================
-- RLS hardening migration  (CUBE portal)
-- Closes two critical issues found in the security assessment:
--   1. 26 public tables had RLS disabled  -> exposed to the anon key.
--   2. A blanket `authenticated_full_access USING(true)` policy let ANY
--      logged-in user read/write everything (overriding granular policies).
--
-- Helper functions (already present): is_staff() = role in (admin,tutor),
-- is_admin() = role = admin. Server API routes use the service role, which
-- bypasses RLS and is therefore unaffected by this migration.
--
-- Tested via rolled-back transactions simulating anon / student / tutor /
-- admin JWTs before applying to production.
-- =====================================================================

-- ---- 1. Staff-only tables: enable RLS + staff full access ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cash_log','class_booklet_assignments','exam_marks','fixed_costs','guardians',
    'lesson_cancellations','ops_tasks','portal_settings','qbank_exam_sections',
    'qbank_exam_slots','qbank_exams','qbank_skills','qbank_subjects','qbank_topics',
    'qbank_worksheet_usage','qbank_worksheets','skills','teacher_availability',
    'term_transitions','topics','trial_submissions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS staff_all ON public.%I', t);
    EXECUTE format('CREATE POLICY staff_all ON public.%I FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())', t);
  END LOOP;
END $$;

-- ---- 2. qbank question content: staff write, any logged-in user reads -----
--      (students read these on /resources; joins need parts + images too)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['qbank_questions','qbank_question_parts','qbank_question_images'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS staff_all ON public.%I', t);
    EXECUTE format('CREATE POLICY staff_all ON public.%I FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())', t);
    EXECUTE format('DROP POLICY IF EXISTS read_authenticated ON public.%I', t);
    EXECUTE format('CREATE POLICY read_authenticated ON public.%I FOR SELECT TO authenticated USING (true)', t);
  END LOOP;
END $$;

-- ---- 3. API-only tables: enable RLS (only the service role touches them) --
ALTER TABLE public.xero_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_item_mappings ENABLE ROW LEVEL SECURITY;

-- ---- 4. Remove the blanket policy from EVERY table that has it -----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_policies
           WHERE schemaname='public' AND policyname='authenticated_full_access' LOOP
    EXECUTE format('DROP POLICY authenticated_full_access ON public.%I', r.tablename);
  END LOOP;
END $$;

-- ---- 5. Tables left with no policy after the drop: add staff access -------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['booklet_builds','directors','invoices','qbank_rubrics','tutors'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_all ON public.%I', t);
    EXECUTE format('CREATE POLICY staff_all ON public.%I FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())', t);
  END LOOP;
END $$;
-- xero_tokens: only the service role uses it -> leave RLS on with no policy.

-- ---- 6. Replace the over-permissive "manage" policy on term_criteria -----
DROP POLICY IF EXISTS "Authenticated users can manage term_criteria" ON public.term_criteria;
DROP POLICY IF EXISTS staff_all ON public.term_criteria;
CREATE POLICY staff_all ON public.term_criteria FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

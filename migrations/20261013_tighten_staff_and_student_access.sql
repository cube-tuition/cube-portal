-- Least privilege for tutors and students, enforced by the database.
--
-- The portal's screens were locked down, the tables underneath were not: any
-- signed-in user can call the API directly with the public key and their own
-- session, so a table's policies — not the page — decide what they can do.
--
-- 1. TUTORS (is_staff() includes every tutor) could write the money and family
--    tables: edit or credit invoices, change enrolment and course prices, fixed
--    costs, cash-pay records, student and guardian details, director records
--    and portal settings. No tutor screen writes any of them (checked page by
--    page; class rolls, lesson notes, drop-ins and level tests write other
--    tables or go through SECURITY DEFINER functions). Now:
--      invoices, student_credits, fixed_costs, cash_pay_status  admin only
--        (a student still reads their own credits)
--      enrolments, students, guardians, directors   staff read, admin write
--        (students still read their own rows)
--      courses                                      read by all, admin write
--      portal_settings  admin; a tutor reads/writes only their own chat pins
--        and the two level-test email templates the level-test page edits.
--
-- 2. STUDENTS could read every lesson (1,018 rows: other classes' teacher
--    notes, report comments, the names of other students' 1:1s and makeups),
--    every exam question with its solution (the practice page downloaded all
--    2,873 questions and hid the 920 exam-only ones in the browser), and could
--    edit or delete online_resources and stimulus_texts. Now a student reads
--    the lessons of classes they are enrolled in and their own makeups, only
--    practice (non-exam) questions, and nothing of the other two tables.

-- ── Money: admin only ───────────────────────────────────────────────────────
drop policy if exists authenticated_full_access on public.invoices;
create policy invoices_admin_all on public.invoices
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists authenticated_full_access on public.student_credits;
drop policy if exists "Staff manage student_credits" on public.student_credits;
create policy student_credits_admin_all on public.student_credits
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
-- kept: "Students read own credits"

drop policy if exists staff_all on public.fixed_costs;
create policy fixed_costs_admin_all on public.fixed_costs
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists staff_all on public.cash_pay_status;
create policy cash_pay_status_admin_all on public.cash_pay_status
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ── Family records: staff read, admin write ─────────────────────────────────
drop policy if exists authenticated_full_access on public.enrolments;
drop policy if exists "Staff insert enrolments" on public.enrolments;
drop policy if exists "Staff update enrolments" on public.enrolments;
drop policy if exists "Staff delete enrolments" on public.enrolments;
create policy enrolments_admin_all on public.enrolments
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
-- kept: "Staff read all student_classes", "Students can view their own class links"

drop policy if exists authenticated_full_access on public.students;
-- kept: "Admin write students", "Staff read all students", "Students see own profile"

drop policy if exists staff_all on public.guardians;
create policy guardians_staff_read on public.guardians
  for select to authenticated using (public.is_staff());
create policy guardians_admin_all on public.guardians
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists authenticated_full_access on public.directors;
create policy directors_staff_read on public.directors
  for select to authenticated using (public.is_staff());
create policy directors_admin_all on public.directors
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists authenticated_full_access on public.courses;
-- kept: courses_write_admin, courses_read_authenticated, courses_public_read

-- ── Portal settings ─────────────────────────────────────────────────────────
drop policy if exists staff_all on public.portal_settings;
create policy portal_settings_admin_all on public.portal_settings
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy portal_settings_staff_own_keys on public.portal_settings
  for all to authenticated
  using (public.is_staff() and key in ('chat_pins:' || auth.uid(), 'level_test_email_template', 'level_test_family_email_template'))
  with check (public.is_staff() and key in ('chat_pins:' || auth.uid(), 'level_test_email_template', 'level_test_family_email_template'));

-- ── Lessons: a student sees their own classes and makeups ───────────────────
drop policy if exists lessons_read_authenticated on public.lessons;
create policy lessons_student_read on public.lessons
  for select to authenticated
  using (makeup_student_id = auth.uid()
         or exists (select 1 from public.enrolments e
                     where e.class_id = lessons.class_id and e.student_id = auth.uid()));
-- kept: authenticated_full_access (staff), lessons_write_admin

-- ── Question bank: students get practice questions, never exam ones ─────────
drop policy if exists read_authenticated on public.qbank_questions;
create policy qbank_questions_read on public.qbank_questions
  for select to authenticated
  using (public.is_staff() or coalesce(audience, 'student') <> 'exam');

drop policy if exists read_authenticated on public.qbank_question_parts;
create policy qbank_question_parts_read on public.qbank_question_parts
  for select to authenticated
  using (public.is_staff() or exists (select 1 from public.qbank_questions q
          where q.id = qbank_question_parts.question_id and coalesce(q.audience, 'student') <> 'exam'));

drop policy if exists read_authenticated on public.qbank_question_images;
create policy qbank_question_images_read on public.qbank_question_images
  for select to authenticated
  using (public.is_staff() or exists (select 1 from public.qbank_questions q
          where q.id = qbank_question_images.question_id and coalesce(q.audience, 'student') <> 'exam'));

-- ── Staff resources: staff only (the policy said `true` — anyone signed in) ─
drop policy if exists staff_all on public.online_resources;
create policy staff_all on public.online_resources
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists staff_all on public.stimulus_texts;
create policy staff_all on public.stimulus_texts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS hardening — APPLIED to production (verified-safe variant of
-- 20260619_rls_hardening.sql, which was never run in prod).
--
-- Closed two critical exposures:
--   1. 27 public tables had RLS DISABLED, and the public `anon` role held full
--      privileges → anyone with the browser-embedded anon key could read/write
--      guardian PII, student grades, financials, etc.
--   2. A blanket `authenticated_full_access USING(true)` policy on ~33 tables let
--      ANY logged-in user (including students) read/write everything — including
--      `students` PII, `invoices`, `tutors`, `shifts`, and `xero_tokens`.
--
-- Safe-by-construction approach: staff (admin/tutor/director) retain full access
-- via is_staff(), so no app flow breaks; students keep only their granular
-- per-row policies ("see own …"); anon is denied everywhere. Verified that no
-- student-facing page reads any of the now-staff-only tables before applying.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. Future-proof is_staff() to include director (broadening only — safe).
create or replace function public.is_staff() returns boolean
  language sql stable security definer as $fn$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','tutor','director'), false)
$fn$;

-- 1. Tables that had RLS DISABLED (anon-exposed) → enable RLS + staff-only.
do $$
declare t text;
begin
  foreach t in array array[
    'cash_log','class_booklet_assignments','exam_marks','exam_question_marks','fixed_costs','guardians',
    'lesson_cancellations','ops_tasks','portal_settings','qbank_exam_sections',
    'qbank_exam_slots','qbank_exams','qbank_skills','qbank_subjects','qbank_topics',
    'qbank_worksheet_usage','qbank_worksheets','skills','teacher_availability',
    'term_transitions','topics','trial_submissions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

-- 2. qbank question content: staff write, any authenticated read (students read on /resources).
do $$
declare t text;
begin
  foreach t in array array['qbank_questions','qbank_question_parts','qbank_question_images'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('drop policy if exists read_authenticated on public.%I', t);
    execute format('create policy read_authenticated on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- 3. API-only tables: enable RLS (only the service role touches them).
alter table public.xero_settings      enable row level security;
alter table public.xero_item_mappings enable row level security;

-- 4. Narrow the blanket policy from USING(true) to staff-only everywhere it
--    exists. xero_tokens is server-role-only → drop the policy entirely.
do $$
declare r record;
begin
  for r in select tablename from pg_policies
           where schemaname='public' and policyname='authenticated_full_access' loop
    execute format('drop policy authenticated_full_access on public.%I', r.tablename);
    if r.tablename <> 'xero_tokens' then
      execute format('create policy authenticated_full_access on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', r.tablename);
    end if;
  end loop;
end $$;

-- 5. Replace the over-permissive manage policy on term_criteria.
drop policy if exists "Authenticated users can manage term_criteria" on public.term_criteria;

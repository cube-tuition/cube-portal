# RLS Hardening Plan — for review (nothing applied yet)

**Status:** DRAFT. No RLS change has been made. This is a proposal for your approval.

## The problem

26 tables have Row Level Security **disabled**. With RLS off, anyone holding the
public `anon` key (which ships in the browser bundle) can read or write every row
in these tables **without logging in**:

```
topics, class_booklet_assignments, skills, guardians, xero_settings,
xero_item_mappings, trial_submissions, portal_settings, lesson_cancellations,
exam_marks, fixed_costs, cash_log, teacher_availability,
qbank_subjects, qbank_topics, qbank_skills, qbank_questions,
qbank_question_parts, qbank_question_images, qbank_exams, qbank_exam_sections,
qbank_exam_slots, qbank_worksheet_usage, qbank_worksheets,
term_transitions, ops_tasks
```

The most sensitive here are **guardians** (parent names / phone / email — PII) and
the finance tables (**cash_log, fixed_costs, xero_settings, exam_marks**).

## How the already-protected tables work

The RLS-enabled tables use a permissive policy `authenticated_full_access`
(`ALL` to `authenticated`, `using true / with check true`) alongside helper
functions that already exist in the database:

- `is_staff()` — true for tutors/admins/directors
- `is_admin(auth.uid())` — true for admins/directors

So today the real boundary is **anonymous vs. logged-in**: protected tables are
closed to anon, but any *logged-in* user has full access. The disabled tables are
open even to anon.

## Important carve-out before enabling anything

`trial_submissions` is written by the **public website trial form**, where the
submitter is **not logged in** (anon). If we enable RLS without an anon-insert
policy, the website form breaks. Any other table the public website reads with the
anon key needs a matching anon-select policy — these must be confirmed against the
website code before Phase 2.

## Phase 1 — close the anonymous hole (recommended first; non-breaking)

Enable RLS on all 26 tables and add the **same** `authenticated_full_access`
policy they protected tables already use. This changes **nothing** for logged-in
portal users (tutors/admins keep full access) but immediately stops anonymous
anon-key access. Plus the one carve-out for the public form.

```sql
-- Pattern, repeated per table:
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY authenticated_full_access ON public.<table>
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Carve-out: let the public website keep submitting trials
ALTER TABLE public.trial_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY authenticated_full_access ON public.trial_submissions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_insert_trial ON public.trial_submissions
  FOR INSERT TO anon WITH CHECK (true);
```

Rollback for any table: `DROP POLICY ... ; ALTER TABLE ... DISABLE ROW LEVEL SECURITY;`

**Risk:** low. The only way Phase 1 breaks a flow is if some portal action runs
against these tables with the anon key while *not* logged in. The trial form is
the known case (handled). We should grep the website for anon reads/writes to the
content tables (`portal_settings`, `info_pages`, `faq_*`, `topics`, `skills`)
before applying.

## Phase 2 — least-privilege tightening (after per-flow testing)

Replace the blanket `authenticated_full_access` with role-scoped policies so a
logged-in *student* can't read finance/PII or write the question bank.

| Table group | Read | Write |
|---|---|---|
| Finance/internal: `cash_log`, `fixed_costs`, `xero_settings`, `xero_item_mappings`, `exam_marks`, `lesson_cancellations`, `term_transitions`, `ops_tasks`, `teacher_availability` | `is_staff()` | `is_staff()` (delete `is_admin()`) |
| PII: `guardians` | `is_staff()` | `is_staff()` |
| Question bank: `qbank_*` | `authenticated` (students practise) | `is_staff()` |
| Content: `topics`, `skills`, `class_booklet_assignments`, `portal_settings` | `authenticated` (+ `anon` where the website needs it) | `is_staff()` |
| `trial_submissions` | `is_staff()` | `anon` INSERT + `is_staff()` update |

Each table must be tested against the real workflow (tutor explorer edits, student
practice, payroll, invoicing, website) before its policy is tightened — which is
why Phase 2 is staged per table, not a single migration.

## Suggested rollout

1. You approve Phase 1.
2. I grep the website + portal for anon-key reads/writes to these tables and
   confirm the carve-outs.
3. Apply Phase 1 as one additive migration (with the rollback above).
4. Tighten Phase 2 table-by-table, testing each workflow, on your go-ahead.

No policy, migration, or data change happens without your explicit approval.

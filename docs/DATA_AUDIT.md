# CUBE Tuition — Operational Database Audit
**Date:** 2026-06-12 · **Scope:** Supabase project `CUBE-student-portal` + `cube-portal` admin app
**Stance:** Conservative. No schema changed, no data changed, no feature removed.

---

## 1. Current structure (Phase 1)

56 tables in `public`. Grouped by domain:

| Domain | Tables | State |
|---|---|---|
| People | `students`, `guardians`, `tutors`, `directors` | Solid PKs (uuid). **No `families` table** — `students.family_id:int4` is a bare number with no FK target. `guardians.student_id` is **text**, not uuid, no FK. |
| Programme | `courses`, `classes`, `terms`, `enrolments` | Good FKs (`classes→courses/terms`, `enrolments→students/classes` + unique (student,class)). `classes.teacher` is **free text**, not a tutor FK. |
| Delivery | `lessons`, `attendance`, `sub_assignments`, `dropin_*` | Good FK coverage and unique indexes. `lessons.main_teacher` free text; `lessons.start_time/end_time` are text. `attendance`/`quiz_results` deliberately hidden from the explorer sidebar. |
| Assessment | `exam_marks`, `exams`, `results`, `prepost_*`, `quiz_results`, `topics`, `skills`, `qbank_*` | `exam_marks.topic/section` are text (by design, keyed in a unique index). Legacy duo `exams`/`results` barely used. Two parallel topic/skill systems: `topics`/`skills` (int PK) vs `qbank_topics`/`qbank_skills` (uuid). |
| Finance | `invoices`, `student_credits`, `lesson_cancellations`, `cash_log`, `fixed_costs`, `referrals`, `xero_*` | Strong. `invoices.family_id` has indexes but no FK (no families table). Status columns are unconstrained text. |
| Payroll | `shifts`, `pay_runs`, `pay_run_shifts`, `tutor_rate_matrix`, `current_tutor_rates` (view-like), `teacher_availability` | Good unique indexes. `pay_run_shifts` has **no PK constraint enforced** (all cols nullable). |
| Pipeline | `trial_submissions` | Rich, well-indexed, converts into `students`/`enrolments` via FKs. Guardian info duplicated as flat text (`parent_name/email/phone`). |
| Content/Config | `booklets`, `class_booklets`, `class_booklet_assignments`, `info_pages`, `faq_*`, `portal_settings` | Fine. |

Frontend: the admin Database Explorer (`app/tutor/database/page.js`, ~5.2k lines) is the main editing surface — inline cell editing, virtual joins (guardians into students, names into enrolments/lessons/invoices), drag/hide/resize columns, undo stack, add/delete rows, DDL via `/api/exec-ddl` (service role). Table names are centralised in `lib/tables.js`.

## 2. Fragile operational areas (Phase 2) — found in live data

1. **`students.year` is text and already dirty**: one student has `"12\n"` (trailing newline) — will silently fail year filters. One Year 4 student exists but the form dropdown starts at 5.
2. **Gender drift in progress**: DB stores `M`/`F`, but the Add Student modal inserted `Male`/`Female`/`Non-binary`/`Prefer not to say` → every new student would break gender consistency. *(Fixed in this pass — form now writes `M`/`F`/`Other`/`Unknown`.)*
3. **`guardians.student_id` is text, no FK**: 1 orphaned guardian row exists today; nothing prevents more.
4. **No `families` table**: `students.family_id` / `invoices.family_id` point at nothing. Sibling linking works by sharing an int. 29 students have no family_id.
5. **`classes.teacher` free text**: 0 of 33 class teacher values match a `tutors.full_name` exactly (initials/short names used). `lessons.main_teacher` same problem (11 distinct unmatched names). Payroll/sub logic that compares names is fragile. `lessons.scheduled_teacher_id` (uuid FK-style) is the right pattern — already used for subs.
6. **Empty string vs NULL**: 40 students have `''` in email/phone/school/year.
7. **8 guardian emails fail basic format validation.**
8. **Unconstrained status text** on `students.status`, `enrolments.status`, `invoices.status/payment_status/delivery_status`, `lessons.status`, `attendance.status`, `trial_submissions.status` — UI dropdowns exist for some, DB accepts anything. Explorer dropdown for `enrolments.status` includes `trial complete` but live data only uses `active/trial`; `invoices.payment_status` is NULL on 125 of 126 rows (only newly-touched rows get a value).
9. **2 enrolments have NULL student_id or class_id** (orphan-ish; status still counts them).
10. **RLS off** on: `cash_log`, `exam_marks`, `lesson_cancellations`, `guardians`, `trial_submissions`, `qbank_*`, `skills`, `topics`, `teacher_availability`, `fixed_costs`, `portal_settings`, `xero_item_mappings`, `xero_settings`, `class_booklet_assignments`. Several contain personal/financial data (guardians, trial_submissions, exam_marks, cash_log). Not weakened by this pass — flagged for review.
11. **`/api/exec-ddl`** allows arbitrary DDL from the explorer (drop table/column from the UI). Powerful but the riskiest surface in the system.
12. **Duplicated derived data**: `pay_run_shifts.tutor_name` snapshot text; `xero_item_mappings.class_name` keyed on class *name* (breaks if a class is renamed).
13. Times stored as text (`classes.start_time/end_time`, `lessons.start_time/end_time`) — format consistent today (`HH:MM`) but unenforced.

## 3. Recommended model vs current (Phase 3)

| Recommendation | Status | Rating |
|---|---|---|
| `families` table (id, name, notes); FK `students.family_id`, `invoices.family_id` → it | Missing | **Safe with migration** (additive: create table, backfill from distinct family_ids, then add FKs) |
| `guardians.student_id` → uuid + FK to students | Wrong type | **Safe with migration** (all 16 rows except 1 orphan cast cleanly; fix/park the orphan first) |
| `classes.tutor_id uuid FK` alongside `classes.teacher` (keep text as display fallback) | Missing | **Safe with migration** (additive column; backfill by name-mapping table; do NOT drop `teacher`) |
| `lessons`: prefer `scheduled_teacher_id`; treat `main_teacher` as derived/read-only | Partially done | **Safe now** (explorer already renders main_teacher read-only) |
| CHECK constraints / enums on status columns | Missing | **Risky now** (legacy values like `quit trial`, NULL payment_status would violate) → enforce in UI metadata first (done), DB CHECKs later after data cleanup |
| `students.year` → controlled values K–12 | Text, dirty | **Safe now in UI** (dropdown exists; quality page flags `12\n`); DB CHECK = future |
| Normalise trial_submissions guardian fields into guardians on conversion | Flat text | **Future improvement** |
| Merge `topics`/`skills` with `qbank_topics`/`qbank_skills` | Two systems | **Risky** — both actively used; leave |
| Retire legacy `exams`/`results` | Near-unused | **Future improvement** (deprecate, don't drop) |
| PK + FKs on `pay_run_shifts` | Missing | **Safe with migration** |
| `timestamptz` defaults `now()` everywhere `created_at` exists | Mostly present | Safe with migration where missing |
| RLS on personal-data tables currently without it | Missing | **Requires approval** — needs policy design matching current anon/service-role usage, otherwise pages break |
| Restrict `/api/exec-ddl` to an allowlist of statement shapes | Open | **Requires approval** (could break explorer features directors rely on) |

Data fixes worth one-time approval (single UPDATEs, reversible, logged): trim `students.year='12\n'` → `'12'`; convert `''` → NULL on students contact fields; repair/remove the 1 orphaned guardian; decide on the 2 enrolments with NULL student/class.

## 4. What was implemented in this pass (Phases 4–7) — code only

1. **`lib/tableMeta.js` (new)** — central table/column metadata layer: display labels, field types, required flags, read-only flags, hidden-by-default columns, dropdown options, linked-record definitions, validation rules (email/phone/integer/numeric/date/time), help text, deprecation notes. Single source of truth; the explorer consumes it with full fallback to its previous hardcoded behaviour.
2. **Database Explorer wiring** (`app/tutor/database/page.js`, surgical edits):
   - Dropdown editors now come from metadata (superset of the old `CELL_DROPDOWNS`, which is kept as fallback). Adds dropdowns for `students.gender`, `classes.day_of_week`, `lessons.status`, `enrolments.next_term_status`, `attendance.status`, etc.
   - **Soft validation on save**: invalid email/phone/number/date/off-list values trigger a confirm dialog ("save anyway?") — warnings, never blocks or rewrites.
   - **Hidden-by-default system columns**: first visit to a table hides system/internal columns (e.g. `created_at`, xero ids) via metadata; users can unhide as before, and saved layouts are untouched.
   - **Director-friendly header labels + tooltips**: headers show the metadata label with the raw column name and help text in the tooltip. Required columns show `*`.
   - **Add Student modal**: gender now saves `M/F/Other/Unknown` (matching existing data), added Year dropdown (K–12), soft email/phone validation.
   - Toolbar link to the new Data Quality page.
3. **`app/tutor/database/quality/page.js` (new)** — read-only Data Quality dashboard (admin-gated like the explorer): duplicate students/guardians, orphaned guardians/enrolments, invalid emails/phones, empty-string-vs-NULL, off-list status/year values, class teachers not matching tutor records, students without family links. Warnings only — no auto-fix.

## 5. Deliberately NOT changed

- No table/column renamed, dropped, or retyped. No data modified. No migration applied.
- `CELL_DROPDOWNS`, undo stack, localStorage layouts, virtual joins, DDL tools, all routes — untouched in behaviour.
- RLS policies untouched (flagged only).
- Legacy/redundant columns (`classes.teacher`, `lessons.main_teacher`, `pay_run_shifts.tutor_name`, `exams`/`results`, `students.year` text type) kept; marked *deprecated/derived* in metadata only.
- The `quit trial` and other legacy status values remain valid options so old rows still render and save.

## 6. Suggested future schema migrations (ordered, all additive)

1. `families` table + backfill + FKs (`students.family_id`, `invoices.family_id`).
2. `guardians.student_id` text→uuid + FK (after fixing 1 orphan).
3. `classes.tutor_id uuid REFERENCES tutors(id)` + backfill mapping; UI switches to linked record; keep `teacher` text.
4. PK/FKs on `pay_run_shifts`.
5. One-time data hygiene UPDATEs (year trim, ''→NULL) — after sign-off.
6. CHECK constraints on status columns — only after quality page shows zero off-list values.
7. RLS for `guardians`, `trial_submissions`, `exam_marks`, `cash_log` — needs policy design session.

## Addendum (2026-06-12, user-approved changes after the audit)

- Deleted orphaned test guardian row (id 29, "t t"); guardians table added to explorer sidebar.
- Families view added to guardians explorer (display layer only).
- Voided 39 duplicate/stale Term 2 2026 draft invoices (all draft + unsent; reversible).
- **Bug fixed** in `app/api/generate-draft-invoices/route.js`: number-vs-string key mismatch made the duplicate-skip check never match families → duplicate family invoices on every run. Keys now coerced to strings; also blocks family invoices when a member already has a solo invoice for the term.
- **Migration applied** (`invoice_uniqueness_guards`): partial unique indexes — one live invoice per (term, family) and per (term, solo student); voided and top-up invoices exempt. Verified to reject duplicate inserts.

## 7. Testing checklist (Phase 8)

- [ ] `npm run build` passes — run locally; in this pass all changed files were verified with the Next.js SWC parser + ESLint (zero new errors; the 18 pre-existing lint problems in `page.js` are unchanged)
- [ ] /tutor/database loads; sidebar groups + live row counts render
- [ ] Students table: data + Directory card views, guardian join columns editable
- [ ] Add Student modal saves (check gender lands as M/F in DB); Year saves
- [ ] Inline edit on students.year/status shows dropdown; saving an email field with bad format asks for confirmation but allows saving
- [ ] Classes: enrol popover, Add Class, Roll over term
- [ ] Lessons: term/class filters, Generate Lessons, scheduled_teacher dropdown, cancel + undo cancellation
- [ ] Hidden column chips bar; double-click header hides; layouts persist after reload
- [ ] Ctrl/Cmd+Z undo for cell edits and row add/delete
- [ ] Row search filter
- [ ] /tutor/database/quality loads, runs checks, shows warnings, changes nothing
- [ ] Invoices page, Xero push, trials page, payroll/transition unaffected (no files touched)

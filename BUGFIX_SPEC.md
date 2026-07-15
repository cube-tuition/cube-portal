# CUBE Portal — Bug-fix spec (handover for Claude Code)

This spec lists bugs found while debugging the portal. Each item has the
symptom, root cause, affected files, the fix, and acceptance criteria.

Work in the `cube-portal` repo. Database is Supabase (project `iettanbjjnsmhgoulnzo`).
After code changes, the app must be redeployed; DB changes should be added as
migration files under `migrations/` (and applied).

---

## 0. Context already addressed in a prior session (verify, don't redo)

These were already fixed and (mostly) pushed/applied. Confirm they're committed
and deployed; only re-touch if a regression appears.

- **Cross-term class duplication** scoped to current/selected term in:
  `app/tutor/page.js` (dashboard), `app/tutor/booklets/page.js` (curriculum),
  `app/tutor/reports/page.js`, `components/home/CommandPalette.js`.
  `app/tutor/classes/page.js` was already term-scoped.
- **`is_staff()` RLS function** rewritten to also resolve staff from the
  `directors`/`tutors` tables via `auth.uid()`/email (not only the JWT
  `app_metadata.role` claim). Applied directly to the live DB — **not yet a
  migration file** (see Bug 5).
- **Exam/level-test "0 questions"**: ambiguous PostgREST embeds pinned to the
  direct FK in `lib/examMarking.js` and `lib/levelTest.js` (see Bug 2 for the
  underlying pattern). Needs deploy.
- **Makeup double-booking guards** added in `app/tutor/database/page.js`
  (`saveMakeupOneToOne`, `saveMakeupMove`).

---

## Bug 1 — Stale `tutor` role granted ex-students staff access (RESOLVED, needs guard)

**Severity:** High (privilege escalation / data exposure)

**Status:** Data fixed in the live DB; code guard still recommended.

**Symptom (latent):** Two **inactive ex-student** accounts carried
`app_metadata.role = 'tutor'`, so `is_staff()` returned true for them — they
could have logged in and read staff-only data (qbank, exams, student PII,
invoices). They were not in `tutors`/`directors`/`students` and had **never
signed in**, so no access actually occurred.

- `hamzeymarouk@cubetuition.com`
- `oliverjin@cubetuition.com`

**Fix applied:** Their `auth.users.raw_app_meta_data.role` was set to `student`
(verified: `is_staff()` now false for them; no remaining staff-role auth user
lacks a `directors`/`tutors` row).

**Still recommended (for Claude Code):**
1. **Deactivation should revoke the role.** When a tutor/student is made inactive
   or removed, demote their `app_metadata.role` (and ideally disable the auth
   user) so staff access can't be retained. Add this to whatever flow toggles
   `tutors.active` / student status, or as a periodic reconciliation job.
2. **Reconciliation/guard:** a check (job or admin screen) that flags any
   `app_metadata.role in ('admin','tutor','director')` whose user has no matching
   `directors`/`tutors` row. Should always be empty.
3. Optionally hard-delete the two orphaned, never-signed-in auth accounts
   entirely (they aren't linked to any record).

**Acceptance:** No auth user has a staff role without a matching staff-table row;
deactivating staff revokes their role automatically.

---

## Bug 2 — Supabase reads silently swallow errors (hid the exam outage for days)

**Severity:** High (turns hard failures into invisible "empty" states)

**Symptom:** The class Exam tab showed "0 questions" with no error for days,
even though the data existed. Same risk exists anywhere this pattern is used.

**Root cause:** Calls like `const { data } = await supabase…` destructure only
`data` and ignore `error`. When a query fails (e.g. an ambiguous embed after the
`qbank_question_multi_tags` migration added junction tables that created a second
`qbank_questions → qbank_subtopics`/`qbank_skills` relationship path), `data` is
`null`, the error is dropped, and the UI renders an empty result. The specific
embed break was fixed in `lib/examMarking.js` / `lib/levelTest.js` by pinning to
the direct FK:
`qbank_subtopics!qbank_questions_subtopic_id_fkey(qbank_topics(name))` and
`qbank_skills!qbank_questions_skill_id_fkey(qbank_topics(name))`.

**Fix:**
1. Audit `const { data } = await supabase…` usages on **critical read paths**
   (exam marking, reports, attendance, marks, qbank, invoices) and capture
   `error`; throw or surface it instead of rendering empty.
2. Prefer a small shared helper, e.g. `selectOrThrow(query)`, used by the data
   layer (`lib/examMarking.js`, `lib/levelTest.js`, `lib/qbank.js`, report
   loaders) so a failed query produces a visible error, never a false "empty".
3. Any other embedded select that traverses `qbank_questions → qbank_subtopics`
   or `→ qbank_skills` must use the FK-pinned form (a repo-wide grep for
   `qbank_subtopics(` / `qbank_skills(` currently shows only the two already
   fixed — re-check after any new code).

**Acceptance:** A forced query error on the exam tab shows an error message, not
"0 questions". No critical read ignores `error`.

---

## Bug 3 — Remaining cross-term duplicate class lists

**Severity:** Medium (UX / wrong-term selection risk)

**Symptom:** Same course appears twice (once per term) in some pickers because
a course now exists in both Term 2 and Term 3.

**Root cause:** Class-list queries without `.eq('term_id', …)`. Remaining
user-facing spots:
- `app/tutor/trials/page.js` (~line 401) — class picker for placing trial
  students loads all classes across terms.
- `app/tutor/database/page.js` — several class dropdowns/pickers load all
  classes (e.g. the lines selecting `id, class_name` with no term filter).

**Fix:** Scope each list to the relevant term. For trials, this is nuanced —
during term transition you may need to place into next term's class, so prefer a
**term selector** on the picker rather than hard-coding the current term. For the
database explorer dropdowns, dedupe by `term_id` (a term filter or a
"latest-term-wins" group-by).

**Acceptance:** No picker shows the same course twice for a single intended term.
Intentionally cross-term tools (forecast, term-transition) keep multi-term data.

---

## Bug 4 — Role resolution trusts the JWT claim, which can go stale

**Severity:** Medium (latent; caused the original exam-access confusion)

**Symptom:** A genuine staff member's session can fail server-side staff checks
even though the app UI treats them as staff (role read from a different source).

**Root cause:** Both layers read role from `app_metadata.role`:
- `lib/getProfile.js` (line ~22): `const role = user.app_metadata?.role ?? 'student'`
- RLS `is_staff()` (now hardened, but historically JWT-only).

The JWT `app_metadata` can lag the DB (role set/changed after the token was
minted; no custom access-token hook is configured). So the client and the
database can disagree about whether someone is staff.

**Fix (choose one, consistently):**
- Make the **profile tables** (`directors`/`tutors`/`students`) the single source
  of truth for role, resolved by `auth.uid()`, in both `getAuthProfile` and the
  RLS helpers; **or**
- Add a DB trigger / scheduled job to keep `auth.users.app_metadata.role` in sync
  with the profile tables, and ensure clients refresh tokens after a role change.

`is_staff()` already falls back to the tables; bring `getAuthProfile` and any
`is_admin()`-style helpers in line so they can't drift.

**Acceptance:** Changing a user's role (or token staleness) never causes the UI
and RLS to disagree; staff always pass `is_staff()` without needing to re-login.

---

## Bug 5 — Live `is_staff()` change is not in source control

**Severity:** Medium (reproducibility / drift)

**Symptom:** The hardened `is_staff()` exists only in the live DB; a fresh
environment or a replayed migration history would restore the old, broken,
JWT-only version.

**Fix:** Add a migration file under `migrations/` (e.g.
`20260627_is_staff_check_directors_tutors_tables.sql`) containing the current
`create or replace function public.is_staff() …` definition (JWT-claim path OR
`directors`/`tutors` membership by `auth.uid()`/email, `security definer`,
`set search_path = public`). Keep it after `20260624_rls_hardening_applied.sql`.

**Acceptance:** Running migrations from scratch reproduces the working
`is_staff()`.

---

## Bug 6 — A/B/C class labels are confusing for 1:1 classes

**Severity:** Low (clarity)

**Symptom:** Multiple 1:1 classes that share a name (e.g. "Y6 Maths 1:1" run for
4 different students) all render as "… A / B / C / D", which is meaningless to
read.

**Root cause:** `lib/classLabels.js` (`buildClassLabelMap`) appends bare letters
to every set of 2+ classes sharing a normalised name, regardless of class type.

**Fix:** For 1:1 classes, label by the enrolled student's name (or day/time)
instead of a bare letter. For group classes with genuine multiple sections,
prefer day/time disambiguation (e.g. "Y6 English · Sat") over "A/B". Keep the
plain name when a course has a single class in the term.

**Acceptance:** 1:1 class labels identify the student/slot; group sections are
distinguishable at a glance; single classes stay unlettered.

---

## Bug 7 — Makeup lessons mislabelled and date can diverge

**Severity:** Low

**Symptom:** A makeup created from a **group** class is labelled "1:1 Makeup" in
the calendar; in one observed case the original attendance note said a different
date than the created makeup lesson row.

**Root cause:** The makeup pill prefix is `'1:1 Makeup'` whenever
`makeup_source_lesson_id` is set (see `app/tutor/classes/page.js` and
`components/calendar/MonthCalendarModal.js`), independent of class type. The
attendance note (`saveMakeupOneToOne`) is written from the form date; a later
drag/reschedule can change the lesson row's date without updating the note.

**Fix:** Derive the makeup label from the source class type (group vs 1:1). Keep
the attendance note and the makeup lesson's `lesson_date` in sync (update the
note if the makeup is rescheduled, or stop duplicating the date into free text).

**Acceptance:** Makeup labels match the source class type; the displayed makeup
date always matches the lesson row.

---

## Suggested order

1. Bug 1 (tutors locked out) and Bug 5 (commit the migration) — quick, high value.
2. Bug 2 (error surfacing) — prevents the next silent outage.
3. Bug 4 (role source of truth) — removes a whole class of auth confusion.
4. Bug 3 (remaining duplicates).
5. Bugs 6 & 7 (polish).

## Notes
- Don't add term filters to intentionally cross-term tools: financial forecast
  (`app/tutor/accounting/forecast/page.js`) and the term-transition tool
  (`app/tutor/transition/page.js`).
- The duplicate classes themselves are real rows: each course exists once per
  term (Term 2 + a Term 3 copy created by the timetable planner). If the Term 3
  copies were **not** intended yet, that's a data cleanup, separate from these
  code fixes.

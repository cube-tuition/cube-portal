<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Classes are per-term rows — always term-scope class queries

The term-transition wizard copies every class into the new term, so the same
class name exists once per term it has run. Any query that lists classes
without a `term_id` filter shows each class once per term (the duplicate-class
bug). Fetch classes through the helpers in `lib/classes.js`:

- `classesForTerm(termId, cols)` — one term's classes (the default choice)
- `classesAllTerms(cols)` — deliberate cross-term fetch; only for screens that
  label rows by term or key strictly by id
- `enrolledClassesForTerm(studentId, termId, cols)` — a student's classes via
  enrolments (student-facing pages)

Pick the term with `getCurrentTerm(terms)` (the teaching term running now, or
the next one during holidays — what pages show by default) or
`getEnrolmentTerm(terms)` (the term a new student would join; same answer)
from `lib/terms.js`. `getRunningTerm(terms)` is the literal term running today,
holiday periods included — only for logic about today's lessons.

## Money tests gate every deploy

`npm test` runs before every Vercel build (`vercel.json` buildCommand); a
failing test stops the deploy and production stays on the last good version.

- Invoice rules live in `lib/billing.js` + `lib/cashDiscount.js`, the Xero
  payroll push in `lib/payroll.js` — change the rule there, never inline in a
  route, and update `tests/*.test.mjs` with it.
- Refresh is `planInvoiceRefresh` (lib/billing): the Refresh button, the
  invoices page's "out of step" check (lib/invoiceDrift) and the automatic
  draft sync (lib/invoiceSync, fed by the enrolments → invoice_sync_queue
  trigger) all run it. Never write an invoice's total / discount columns from
  SQL or a trigger: they must come from its line items (`invoiceTotalsPatch`
  or a plan), or the PDF and Xero disagree.
- Shift and pay-run rules are database functions, tested on an in-memory
  Postgres from `tests/db/schema.sql`. After changing any of them (or
  their tables), run `npm run test:db:snapshot` and commit the snapshot with
  the migration — locally `npm test` fails until you do.
- Payroll money (shifts, tutor_rate_matrix, pay_runs, cash_log,
  director_balances) is admin-only through row-level security; a tutor reads
  only their own shifts and rates, and their shifts are created by SECURITY
  DEFINER functions (marking the roll, save_dropin_shift). Never add an
  `is_staff()` policy back to these tables — `is_staff()` includes every tutor.
  tests/payrollAccess.db.test.mjs signs in as a tutor to check.

## Access is enforced by the database, not the page

Any signed-in user can call the API directly with their session, so every
table's row-level security must be as tight as the screens. `is_staff()`
includes every tutor: use it for what tutor screens READ; writes to money,
family and settings tables are `is_admin(auth.uid())`. Students read only
their own rows (their classes' lessons, practice — not exam — questions).
tests/access.db.test.mjs and tests/payrollAccess.db.test.mjs sign in as each
role to check; add to them when a table's rules change.

## Scheduled jobs report in

Every cron records its outcome with `recordJob` (lib/systemHealth). The
morning job runs the system check (jobs, invoice queue, client crashes),
shows it on /tutor/admin/system and the Action Centre, and pushes the
directors when something is wrong. A new cron must record itself too — and be
added to WATCHED_JOBS if it should run daily.

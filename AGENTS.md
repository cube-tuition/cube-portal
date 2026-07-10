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

Pick the term with `getCurrentTerm(terms)` (what's taught now; dashboards,
results) or `getEnrolmentTerm(terms)` (the term a new student would join;
trial/enrolment pickers) from `lib/terms.js`.

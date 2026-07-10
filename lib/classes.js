import { supabase } from './supabase'
import { T_CLASSES, T_ENROLMENTS } from './tables'

/*
 * Term-scoped class fetching — use these instead of raw `.from('classes')`.
 *
 * Classes are PER-TERM rows: the term-transition wizard copies every class into
 * the new term, so "Y8 Maths" exists once per term it has run. Any query that
 * lists classes without a term filter therefore shows each class once per term
 * — the duplicate-class bug. Fetching through these helpers keeps the term
 * scoping in one place so it can't be forgotten when new screens are added.
 *
 * Picking the term to pass in:
 *   • getCurrentTerm(terms)   — what's being taught now (falls back to the
 *     most recently finished term during holidays). Dashboards, results, rolls.
 *   • getEnrolmentTerm(terms) — the term a NEW student would join (falls
 *     forward to the upcoming term during holidays). Trial/enrolment pickers.
 */

/**
 * Query builder for ONE term's classes. Chain .order()/.ilike()/etc. as usual.
 *   const { data } = await classesForTerm(term.id, 'id, class_name').order('class_name')
 */
export function classesForTerm(termId, cols = '*') {
  return supabase.from(T_CLASSES).select(cols).eq('term_id', termId)
}

/**
 * Deliberately UNSCOPED fetch — every class from every term. Only for screens
 * that label each row with its term (or key strictly by id, e.g. label maps);
 * anything user-facing almost certainly wants classesForTerm instead.
 */
export function classesAllTerms(cols = '*') {
  return supabase.from(T_CLASSES).select(cols)
}

/**
 * A student's enrolled classes in one term (enrolments ⋈ classes, inner join).
 * Rows come back as { classes: {...} }. A nullish termId skips the term filter
 * (fresh install with no terms yet) rather than returning nothing.
 */
export function enrolledClassesForTerm(studentId, termId, cols = '*') {
  let q = supabase
    .from(T_ENROLMENTS)
    .select(`classes!inner(${cols})`)
    .eq('student_id', studentId)
  if (termId) q = q.eq('classes.term_id', termId)
  return q
}

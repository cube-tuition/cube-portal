import { supabase } from './supabase'
import { fetchAllTerms } from './terms'

/*
 * Which weeks of a class's work a student may open.
 *
 * Classes are per-term rows, so this one rule serves the current term and
 * every past term alike:
 *   - an active, un-ended enrolment opens every week (lastWeek: null);
 *   - an enrolment that has ENDED — the student left or moved class part-way —
 *     opens the weeks up to and including the week they left. Left before the
 *     term began: nothing. Left after it finished (ended in the holidays, say):
 *     the whole term;
 *   - no enrolment in the class at all: nothing.
 *
 * Returns { ok, lastWeek, term } — `term` is the class's own term row.
 * Used by the read-only booklet viewer, the online workbook and the Past
 * Terms page, so all three agree on what a student can see.
 */
export async function studentClassAccess(studentId, classId) {
  if (!studentId || !classId) return { ok: false, lastWeek: 0, term: null }
  const [{ data: rows }, { data: cls }, terms] = await Promise.all([
    supabase.from('enrolments').select('status, ended_at').eq('class_id', classId).eq('student_id', studentId),
    supabase.from('classes').select('term_id').eq('id', classId).maybeSingle(),
    fetchAllTerms(),
  ])
  const term = terms.find(t => t.id === cls?.term_id) || null
  return { ...accessFromEnrolments(rows || [], term), term }
}

/** The rule itself, for callers that already hold the enrolment rows and term. */
export function accessFromEnrolments(rows, term) {
  if (rows.some(r => r.status === 'active' && !r.ended_at)) return { ok: true, lastWeek: null }
  const ended = rows.map(r => r.ended_at).filter(Boolean).sort()
  if (!ended.length) return { ok: false, lastWeek: 0 }
  const last = String(ended[ended.length - 1]).slice(0, 10)
  if (!term?.start_date || !term?.end_date) return { ok: true, lastWeek: null }
  if (last < term.start_date) return { ok: false, lastWeek: 0 }
  if (last > term.end_date) return { ok: true, lastWeek: null }
  const days = Math.floor((new Date(last) - new Date(term.start_date)) / 86400000)
  return { ok: true, lastWeek: Math.floor(days / 7) + 1 }
}

/** Is `week` open under this access? */
export const weekOpen = (access, week) =>
  !!access?.ok && (access.lastWeek == null || (Number(week) >= 1 && Number(week) <= access.lastWeek))

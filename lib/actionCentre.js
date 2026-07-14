import { supabase } from './supabase'
import { fetchAllTerms, getCurrentTerm } from './terms'
import { dueCadenceEmails, cadenceHref } from './emailCadence'
import { payrollAlertItems } from './payrollAlerts'

/*
 * Action Centre — aggregates everything that needs a director's attention.
 * Read-only checks over existing tables; each item deep-links to the page
 * where it gets fixed. Rendered by components/ActionCentre.js on /tutor.
 *
 * Severity: 'red' = act now · 'amber' = this week · 'blue' = worth knowing
 */

const STALE_DAYS = 3

const dayMs = 86400000
// Local calendar date (not UTC) — the centre runs on Sydney time, so
// toISOString() would roll "today" over ~10h early and put date-gated checks
// (overdue lessons, the cash pay-day trigger) a day out.
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const olderThan = (iso, days) => iso && (Date.now() - new Date(iso).getTime()) > days * dayMs

export async function runActionChecks() {
  const items = []
  let section = 'Operations'
  const add = (severity, icon, count, label, detail, href) => {
    if (count > 0) items.push({ severity, icon, count, label, detail, href, section })
  }

  const allTerms = await fetchAllTerms()
  const term = getCurrentTerm(allTerms)
  const today = todayIso()

  const [trialsRes, invoicesRes, lessonsRes, attendanceRes, shiftsRes, studentsRes, guardiansRes, creditsRes, orphanGuardRes] = await Promise.all([
    supabase.from('trial_submissions').select('id, status, submitted_at, contacted_at, trial_date, referred_by, converted_student_id'),
    term ? supabase.from('invoices').select('id, status, delivery_status, payment_status, due_date').eq('term_id', term.id).neq('status', 'voided') : { data: [] },
    term ? supabase.from('lessons').select('id, class_id, lesson_date').gte('lesson_date', term.start_date).lt('lesson_date', today).eq('status', 'scheduled').eq('is_makeup', false) : { data: [] },
    term ? supabase.from('attendance').select('class_id, session_date').gte('session_date', term.start_date) : { data: [] },
    supabase.from('shifts').select('id').eq('status', 'submitted'),
    supabase.from('students').select('id, full_name, family_id').eq('status', 'active'),
    supabase.from('guardians').select('student_id, email'),
    supabase.from('student_credits').select('student_id'),
    supabase.from('guardians').select('id, full_name, student_id'),
  ])

  // ── 1. Trials ───────────────────────────────────────────────────────────────
  const trials = (trialsRes.data ?? []).filter(t => !['enrolled', 'declined'].includes(t.status))
  const newUncontacted = trials.filter(t => t.status === 'new')
  add(newUncontacted.some(t => olderThan(t.submitted_at, STALE_DAYS)) ? 'red' : 'amber', '📞',
    newUncontacted.length, 'new enquiries awaiting first contact',
    'Call or email today — speed of first contact decides conversions.', '/tutor/trials')
  const trialDone = trials.filter(t => t.status === 'trial_scheduled' && t.trial_date && t.trial_date < today)
  add('red', '🎯', trialDone.length, 'finished trials with no decision',
    'The trial has happened — convert or drop so the family hears back.', '/tutor/trials')
  const staleContacted = trials.filter(t => t.status === 'contacted' && olderThan(t.contacted_at ?? t.submitted_at, STALE_DAYS))
  add('amber', '⏳', staleContacted.length, `enquiries idle for ${STALE_DAYS}+ days`,
    'Contacted but nothing booked — nudge them before they go cold.', '/tutor/trials')

  // ── 2. Invoices (current term) ──────────────────────────────────────────────
  section = 'Invoices'
  const invoices = invoicesRes.data ?? []
  add('amber', '🧾', invoices.filter(i => i.status === 'draft').length,
    'draft invoices awaiting approval', 'Approve so they can be sent.', '/tutor/accounting/invoices')
  add('red', '📤', invoices.filter(i => i.status === 'approved' && i.delivery_status === 'unsent').length,
    'approved invoices not yet sent', 'Families can’t pay an invoice they haven’t received.', '/tutor/accounting/invoices')
  add('red', '💸', invoices.filter(i => i.delivery_status === 'sent' && i.due_date && i.due_date < today && i.payment_status !== 'paid').length,
    'invoices overdue', 'Past due date and not marked paid — follow up.', '/tutor/accounting/invoices')

  section = 'Operations'
  // ── 3. Attendance gaps ──────────────────────────────────────────────────────
  const marked = new Set((attendanceRes.data ?? []).map(a => `${a.class_id}|${a.session_date}`))
  const unmarked = (lessonsRes.data ?? []).filter(l => !marked.has(`${l.class_id}|${l.lesson_date}`))
  add('amber', '📋', unmarked.length, 'past lessons with no attendance marked',
    'Unmarked rolls hide absences — your earliest churn signal.', '/tutor/unsaved-sessions')

  // ── 4. Referral credits owed ────────────────────────────────────────────────
  const creditedStudents = new Set((creditsRes.data ?? []).map(c => c.student_id))
  const owed = (trialsRes.data ?? []).filter(t =>
    t.converted_student_id && t.referred_by && !creditedStudents.has(t.converted_student_id))
  add('red', '🎁', owed.length, 'referral credits to issue',
    '$50 for the new family AND the referrer — keep the program trustworthy.', '/tutor/trials')

  // (The old item 5 — "families undecided for next term" — was removed along
  // with the next_term_status confirmation feature: every enrolment now rolls
  // over at transition, and non-continuing students are disenrolled manually
  // in the new term.)

  // ── 6. Payroll ──────────────────────────────────────────────────────────────
  section = 'Payroll'
  add('amber', '💼', (shiftsRes.data ?? []).length, 'shifts awaiting approval',
    'Tutors have submitted hours — approve before the pay run.', '/tutor/payroll')
  try {
    for (const it of await payrollAlertItems(term, today)) items.push(it)
  } catch { /* best-effort — never block the rest of the Action Centre */ }
  section = 'Operations'

  // ── 7. Family data gaps ─────────────────────────────────────────────────────
  const emailByStudent = {}
  for (const g of guardiansRes.data ?? []) {
    if (g.email) emailByStudent[String(g.student_id)] = true
  }
  const noEmail = (studentsRes.data ?? []).filter(s => !emailByStudent[s.id])
  add('amber', '👪', noEmail.length, 'active students with no guardian email',
    'These families miss invoices and every email campaign.', '/tutor/database')

  // ── 8. Data quality criticals ───────────────────────────────────────────────
  const studentIds = new Set((studentsRes.data ?? []).map(s => s.id))
  const orphanGuardians = (orphanGuardRes.data ?? []).filter(g => g.student_id && !studentIds.has(String(g.student_id)))
  // (active students only is fine here — quality page does the full sweep)
  add('blue', '🧹', orphanGuardians.length, 'guardian records needing review',
    'Linked to no active student — verify on the Data Quality page.', '/tutor/database/quality')

  // ── 9. Cadence emails due this week ─────────────────────────────────────────
  section = 'Emails'
  try {
    const { due, week } = await dueCadenceEmails(term, today)
    for (const row of due) {
      items.push({
        severity: 'amber', icon: '📧', count: 1, section,
        label: `${row.when}: send “${row.email}”`,
        detail: row.notes || `Scheduled in your cadence for this week (currently week ${week}).`,
        href: cadenceHref(row.email),
        done: { termId: term?.id, rowKey: row.key },   // enables ✓ Done button
      })
    }
  } catch { /* cadence check is best-effort */ }

  const order = { red: 0, amber: 1, blue: 2 }
  items.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count)
  return { items, generatedAt: new Date() }
}

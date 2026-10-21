import { supabase } from './supabase'
import { fetchAllTerms, getRunningTerm } from './terms'
import { dueCadenceEmails, cadenceHref } from './emailCadence'
import { loadStaleTrials, loadHeldTrialsDue } from './trialPipeline'

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

const daysAgo = (iso) => {
  const n = Math.floor((Date.now() - new Date(iso).getTime()) / dayMs)
  return n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`
}

export async function runActionChecks() {
  const items = []
  let section = 'Operations'
  const add = (severity, icon, count, label, detail, href) => {
    if (count > 0) items.push({ severity, icon, count, label, detail, href, section })
  }

  const allTerms = await fetchAllTerms()
  // The term running today, holiday included: these checks are about lessons
  // that have happened (unmarked rolls) and this week's cadence/pay run.
  const term = getRunningTerm(allTerms)
  const today = todayIso()

  const [trialsRes, lessonsRes, attendanceRes, studentsRes, guardiansRes, creditsRes, orphanGuardRes] = await Promise.all([
    supabase.from('trial_submissions').select('id, status, submitted_at, contacted_at, trial_date, referred_by, converted_student_id, student_name, student_year, subjects, parent_name, parent_phone'),
    term ? supabase.from('lessons').select('id, class_id, lesson_date').gte('lesson_date', term.start_date).lt('lesson_date', today).eq('status', 'scheduled').eq('is_makeup', false) : { data: [] },
    term ? supabase.from('attendance').select('class_id, session_date').gte('session_date', term.start_date) : { data: [] },
    supabase.from('students').select('id, full_name, family_id').eq('status', 'active'),
    supabase.from('guardians').select('student_id, email'),
    supabase.from('student_credits').select('student_id'),
    supabase.from('guardians').select('id, full_name, student_id'),
  ])

  // ── 1. Trials ───────────────────────────────────────────────────────────────
  const trials = (trialsRes.data ?? []).filter(t => !['enrolled', 'declined'].includes(t.status))
  // Every case nobody has acted on for two days (lib/trialPipeline — the same
  // rule as the morning push), one row each. Its clock follows the stage: a
  // trial still running is not due; a finished one is, two days after its
  // last lesson. (trial_date is never filled in, so the old "finished trials"
  // check here never fired.)
  try {
    for (const c of await loadStaleTrials(supabase)) {
      add('red', '🎯', 1, `${c.student_name} — ${c.action}`,
        `No action for ${c.days} day${c.days === 1 ? '' : 's'}.`, '/tutor/trials')
    }
  } catch { /* best-effort */ }
  // Trials the family put on hold, now due a check-in — until reopened or
  // given a new date.
  try {
    for (const c of await loadHeldTrialsDue(supabase)) {
      add('amber', '⏸', 1, `${c.student_name} — check back in`,
        'The family put their trial on hold. Get in touch, then reopen it or move the date.', '/tutor/trials')
    }
  } catch { /* best-effort */ }

  // ── 3. Attendance gaps ──────────────────────────────────────────────────────
  const marked = new Set((attendanceRes.data ?? []).map(a => `${a.class_id}|${a.session_date}`))
  const unmarked = (lessonsRes.data ?? []).filter(l => !marked.has(`${l.class_id}|${l.lesson_date}`))
  add('amber', '📋', unmarked.length, 'past lessons with no attendance marked',
    'Unmarked rolls hide absences — your earliest churn signal.', '/tutor/unsaved-sessions')

  // ── 3b. Absences to follow up ───────────────────────────────────────────────
  // absence_cases opens one per student marked absent; the Absences subpage
  // of Attendance works them through to a makeup, credit or close.
  try {
    const { data: openCases } = await supabase.from('absence_cases')
      .select('stage, session_date, updated_at').in('stage', ['new', 'contacted'])
    const waiting = (openCases ?? []).filter(c => c.stage === 'contacted' && olderThan(c.updated_at, STALE_DAYS))
    add('amber', '⏳', waiting.length, `absences awaiting a reply for ${STALE_DAYS}+ days`,
      'The family was contacted but nothing is settled — chase or close.', '/tutor/admin/monitoring/attendance/absences')
  } catch { /* best-effort — never block the rest of the Action Centre */ }

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

  // (Item 6 — payroll: shifts to approve and pay run reminders — left the
  // Action Centre; the pay run reminders still arrive by the morning push,
  // app/api/reminders/daily, and shifts are approved on /tutor/payroll.)

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

  // (Item 10 — student flags — left the Action Centre: a new flag pushes to
  // the directors' phones as it is raised (api/notify-student-flag), and open
  // flags are resolved on /tutor/flags.)

  // ── 11. System health — the morning check (lib/systemHealth) ───────────────
  // Its problems as they were found, plus a warning if the check itself has
  // stopped running. Details on /tutor/admin/monitoring/system.
  section = 'System'
  try {
    const { data: checks } = await supabase.from('job_runs').select('finished_at, detail')
      .eq('job', 'health_check').order('finished_at', { ascending: false }).limit(1)
    const last = checks?.[0]
    if (last && olderThan(last.finished_at, 30 / 24)) {
      add('red', '🩺', 1, 'the morning system check hasn\'t run',
        `Last ran ${daysAgo(last.finished_at)}. The morning job may be failing.`, '/tutor/admin/monitoring/system')
    }
    for (const p of last?.detail?.problems || []) {
      items.push({ severity: p.severity === 'red' ? 'red' : 'amber', icon: p.severity === 'red' ? '🔴' : '⚠️', count: 1, section,
        label: p.title, detail: p.detail || '', href: '/tutor/admin/monitoring/system' })
    }
  } catch { /* best-effort — a monitoring outage must not blank the Action Centre */ }

  // ── 12. The directors' to-do (ops_tasks, the Work page) ────────────────────
  // One card each for Ryan and Aiden; a task for both (no assignee) shows in
  // both. Overdue is red, due within a week amber; ✓ ticks it off for good.
  try {
    const { data: tasks } = await supabase.from('ops_tasks').select('id, title, detail, assignee, due_date, created_at')
      .eq('status', 'open').order('created_at')
    for (const t of tasks || []) {
      const days = t.due_date ? Math.round((new Date(`${t.due_date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null
      const when = days == null ? '' : days < 0 ? `${-days}d overdue` : days === 0 ? 'due today' : days === 1 ? 'due tomorrow'
        : `due ${new Date(`${t.due_date}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
      const both = t.assignee !== 'Ryan' && t.assignee !== 'Aiden'
      for (const who of both ? ['Ryan', 'Aiden'] : [t.assignee]) {
        items.push({
          severity: days != null && days < 0 ? 'red' : days != null && days <= 7 ? 'amber' : 'blue',
          icon: '📌', count: 1, person: true, section: `Todo:${who}`,   // not a checkbox — an open task isn't ticked
          label: t.title,
          detail: [both && 'for both of you', when, t.detail && String(t.detail).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()].filter(Boolean).join(' · ') || 'No due date',
          href: '/tutor/admin/work',
          done: { taskId: t.id },
        })
      }
    }
  } catch { /* best-effort — never blank the rest of the Action Centre */ }

  const order = { red: 0, amber: 1, blue: 2 }
  items.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count)
  return { items, generatedAt: new Date() }
}

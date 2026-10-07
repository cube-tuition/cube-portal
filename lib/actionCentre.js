import { supabase } from './supabase'
import { fetchAllTerms, getCurrentTerm } from './terms'
import { dueCadenceEmails, cadenceHref } from './emailCadence'
import { payrollAlertItems } from './payrollAlerts'
import { openFlags, flagSeverity, reasonMeta } from './studentFlags'

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
const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean)

/** Push one Action Centre row per person we have not contacted yet. */
async function uncontactedPeople(items, trials, today) {
  const people = []   // { since, item }
  const person = (since, severity, icon, label, detail, href) =>
    people.push({ since: since || '', item: { severity, icon, count: 1, person: true, label, detail, href, section: 'Uncontacted' } })

  // New trial enquiries — one row per child (a family often enquires per subject).
  const byChild = new Map()
  for (const t of trials.filter(x => x.status === 'new')) {
    const key = `${(t.student_name || '').trim().toLowerCase()}|${(t.parent_phone || t.parent_name || '').trim()}`
    const g = byChild.get(key) || { ...t, subjectsAll: [], first: t.submitted_at }
    g.subjectsAll.push(...asList(t.subjects))
    if (t.submitted_at < g.first) g.first = t.submitted_at
    byChild.set(key, g)
  }
  for (const g of byChild.values()) {
    const subj = [...new Set(g.subjectsAll)].join(', ')
    person(g.first, olderThan(g.first, STALE_DAYS) ? 'red' : 'amber', '📞',
      `${g.student_name || 'Unnamed student'}${g.student_year ? ` (Y${g.student_year})` : ''} — trial enquiry`,
      [subj, [g.parent_name, g.parent_phone].filter(Boolean).join(' '), `enquired ${daysAgo(g.first)}`].filter(Boolean).join(' · '),
      '/tutor/trials')
  }

  // Absences nobody has followed up — one row per student.
  const { data: cases } = await supabase.from('absence_cases')
    .select('student_id, class_id, session_date').eq('stage', 'new').order('session_date')
  if (cases?.length) {
    const sIds = [...new Set(cases.map(c => c.student_id).filter(Boolean))]
    const cIds = [...new Set(cases.map(c => c.class_id).filter(Boolean))]
    const [{ data: studs }, { data: cls }] = await Promise.all([
      sIds.length ? supabase.from('students').select('id, full_name').in('id', sIds) : { data: [] },
      cIds.length ? supabase.from('classes').select('id, class_name').in('id', cIds) : { data: [] },
    ])
    const sName = Object.fromEntries((studs || []).map(s => [String(s.id), s.full_name]))
    const cName = Object.fromEntries((cls || []).map(c => [String(c.id), c.class_name]))
    const byStudent = new Map()
    for (const c of cases) {
      const k = String(c.student_id); const list = byStudent.get(k) || []
      list.push(c); byStudent.set(k, list)
    }
    for (const [sid, list] of byStudent) {
      const first = list[0].session_date
      const past = first <= today
      const when = list.map(c => `${fmtDay(c.session_date)}${cName[String(c.class_id)] ? ` (${cName[String(c.class_id)]})` : ''}`).join(', ')
      person(`${first}T00:00:00`, past && olderThan(`${first}T00:00:00`, STALE_DAYS) ? 'red' : 'amber', '🙋',
        `${sName[sid] || 'Unknown student'} — ${list.length > 1 ? `${list.length} absences` : past ? 'absent' : 'upcoming absence'}`,
        `${when} · no follow-up yet`, '/tutor/admin/monitoring/attendance/absences')
    }
  }

  // New form submissions (holiday sign-ups, enrolment forms, expressions of interest).
  const { data: subs } = await supabase.from('form_submissions')
    .select('id, data, submitted_at, forms(title)').eq('status', 'new').order('submitted_at')
  for (const s of subs || []) {
    const d = s.data || {}
    const name = d.student_name || d.name || d.full_name || d.parent_name || d.parent_email || d.email || 'Someone'
    const extra = asList(d.subjects).join(', ')
    person(s.submitted_at, olderThan(s.submitted_at, STALE_DAYS) ? 'red' : 'amber', '📝',
      `${name} — ${s.forms?.title || 'form submission'}`,
      [extra, d.parent_email || d.email, `submitted ${daysAgo(s.submitted_at)}`].filter(Boolean).join(' · '),
      '/tutor/admin/forms')
  }

  people.sort((a, b) => a.since.localeCompare(b.since))   // waiting longest first
  for (const p of people) items.push(p.item)
}

export async function runActionChecks() {
  const items = []
  let section = 'Operations'
  const add = (severity, icon, count, label, detail, href) => {
    if (count > 0) items.push({ severity, icon, count, label, detail, href, section })
  }

  const allTerms = await fetchAllTerms()
  const term = getCurrentTerm(allTerms)
  const today = todayIso()

  const [trialsRes, lessonsRes, attendanceRes, shiftsRes, studentsRes, guardiansRes, creditsRes, orphanGuardRes] = await Promise.all([
    supabase.from('trial_submissions').select('id, status, submitted_at, contacted_at, trial_date, referred_by, converted_student_id, student_name, student_year, subjects, parent_name, parent_phone'),
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
  // (New enquiries awaiting first contact are listed person by person in the
  // Uncontacted card below.)
  const trialDone = trials.filter(t => t.status === 'trial_scheduled' && t.trial_date && t.trial_date < today)
  add('red', '🎯', trialDone.length, 'finished trials with no decision',
    'The trial has happened — convert or drop so the family hears back.', '/tutor/trials')
  const staleContacted = trials.filter(t => t.status === 'contacted' && olderThan(t.contacted_at ?? t.submitted_at, STALE_DAYS))
  add('amber', '⏳', staleContacted.length, `enquiries idle for ${STALE_DAYS}+ days`,
    'Contacted but nothing booked — nudge them before they go cold.', '/tutor/trials')

  // ── 2. Uncontacted — every person nobody has reached out to yet ──────────────
  // One row per person (not a count), oldest first: new trial enquiries, students
  // with an absence nobody has followed up, and new form sign-ups.
  section = 'Uncontacted'
  try { await uncontactedPeople(items, trials, today) } catch { /* best-effort */ }
  section = 'Operations'
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
    // (Absences nobody has followed up are listed per student in Uncontacted.)
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

  // ── 10. Student flags raised by tutors ──────────────────────────────────────
  // One item per flag rather than a single count: each carries its own reason
  // and note, and each is resolved individually from the card.
  section = 'Flags'
  try {
    for (const f of await openFlags()) {
      const meta = reasonMeta(f.reason)
      const where = [f.class_name, f.lesson_date].filter(Boolean).join(' · ')
      items.push({
        severity: flagSeverity(f), icon: meta.icon, count: 1, section,
        label: `${f.student_name} — ${meta.label.toLowerCase()}`,
        detail: f.note
          || [where, f.raised_by_name && `raised by ${f.raised_by_name}`].filter(Boolean).join(' · ')
          || 'No further detail given.',
        href: '/tutor/flags',
        done: { flagId: f.id },          // enables the ✓ Resolve button
      })
    }
  } catch { /* best-effort — a flags outage must not blank the Action Centre */ }

  const order = { red: 0, amber: 1, blue: 2 }
  items.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count)
  return { items, generatedAt: new Date() }
}

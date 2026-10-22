/*
 * Trial cases waiting on us.
 *
 * A case is "unacted" when it needs something from CUBE and nobody has touched
 * it for STALE_HOURS (two days):
 *   new              — contact the family        (clock: last activity)
 *   contacted        — book the trial            (clock: last activity)
 *   trial_scheduled  — follow up once the trial has finished: the clock starts
 *                      at the end of its last trial lesson (the first two
 *                      lessons of the trial class, as the Trials page counts
 *                      them). While the trial is still running, nothing is due
 *                      — unless the case has had no update for STUCK_DAYS.
 *                      With no trial class or lessons, it is waiting to be
 *                      booked (clock: last activity).
 *   trial_1_completed — lesson 1 done (attendance with feedback): as
 *                      trial_scheduled — feedback owed, else lesson 2 to come
 *   trial_completed  — 2/2: enrol or decline     (clock: the later of the two)
 * Before a trial (new / contacted), a level test booked for the student is the
 * next step: while it is still to come nothing is due; once it has been sat,
 * the case is due two days later — follow it up (results, then a trial).
 * A family enquiring about two subjects for one child is one conversation: a
 * new enquiry is not "uncontacted" once another of that child's enquiries has
 * moved on — that one carries the case.
 * Trial feedback comes first: once a trial lesson has been marked (attendance
 * with the tutor's trial_feedback), the family is owed its feedback email —
 * lesson 1's, or the outcome once a subject has had lesson 2 — and the case
 * says so until it is sent (clock: the end of that lesson's day).
 * last_activity_at is stamped by a trigger on any action on the case
 * (migrations/20261014_trial_activity.sql).
 *
 * The morning job pushes the directors about cases that have newly gone
 * quiet; the Action Centre shows all of them. staleTrials() is pure
 * (tests/trialPipeline.test.mjs); loadStaleTrials() reads with any client.
 */
import { trialDatesFor } from './trialDates.js'

export const STALE_HOURS = 48
// A scheduled trial with no update for this long is stale even if the
// timetable shows a trial lesson still to come.
export const STUCK_DAYS = 21
const OPEN = ['new', 'contacted', 'trial_scheduled', 'trial_1_completed', 'trial_completed']
const sydneyDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d)
// The end of a lesson day in Sydney (AEDT +11 / AEST +10 — the later is safe).
const endOfDay = (iso) => new Date(`${iso}T23:59:00+10:00`)

/*
 *   subs             open trial_submissions rows
 *   trialEnrolments  [{ student_id, class_id, trial_start_date }] trial enrolments
 *   lessonsByClass   { class_id → [lesson_date, …] } ascending, not cancelled
 *   trialLessons     { student_id → { class_id → [session_date, …] } } trial
 *                    lessons attended with feedback, ascending
 *   levelTests       { student_id → [lesson_date, …] } booked level tests
 *                    (not cancelled), ascending
 * Returns [{ id, student_name, status, action, since, days }], longest-waiting first.
 */
export function staleTrials({ subs = [], trialEnrolments = [], lessonsByClass = {}, trialLessons = {}, levelTests = {}, now = new Date() }) {
  const today = sydneyDate(now)
  const out = []
  for (const s of subs) {
    if (!OPEN.includes(s.status)) continue
    let clock = new Date(s.last_activity_at || s.submitted_at)
    let action = { new: 'contact the family', contacted: 'book the trial',
      trial_scheduled: 'follow up — the trial has finished', trial_1_completed: 'follow up — the trial has finished',
      trial_completed: 'enrol or decline' }[s.status]

    if (s.status === 'new' || s.status === 'contacted') {
      const sid = s.converted_student_id
      // Another of this child's enquiries has moved on: the family has been
      // contacted, and that enquiry carries the case.
      if (s.status === 'new' && sid && subs.some(o => o.id !== s.id && o.converted_student_id === sid && OPEN.includes(o.status) && o.status !== 'new')) continue
      // A level test is the next step: nothing due until it has been sat.
      const tests = (sid && levelTests[sid]) || []
      if (tests.some(d => d >= today)) continue
      if (tests.length) {
        const sat = endOfDay(tests[tests.length - 1])
        if (sat > clock) { clock = sat; action = 'follow up the level test — results and a trial' }
      }
    }

    if (['trial_scheduled', 'trial_1_completed', 'trial_completed'].includes(s.status)) {
      // Feedback owed for a marked trial lesson takes precedence.
      const owed = feedbackOwed(s, trialLessons[s.converted_student_id])
      if (owed) {
        const hours = (now - owed.clock) / 3600e3
        if (hours >= STALE_HOURS) {
          out.push({ id: s.id, student_name: s.student_name || 'Unnamed student', status: s.status, action: owed.action,
            since: owed.clock.toISOString(), days: Math.floor(hours / 24), notified: !!s.stale_notified_at })
        }
        continue
      }
      let rows = trialEnrolments.filter(r => s.converted_student_id && r.student_id === s.converted_student_id && r.class_id != null)
      if (!rows.length && s.trial_class_id != null) rows = [{ class_id: s.trial_class_id, trial_start_date: null }]
      const ends = rows.map(r => trialDatesFor(lessonsByClass[r.class_id] || [], r.trial_start_date)).filter(d => d.length).map(d => d[d.length - 1])
      const quietDays = (now - clock) / 86400e3
      if (ends.some(d => d >= today)) {
        // A trial lesson is still to come: nothing due yet — unless the case
        // has had no update in weeks. A trial is two lessons; one "scheduled"
        // for months is stale (e.g. its trial enrolment was rolled into the
        // next term's class at transition, so its "trial" restarted).
        if (quietDays < STUCK_DAYS) continue
        out.push({ id: s.id, student_name: s.student_name || 'Unnamed student', status: s.status,
          action: `check this trial — no update in ${Math.floor(quietDays / 7)} weeks`,
          since: clock.toISOString(), days: Math.floor(quietDays), notified: !!s.stale_notified_at })
        continue
      }
      if (ends.length) {
        const end = endOfDay(ends.sort().at(-1))
        if (end > clock) clock = end
      } else if (s.status === 'trial_scheduled') {
        action = 'book the trial lessons — no trial class or dates yet'
      }
    }

    const hours = (now - clock) / 3600e3
    if (hours >= STALE_HOURS) {
      out.push({ id: s.id, student_name: s.student_name || 'Unnamed student', status: s.status, action,
        since: clock.toISOString(), days: Math.floor(hours / 24), notified: !!s.stale_notified_at })
    }
  }
  return out.sort((a, b) => a.since.localeCompare(b.since))
}

// The feedback email a case still owes, if any: the outcome once any subject
// has had its second trial lesson, else lesson 1's once one has had its first.
function feedbackOwed(s, byClass = {}) {
  if (s.outcome_sent_at) return null
  const lists = Object.values(byClass || {}).filter(l => l?.length)
  if (!lists.length) return null
  const seconds = lists.filter(l => l.length >= 2).map(l => l[1]).sort()
  if (seconds.length) return { action: 'send the trial outcome email', clock: endOfDay(seconds[0]) }
  if (s.lesson1_feedback_sent_at) return null
  const firsts = lists.map(l => l[0]).sort()
  return { action: 'send the lesson 1 feedback email', clock: endOfDay(firsts[0]) }
}

export async function loadStaleTrials(sb, { now = new Date() } = {}) {
  const { data: subs, error } = await sb.from('trial_submissions')
    .select('id, student_name, status, submitted_at, last_activity_at, stale_notified_at, converted_student_id, trial_class_id, lesson1_feedback_sent_at, outcome_sent_at')
    .in('status', OPEN)
  if (error) throw error
  const studentIds = [...new Set((subs || []).map(s => s.converted_student_id).filter(Boolean))]
  const { data: enrols } = studentIds.length
    ? await sb.from('enrolments').select('student_id, class_id, trial_start_date').in('student_id', studentIds).in('status', ['trial', 'trial complete'])
    : { data: [] }
  const classIds = [...new Set([...(enrols || []).map(e => e.class_id), ...(subs || []).map(s => s.trial_class_id)].filter(v => v != null))]
  const { data: lessons } = classIds.length
    ? await sb.from('lessons').select('class_id, lesson_date').in('class_id', classIds)
        .eq('is_makeup', false).neq('status', 'cancelled').order('lesson_date')
    : { data: [] }
  const lessonsByClass = {}
  for (const l of lessons || []) (lessonsByClass[l.class_id] ||= []).push(l.lesson_date)
  // Trial lessons attended with the tutor's feedback (SessionMarker writes it
  // only while the enrolment is a trial) — the lessons a feedback email reports.
  const { data: att } = studentIds.length
    ? await sb.from('attendance').select('student_id, class_id, session_date, trial_feedback')
        .in('student_id', studentIds).in('status', ['present', 'late']).not('trial_feedback', 'is', null).order('session_date')
    : { data: [] }
  const trialLessons = {}
  for (const a of att || []) {
    if (!String(a.trial_feedback || '').trim()) continue
    ;((trialLessons[a.student_id] ||= {})[a.class_id] ||= []).push(a.session_date)
  }
  // Level tests booked for these students (from the invitation form or the
  // Level tests page) — the step before a trial.
  const { data: lt } = studentIds.length
    ? await sb.from('lessons').select('makeup_student_id, lesson_date').eq('lesson_type', 'level_test')
        .in('makeup_student_id', studentIds).neq('status', 'cancelled').order('lesson_date')
    : { data: [] }
  const levelTests = {}
  for (const l of lt || []) (levelTests[l.makeup_student_id] ||= []).push(l.lesson_date)
  return staleTrials({ subs: subs || [], trialEnrolments: enrols || [], lessonsByClass, trialLessons, levelTests, now })
}

const STAGE_LABEL = { new: 'New', contacted: 'Contacted', trial_scheduled: 'Trial scheduled', trial_1_completed: 'Trial 1/2 completed', trial_completed: 'Trial 2/2 completed' }

// The morning push for cases that have newly gone quiet.
export function trialNudgePush(cases, tag) {
  const names = cases.slice(0, 4).map(c => `${c.student_name.split(' ')[0]} (${STAGE_LABEL[c.status] || c.status})`)
  return {
    title: `📞 ${cases.length} trial${cases.length === 1 ? '' : 's'} waiting on you for 2+ days`,
    body: names.join(', ') + (cases.length > 4 ? ` and ${cases.length - 4} more` : '') + '.',
    url: '/tutor/trials',
    tag,
  }
}

/*
 * On hold: an enquiry the family has paused. It is not an open case (no
 * nudges), but a hold can carry a check-back date — from that morning it is
 * due again: the daily job pushes once (hold_notified_at), and the Action
 * Centre lists it until someone reopens it or moves the date.
 */
export function heldTrialsDue(subs = [], now = new Date()) {
  const today = sydneyDate(now)
  return subs
    .filter(s => s.status === 'on_hold' && s.hold_until && s.hold_until <= today)
    .map(s => ({ id: s.id, student_name: s.student_name || 'A trial student', hold_until: s.hold_until, notified: !!s.hold_notified_at }))
    .sort((a, b) => a.hold_until.localeCompare(b.hold_until))
}

export async function loadHeldTrialsDue(sb, { now = new Date() } = {}) {
  const { data, error } = await sb.from('trial_submissions')
    .select('id, student_name, status, hold_until, hold_notified_at').eq('status', 'on_hold').not('hold_until', 'is', null)
  if (error) throw error
  // A student trialling two subjects is one family to call back.
  const seen = new Set()
  return heldTrialsDue(data || [], now).filter(c => !seen.has(c.student_name) && seen.add(c.student_name))
}

// The morning push for holds whose check-back date has come.
export function heldTrialPush(cases, tag) {
  const names = cases.slice(0, 4).map(c => c.student_name.split(' ')[0])
  return {
    title: cases.length === 1
      ? `⏸ ${cases[0].student_name} — time to check back in`
      : `⏸ ${cases.length} trials on hold are due a check-in`,
    body: cases.length === 1
      ? 'The family put their trial on hold. Get back in touch, then reopen or move the date on the Trials page.'
      : names.join(', ') + (cases.length > 4 ? ` and ${cases.length - 4} more` : '') + ' — reopen or move the date on the Trials page.',
    url: '/tutor/trials',
    tag,
  }
}

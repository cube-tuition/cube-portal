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
 *   trial_completed  — enrol or decline          (clock: the later of the two)
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
const OPEN = ['new', 'contacted', 'trial_scheduled', 'trial_completed']
const sydneyDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d)
// The end of a lesson day in Sydney (AEDT +11 / AEST +10 — the later is safe).
const endOfDay = (iso) => new Date(`${iso}T23:59:00+10:00`)

/*
 *   subs             open trial_submissions rows
 *   trialEnrolments  [{ student_id, class_id, trial_start_date }] trial enrolments
 *   lessonsByClass   { class_id → [lesson_date, …] } ascending, not cancelled
 * Returns [{ id, student_name, status, action, since, days }], longest-waiting first.
 */
export function staleTrials({ subs = [], trialEnrolments = [], lessonsByClass = {}, now = new Date() }) {
  const today = sydneyDate(now)
  const out = []
  for (const s of subs) {
    if (!OPEN.includes(s.status)) continue
    let clock = new Date(s.last_activity_at || s.submitted_at)
    let action = { new: 'contact the family', contacted: 'book the trial',
      trial_scheduled: 'follow up — the trial has finished', trial_completed: 'enrol or decline' }[s.status]

    if (s.status === 'trial_scheduled' || s.status === 'trial_completed') {
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

export async function loadStaleTrials(sb, { now = new Date() } = {}) {
  const { data: subs, error } = await sb.from('trial_submissions')
    .select('id, student_name, status, submitted_at, last_activity_at, stale_notified_at, converted_student_id, trial_class_id')
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
  return staleTrials({ subs: subs || [], trialEnrolments: enrols || [], lessonsByClass, now })
}

const STAGE_LABEL = { new: 'New', contacted: 'Contacted', trial_scheduled: 'Trial scheduled', trial_completed: 'Trial completed' }

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

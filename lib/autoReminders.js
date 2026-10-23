/*
 * The reminders that send themselves, 24 hours before the booked time:
 *   level test  — a booked level test (lessons, lesson_type 'level_test')
 *                 whose family booked through a level test invitation
 *   trial       — each of a student's two trial lessons (a trial enrolment's
 *                 first two lessons from trial_start_date)
 *
 * /api/reminders/upcoming runs every 15 minutes (pg_cron); everything due is
 * sent once — each reminder is claimed in auto_reminders by its key before it
 * is sent. A student's trial lessons on the same day go in one email, sent 24
 * hours before the first of them (reminderSends). A booking made with less than 24 hours to go is reminded at once,
 * except a level test the family has only just booked: their confirmation
 * email is the reminder.
 *
 * Pure builders and rules here (tests/autoReminders.test.mjs);
 * loadDueReminders() reads with the service role.
 */
import { shell, slotCard, rich } from './levelTestInvite.js'
import { trialDatesFor } from './trialDates.js'

export const REMIND_HOURS = 24
const HOUR = 3600e3
const hm = (t) => String(t || '').slice(0, 5)

// A Sydney wall-clock time as a Date (AEST +10 / AEDT +11, whichever applies).
export function sydneyTime(date, time = '00:00') {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = (hm(time) || '00:00').split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess)).map(p => [p.type, p.value]))
  const asSydney = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
  return new Date(guess - (asSydney - guess))
}

// Due: inside the 24 hours before it starts, and not started yet.
export const isDue = (startsAt, now) => startsAt > now && startsAt - now <= REMIND_HOURS * HOUR

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || ''

/*
 * Trial lessons to remind about.
 *   enrolments  [{ id, student_id, class_id, trial_start_date, created_at }] status 'trial'
 *   lessons     [{ class_id, lesson_date, start_time, end_time, room }] not cancelled, not makeups
 *   classes     [{ id, class_name, start_time, end_time }]
 *   students    [{ id, full_name }]
 *   subs        trial_submissions [{ id, enrolment_id, converted_student_id, trial_class_id, status, parent_name, parent_email }]
 *   guardians   [{ student_id, full_name, email }]
 * One item per trial lesson: { key, kind: 'trial', lessonNo, startsAt, … }.
 */
export function trialItems({ enrolments = [], lessons = [], classes = [], students = [], subs = [], guardians = [] }) {
  const classById = Object.fromEntries(classes.map(c => [c.id, c]))
  const nameById = Object.fromEntries(students.map(s => [s.id, s.full_name]))
  const byClass = {}
  for (const l of [...lessons].sort((a, b) => a.lesson_date.localeCompare(b.lesson_date))) (byClass[l.class_id] ||= []).push(l)
  const out = []
  for (const e of enrolments) {
    if (e.class_id == null) continue
    const sub = subs.find(s => s.enrolment_id === e.id)
      || subs.find(s => s.converted_student_id === e.student_id && s.trial_class_id === e.class_id)
      || (subs.filter(s => s.converted_student_id === e.student_id).length === 1 ? subs.find(s => s.converted_student_id === e.student_id) : null)
    // A paused or decided enquiry gets no reminder.
    if (sub && ['on_hold', 'declined', 'enrolled'].includes(sub.status)) continue
    const g = guardians.find(x => x.student_id === e.student_id && x.email) || guardians.find(x => x.student_id === e.student_id)
    const email = (sub?.parent_email || g?.email || '').trim()
    if (!email) continue
    const cls = classById[e.class_id] || {}
    const list = byClass[e.class_id] || []
    const from = e.trial_start_date || String(e.created_at || '').slice(0, 10) || null
    const dates = trialDatesFor(list.map(l => l.lesson_date), from)
    dates.forEach((date, i) => {
      const l = list.find(x => x.lesson_date === date) || {}
      const start = hm(l.start_time || cls.start_time)
      const end = hm(l.end_time || cls.end_time)
      out.push({
        key: `trial:${e.id}:${date}`, kind: 'trial', lessonNo: i + 1, studentId: e.student_id,
        startsAt: sydneyTime(date, start || '09:00'),
        submissionId: sub?.id ?? null, email,
        parentName: sub?.parent_name || g?.full_name || '',
        studentName: nameById[e.student_id] || '',
        className: cls.class_name || 'your class',
        slot: { date, start, end, room: l.room || '' },
        nextDate: dates[i + 1] || null,
      })
    })
  }
  return out
}

/*
 * Booked level tests to remind about.
 *   lessons  [{ id, lesson_date, start_time, end_time, room, status, student_name }] lesson_type 'level_test'
 *   invites  [{ lesson_id, submission_id, student_name, responded_at }]
 *   subs     [{ id, parent_name, parent_email, student_name }]
 */
export function levelTestItems({ lessons = [], invites = [], subs = [] }) {
  const out = []
  for (const l of lessons) {
    if (l.status === 'cancelled') continue
    const inv = invites.find(i => i.lesson_id === l.id)
    const sub = inv && subs.find(s => s.id === inv.submission_id)
    const email = (sub?.parent_email || '').trim()
    if (!email) continue
    const start = hm(l.start_time)
    const startsAt = sydneyTime(l.lesson_date, start || '09:00')
    out.push({
      key: `level_test:${l.id}:${l.lesson_date}:${start}`, kind: 'level_test',
      startsAt, submissionId: sub.id, email,
      parentName: sub.parent_name || '',
      studentName: l.student_name || inv.student_name || sub.student_name || '',
      slot: { date: l.lesson_date, start, end: hm(l.end_time), room: l.room || '' },
      // Booked inside the reminder window: their confirmation is the reminder.
      bookedLate: !!inv.responded_at && startsAt - new Date(inv.responded_at) <= REMIND_HOURS * HOUR,
    })
  }
  return out
}

/** Everything due now and not yet sent (`sentKeys`). */
export function dueReminders(items, { now = new Date(), sentKeys = new Set() } = {}) {
  return items.filter(it => isDue(it.startsAt, now) && !sentKeys.has(it.key) && !it.bookedLate)
}

/*
 * The emails to send now: each due reminder, with a student's other trial
 * lessons that day (not yet reminded, same email) joined to it — one email
 * for the day, not one per lesson. Each send is a list of items, by start.
 */
export function reminderSends(items, { now = new Date(), sentKeys = new Set() } = {}) {
  const taken = new Set()
  const out = []
  const sameDay = (a, b) => a.kind === 'trial' && b.kind === 'trial' && a.studentId === b.studentId
    && a.slot.date === b.slot.date && a.email.toLowerCase() === b.email.toLowerCase()
  for (const it of dueReminders(items, { now, sentKeys })) {
    if (taken.has(it.key)) continue
    const group = items
      .filter(o => o.key === it.key || (sameDay(it, o) && o.startsAt > now && !sentKeys.has(o.key) && !taken.has(o.key)))
      .sort((a, b) => a.startsAt - b.startsAt)
    group.forEach(g => taken.add(g.key))
    out.push(group)
  }
  return out
}

// ── Emails ───────────────────────────────────────────────────────────────────
const p = (html, style = 'margin:0 0 16px;font-size:15px;line-height:1.7;') => `<p style="${style}">${html}</p>`
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

export function reminderEmail(it) {
  const student = firstName(it.studentName) || 'your child'
  const hi = p(rich(`Hi ${it.parentName || 'there'},`))
  const signoff = p(rich('Kind regards,\nThe CUBE Team'), 'margin:28px 0 0;font-size:15px;line-height:1.7;')
  const reply = p(rich('If anything has changed, just reply to this email.'), 'margin:18px 0 0;font-size:14.5px;line-height:1.7;')
  if (it.kind === 'level_test') {
    return {
      subject: `Reminder: ${student}’s level test on ${dayLabel(it.slot.date)}`,
      html: shell(`
    ${hi}
    ${p(rich(`This is a reminder that ${student}’s level test is coming up:`), 'margin:0 0 18px;font-size:15px;line-height:1.7;')}
    ${slotCard(it.slot)}
    ${p(rich('It takes about 90 minutes. Afterwards we’ll send you a feedback report and recommend the right class.'), 'margin:18px 0 0;font-size:14.5px;line-height:1.7;')}
    ${reply}
    ${signoff}`),
    }
  }
  const which = it.lessonNo === 1 ? 'first' : 'second'
  const after = it.lessonNo === 1
    ? (it.nextDate ? `Their second trial lesson is on ${dayLabel(it.nextDate)}. ` : '') + 'There’s nothing to pay for the trial — just arrive a few minutes early and our team will look after the rest.'
    : 'We’ll be in touch after the lesson to hear how the trial went and to help with next steps if you’d like to continue.'
  return {
    subject: `Reminder: ${student}’s ${which} trial lesson on ${dayLabel(it.slot.date)}`,
    html: shell(`
    ${hi}
    ${p(rich(`This is a reminder that ${student}’s ${which} trial lesson in ${it.className} is coming up:`), 'margin:0 0 18px;font-size:15px;line-height:1.7;')}
    ${slotCard(it.slot)}
    ${p(rich(after), 'margin:18px 0 0;font-size:14.5px;line-height:1.7;')}
    ${reply}
    ${signoff}`),
  }
}

// One email for a send (reminderSends): a single reminder as above, or a
// student's trial lessons on the same day together.
export function reminderEmailFor(group) {
  if (group.length === 1) return reminderEmail(group[0])
  const [it] = group
  const student = firstName(it.studentName) || 'your child'
  const which = (g) => g.lessonNo === 1 ? 'first' : 'second'
  const label = (g) => p(rich(`**${g.className}** · ${which(g)} trial lesson`), 'margin:12px 0 6px;font-size:14px;line-height:1.5;')
  // "Their second trial lessons are on …", one line per later day.
  const next = {}
  for (const g of group) if (g.lessonNo === 1 && g.nextDate) (next[g.nextDate] ||= []).push(g.className)
  const nextLines = Object.keys(next).sort().map(d => next[d].length === group.length
    ? `Their second trial lessons are on ${dayLabel(d)}.`
    : `Their second ${next[d].join(' and ')} trial lesson is on ${dayLabel(d)}.`)
  const after = group.some(g => g.lessonNo === 1)
    ? [...nextLines, 'There’s nothing to pay for the trial — just arrive a few minutes early and our team will look after the rest.'].join(' ')
    : 'We’ll be in touch after the lessons to hear how the trial went and to help with next steps if you’d like to continue.'
  return {
    subject: `Reminder: ${student}’s trial lessons on ${dayLabel(it.slot.date)}`,
    html: shell(`
    ${p(rich(`Hi ${it.parentName || 'there'},`))}
    ${p(rich(`This is a reminder that ${student} has ${group.length === 2 ? 'two' : group.length} trial lessons coming up on ${dayLabel(it.slot.date)}:`), 'margin:0 0 8px;font-size:15px;line-height:1.7;')}
    ${group.map(g => label(g) + slotCard(g.slot)).join('')}
    ${p(rich(after), 'margin:18px 0 0;font-size:14.5px;line-height:1.7;')}
    ${p(rich('If anything has changed, just reply to this email.'), 'margin:18px 0 0;font-size:14.5px;line-height:1.7;')}
    ${p(rich('Kind regards,\nThe CUBE Team'), 'margin:28px 0 0;font-size:15px;line-height:1.7;')}`),
  }
}

// ── Loading ──────────────────────────────────────────────────────────────────
// Every reminder item from the live data (service-role client).
export async function loadReminderItems(sb, { now = new Date() } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(now)
  const back = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(now.getTime() - 100 * 86400e3))
  const soon = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(now.getTime() + 2 * 86400e3))
  const [{ data: enrolments, error: e1 }, { data: ltLessons, error: e2 }] = await Promise.all([
    sb.from('enrolments').select('id, student_id, class_id, trial_start_date, created_at').eq('status', 'trial').not('class_id', 'is', null),
    sb.from('lessons').select('id, lesson_date, start_time, end_time, room, status, student_name')
      .eq('lesson_type', 'level_test').gte('lesson_date', today).lte('lesson_date', soon),
  ])
  if (e1) throw e1
  if (e2) throw e2
  const classIds = [...new Set((enrolments || []).map(e => e.class_id))]
  const studentIds = [...new Set((enrolments || []).map(e => e.student_id))]
  const ltIds = (ltLessons || []).map(l => l.id)
  const [lessons, classes, students, guardians, subs, invites] = await Promise.all([
    // From a term back: enough for any trial still running, under the row cap.
    classIds.length ? sb.from('lessons').select('class_id, lesson_date, start_time, end_time, room').in('class_id', classIds)
      .eq('is_makeup', false).neq('status', 'cancelled').gte('lesson_date', back).order('lesson_date') : { data: [] },
    classIds.length ? sb.from('classes').select('id, class_name, start_time, end_time').in('id', classIds) : { data: [] },
    studentIds.length ? sb.from('students').select('id, full_name').in('id', studentIds) : { data: [] },
    studentIds.length ? sb.from('guardians').select('student_id, full_name, email').in('student_id', studentIds) : { data: [] },
    sb.from('trial_submissions').select('id, enrolment_id, converted_student_id, trial_class_id, status, parent_name, parent_email, student_name'),
    ltIds.length ? sb.from('level_test_invites').select('lesson_id, submission_id, student_name, responded_at').in('lesson_id', ltIds) : { data: [] },
  ])
  return [
    ...trialItems({ enrolments: enrolments || [], lessons: lessons.data || [], classes: classes.data || [], students: students.data || [], subs: subs.data || [], guardians: guardians.data || [] }),
    ...levelTestItems({ lessons: ltLessons || [], invites: invites.data || [], subs: subs.data || [] }),
  ]
}

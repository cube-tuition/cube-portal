/*
 * Server-only helpers for the trial invitation class picker (lib/trialInvite).
 * trial_invites is directors-only; the family's form is let in by the token in
 * their email link, checked here, and acts through the service role.
 */
import { randomBytes } from 'node:crypto'
import { normaliseSections, otherOptions } from './trialInvite.js'
import { matchTrialClasses, firstWeekdayOnOrAfter } from './trialInvitationEmail.js'
import { getEnrolmentTerm } from './terms.js'
import { normaliseTerms } from './termDates.js'

export { serviceClient, sydneyToday } from './levelTestInviteServer.js'

export const newTrialToken = () => randomBytes(32).toString('base64url')
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.cubetuition.com.au').replace(/\/+$/, '')
export const trialInviteLink = (token) => `${siteUrl()}/trial/${token}`
// A test send links to a preview of the form that books nothing.
export const trialPreviewLink = (sections) =>
  `${siteUrl()}/trial/preview?d=${Buffer.from(JSON.stringify({ s: sections })).toString('base64url')}`

export async function trialInviteByToken(sb, token) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(token || ''))) return null
  const { data } = await sb.from('trial_invites').select('*').eq('token', token).maybeSingle()
  return data || null
}

/** Save the offered classes and return the form link. Nothing offered → no form. */
export async function createTrialInvite(sb, { submissionIds, parentEmail, parentName, studentName, sections, source = 'invitation' }) {
  const clean = normaliseSections(sections)
  if (!clean.length) return null
  const token = newTrialToken()
  const { error } = await sb.from('trial_invites').insert({
    token, submission_ids: submissionIds, parent_email: parentEmail || null, parent_name: parentName || null,
    student_name: studentName || null, sections: clean, source,
  })
  if (error) throw error
  return { token, link: trialInviteLink(token), sections: clean }
}

/*
 * Book a trial class for one subject's submission: its trial enrolment gets
 * the class and the first trial lesson, and the card moves to Trial scheduled
 * — the same writes as assigning a class on the Trials page. The enquiry form
 * already made the student, guardian and a classless trial enrolment.
 */
export async function bookTrialClass(sb, sub, { classId, firstDate }) {
  let studentId = sub.converted_student_id
  if (!studentId) {
    const { data: st, error } = await sb.from('students')
      .insert({ full_name: sub.student_name || 'Unknown', year: sub.student_year || null, school: sub.school || null, status: 'trial' })
      .select('id').single()
    if (error) throw error
    studentId = st.id
    if (sub.parent_name || sub.parent_email || sub.parent_phone) {
      await sb.from('guardians').insert({ student_id: studentId, full_name: sub.parent_name || null, email: sub.parent_email || null, phone: sub.parent_phone || null })
    }
    // Before the enrolment, so the enrolments trigger sees this submission.
    await sb.from('trial_submissions').update({ converted_student_id: studentId }).eq('id', sub.id)
  }
  let enrolmentId = null
  if (sub.enrolment_id) {
    // price: null → the database fills the class's course price.
    const { data } = await sb.from('enrolments').update({ class_id: classId, price: null, trial_start_date: firstDate })
      .eq('id', sub.enrolment_id).in('status', ['trial', 'trial complete']).select('id')
    enrolmentId = data?.[0]?.id ?? null
  }
  if (!enrolmentId) {
    const { data, error } = await sb.from('enrolments')
      .insert({ student_id: studentId, class_id: classId, status: 'trial', trial_start_date: firstDate }).select('id').single()
    if (error) throw error
    enrolmentId = data.id
  }
  const patch = { trial_class_id: classId, converted_student_id: studentId, enrolment_id: enrolmentId }
  if (['new', 'contacted', 'on_hold'].includes(sub.status)) Object.assign(patch, { status: 'trial_scheduled', held_at: null, hold_until: null, hold_notified_at: null })
  const { error } = await sb.from('trial_submissions').update(patch).eq('id', sub.id)
  if (error) throw error
  await sb.from('students').update({ status: 'trial' }).eq('id', studentId).eq('status', 'pending')
  return enrolmentId
}

/*
 * Classes to offer when nobody picked them by hand (the level test results
 * email): for each submission, this term's classes matched on year, subject
 * and the family's availability — the best four, each with its next lesson.
 */
// This term's live classes (the term a new student would join).
async function enrolmentTermClasses(sb) {
  const { data: terms } = await sb.from('terms').select('*')
  // Start dates read as the Monday of the first week, as everywhere else (lib/termDates).
  const term = getEnrolmentTerm(normaliseTerms(terms || []).filter(t => !/holiday/i.test(t.name || '')))
  if (!term) return { term: null, live: [] }
  const { data: classes } = await sb.from('classes').select('id, class_name, day_of_week, start_time, end_time, course_id, status')
    .eq('term_id', term.id)
  return { term, live: (classes || []).filter(c => !c.status || c.status === 'active') }
}
const subjectOf = (s) => (Array.isArray(s.subjects) ? s.subjects[0] : s.subjects) || ''

/*
 * Every class a director could offer an enquiry, for the results email's
 * picker: the subject's classes in every year, the student's own year first,
 * each flagged otherYear and with whether the automatic offer would include
 * it. [{ submission_id, label, classes: [{ id, class_name, day, start, end, fit, otherYear, auto }] }]
 */
export async function trialClassCandidates(sb, subs) {
  const { live } = await enrolmentTermClasses(sb)
  return subs.map(s => {
    const all = matchTrialClasses({ year: s.student_year, subject: subjectOf(s), availability: s.availability }, live, { anyYear: true })
    const auto = new Set(all.filter(c => !c.otherYear).slice(0, 4).map(c => c.id))
    return {
      submission_id: s.id,
      label: `${(Array.isArray(s.subjects) ? s.subjects.join(', ') : s.subjects) || 'Trial'} · Year ${s.student_year || '?'}`,
      classes: all.map(c => ({ id: c.id, class_name: c.class_name, day: c.day_of_week || '', start: String(c.start_time || '').slice(0, 5), end: String(c.end_time || '').slice(0, 5), fit: c.fit, otherYear: !!c.otherYear, auto: auto.has(c.id) })),
    }
  })
}

// picks: { [submission_id]: [class ids] } chosen by hand (any year) — those
// classes are offered instead of the automatic match for that enquiry.
// others: { [submission_id]: [{ label, date?, start?, end? }] } — "other"
// options typed by hand (e.g. "Y7 English 1:1"), offered after the classes.
export async function autoTrialSections(sb, subs, today, picks = {}, others = {}) {
  const { term, live } = await enrolmentTermClasses(sb)
  if (!term) return []
  const ranked = subs.map(s => {
    const chosen = Array.isArray(picks?.[s.id]) ? picks[s.id].map(Number) : null
    const list = chosen
      ? chosen.map(id => live.find(c => c.id === id)).filter(Boolean)
      : matchTrialClasses({ year: s.student_year, subject: subjectOf(s), availability: s.availability }, live).slice(0, 4)
    return { s, list }
  })
  const ids = [...new Set(ranked.flatMap(r => r.list.map(c => c.id)))]
  const next = {}
  if (ids.length) {
    const { data: lessons } = await sb.from('lessons').select('class_id, lesson_date').in('class_id', ids)
      .gte('lesson_date', today).or('is_makeup.is.null,is_makeup.eq.false')
      .or('status.is.null,status.neq.cancelled').order('lesson_date')
    for (const l of lessons || []) if (!(l.class_id in next)) next[l.class_id] = l.lesson_date
  }
  const from = term.start_date > today ? term.start_date : today
  // The family-facing heading: the subject — no year, since the classes
  // offered can be another year's — with the child's name for siblings.
  const siblings = new Set(subs.map(s => String(s.student_name || '').trim().toLowerCase())).size > 1
  const heading = (s) => {
    const subject = (Array.isArray(s.subjects) ? s.subjects.join(', ') : s.subjects) || 'Trial'
    return siblings ? `${String(s.student_name || '').trim().split(/\s+/)[0] || 'Student'} — ${subject}` : subject
  }
  return ranked.map(({ s, list }) => ({
    submission_id: s.id,
    label: heading(s),
    options: [
      ...list.map(c => ({
        kind: 'class', class_id: c.id, class_name: c.class_name, day: c.day_of_week || '',
        start: String(c.start_time || '').slice(0, 5), end: String(c.end_time || '').slice(0, 5),
        date: next[c.id] || firstWeekdayOnOrAfter(from, c.day_of_week),
      })).filter(o => o.date),
      ...otherOptions(others?.[s.id]),
    ],
  })).filter(sec => sec.options.length)
}

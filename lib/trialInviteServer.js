/*
 * Server-only helpers for the trial invitation class picker (lib/trialInvite).
 * trial_invites is directors-only; the family's form is let in by the token in
 * their email link, checked here, and acts through the service role.
 */
import { randomBytes } from 'node:crypto'
import { normaliseSections } from './trialInvite.js'
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
export async function autoTrialSections(sb, subs, today) {
  const { data: terms } = await sb.from('terms').select('*')
  // Start dates read as the Monday of the first week, as everywhere else (lib/termDates).
  const term = getEnrolmentTerm(normaliseTerms(terms || []).filter(t => !/holiday/i.test(t.name || '')))
  if (!term) return []
  const { data: classes } = await sb.from('classes').select('id, class_name, day_of_week, start_time, end_time, course_id, status')
    .eq('term_id', term.id)
  const live = (classes || []).filter(c => !c.status || c.status === 'active')
  const ranked = subs.map(s => ({ s, list: matchTrialClasses({ year: s.student_year, subject: (Array.isArray(s.subjects) ? s.subjects[0] : s.subjects) || '', availability: s.availability }, live).slice(0, 4) }))
  const ids = [...new Set(ranked.flatMap(r => r.list.map(c => c.id)))]
  const next = {}
  if (ids.length) {
    const { data: lessons } = await sb.from('lessons').select('class_id, lesson_date').in('class_id', ids)
      .gte('lesson_date', today).or('is_makeup.is.null,is_makeup.eq.false')
      .or('status.is.null,status.neq.cancelled').order('lesson_date')
    for (const l of lessons || []) if (!(l.class_id in next)) next[l.class_id] = l.lesson_date
  }
  const from = term.start_date > today ? term.start_date : today
  return ranked.filter(r => r.list.length).map(({ s, list }) => ({
    submission_id: s.id,
    label: `${(Array.isArray(s.subjects) ? s.subjects.join(', ') : s.subjects) || 'Trial'} · Year ${s.student_year || '?'}`,
    options: list.map(c => ({
      kind: 'class', class_id: c.id, class_name: c.class_name, day: c.day_of_week || '',
      start: String(c.start_time || '').slice(0, 5), end: String(c.end_time || '').slice(0, 5),
      date: next[c.id] || firstWeekdayOnOrAfter(from, c.day_of_week),
    })).filter(o => o.date),
  }))
}

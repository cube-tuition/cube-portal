/*
 * Unmarked rolls → the tutor who ran the lesson.
 *
 * The morning job (app/api/reminders/daily) sends each tutor one nudge listing
 * their lessons from the last NUDGE_DAYS days that have finished but have no
 * attendance saved — an email, plus a push to anyone with the iPhone app.
 * A lesson stays on the list each morning until it is marked; after
 * NUDGE_DAYS it drops off the tutor's list and is left to the directors
 * (Action Centre, /tutor/unsaved-sessions).
 *
 * "The tutor who ran it" is lib/lessonAccess effectiveTeacher: the lesson's
 * scheduled teacher, else the class's main teacher. Directors are left out
 * (they see the Action Centre), as are makeups, level tests, cancelled
 * lessons and classes with nobody enrolled to mark.
 *
 * unmarkedByTutor() is pure (tests/rollNudges.test.mjs).
 */
import { effectiveTeacher } from './lessonAccess.js'
import { shell, rich } from './levelTestInvite.js'

export const NUDGE_DAYS = 7
const sydneyDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d)
const sydneyMinutes = (d) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':').map(Number)
  return h * 60 + m
}
const minutes = (t) => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null }

/*
 *   lessons      [{ id, class_id, lesson_date, start_time, end_time, status, is_makeup, lesson_type, main_teacher, scheduled_teacher_id }]
 *   classes      [{ id, class_name, teacher, end_time }]
 *   marked       Set of "class_id|session_date" with attendance saved
 *   enrolled     Set of class ids with at least one active / trial enrolment
 *   staff        [{ id, full_name, email }]
 *   directorIds  Set of director ids
 * Returns [{ tutor: { id, full_name, email }, lessons: [{ class_id, class_name, lesson_date, start_time }] }].
 */
export function unmarkedByTutor({ lessons = [], classes = [], marked = new Set(), enrolled = new Set(), staff = [], directorIds = new Set(), now = new Date() }) {
  const today = sydneyDate(now)
  const from = sydneyDate(new Date(now.getTime() - NUDGE_DAYS * 86400e3))
  const nowMin = sydneyMinutes(now)
  const classById = Object.fromEntries(classes.map(c => [c.id, c]))
  const byTutor = new Map()
  for (const l of lessons) {
    if (l.status === 'cancelled' || l.is_makeup || (l.lesson_type && l.lesson_type !== 'class')) continue
    if (l.lesson_date < from || l.lesson_date > today) continue
    const cls = classById[l.class_id]
    if (!cls || !enrolled.has(l.class_id)) continue
    // Today's lesson only once it has finished.
    if (l.lesson_date === today) {
      const end = minutes(l.end_time || cls.end_time)
      if (end == null || end > nowMin) continue
    }
    if (marked.has(`${l.class_id}|${l.lesson_date}`)) continue
    const t = effectiveTeacher(l, cls, staff)
    if (!t?.id || directorIds.has(t.id)) continue
    const tutor = staff.find(s => s.id === t.id)
    if (!tutor) continue
    if (!byTutor.has(tutor.id)) byTutor.set(tutor.id, { tutor, lessons: [] })
    byTutor.get(tutor.id).lessons.push({ class_id: l.class_id, class_name: cls.class_name, lesson_date: l.lesson_date, start_time: String(l.start_time || '').slice(0, 5) })
  }
  return [...byTutor.values()].map(g => ({
    ...g,
    lessons: g.lessons.sort((a, b) => a.lesson_date.localeCompare(b.lesson_date) || a.class_name.localeCompare(b.class_name)),
  }))
}

const time12 = (t) => {
  const [h, m] = String(t || '').split(':').map(Number)
  return Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` : ''
}
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })

export function rollNudgePush({ tutor, lessons }) {
  const first = lessons[0]
  return {
    title: lessons.length === 1 ? `📋 Mark the roll: ${first.class_name}` : `📋 ${lessons.length} rolls to mark`,
    body: lessons.length === 1
      ? `${dayLabel(first.lesson_date)} — attendance hasn't been saved yet.`
      : lessons.map(l => `${l.class_name} (${dayLabel(l.lesson_date)})`).join(', '),
    url: lessons.length === 1 ? `/tutor/classes/${first.class_id}/${first.lesson_date}` : '/tutor/classes',
    tag: `roll-nudge-${tutor.id}`,
  }
}

export function rollNudgeEmail({ tutor, lessons }, portalUrl = 'https://portal.cubetuition.com.au') {
  const firstName = String(tutor.full_name || '').trim().split(/\s+/)[0] || 'there'
  const rows = lessons.map(l => `
    <a href="${portalUrl}/tutor/classes/${l.class_id}/${l.lesson_date}" style="display:block;text-decoration:none;margin:0 0 8px;background:#F8FAFF;border:1px solid #DEE7FF;border-radius:10px;padding:11px 16px;">
      <span style="display:block;font-size:14px;font-weight:700;color:#062E63;">${rich(l.class_name)}</span>
      <span style="display:block;margin-top:2px;font-size:13px;color:#2A2035;">${rich(dayLabel(l.lesson_date))}${l.start_time ? ` · ${rich(time12(l.start_time))}` : ''} — mark the roll →</span>
    </a>`).join('')
  return {
    subject: lessons.length === 1
      ? `Please mark the roll — ${lessons[0].class_name}, ${dayLabel(lessons[0].lesson_date)}`
      : `Please mark ${lessons.length} rolls`,
    html: shell(`
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">${rich(`Hi ${firstName},`)}</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">${rich(lessons.length === 1
      ? 'Attendance hasn’t been saved for this lesson yet:'
      : 'Attendance hasn’t been saved for these lessons yet:')}</p>
    ${rows}
    <p style="margin:18px 0 0;font-size:14.5px;line-height:1.7;">${rich('The roll feeds your pay, trial feedback and absence follow-ups, so please mark it today. If a lesson didn’t run, let a director know so it can be cancelled.')}</p>
    <p style="margin:28px 0 0;font-size:15px;line-height:1.7;">${rich('Thanks,\nThe CUBE Team')}</p>`),
  }
}

// Read everything the rule needs (service-role client).
export async function loadUnmarkedByTutor(sb, { now = new Date() } = {}) {
  const today = sydneyDate(now)
  const from = sydneyDate(new Date(now.getTime() - NUDGE_DAYS * 86400e3))
  const { data: lessons, error } = await sb.from('lessons')
    .select('id, class_id, lesson_date, start_time, end_time, status, is_makeup, lesson_type, main_teacher, scheduled_teacher_id')
    .gte('lesson_date', from).lte('lesson_date', today).not('class_id', 'is', null)
  if (error) throw error
  const classIds = [...new Set((lessons || []).map(l => l.class_id))]
  if (!classIds.length) return []
  const [classes, att, enrols, staff, directors] = await Promise.all([
    sb.from('classes').select('id, class_name, teacher, end_time').in('id', classIds),
    sb.from('attendance').select('class_id, session_date').in('class_id', classIds).gte('session_date', from).lte('session_date', today),
    sb.from('enrolments').select('class_id').in('class_id', classIds).in('status', ['active', 'trial']),
    sb.from('tutors').select('id, full_name, email').eq('active', true),
    sb.from('directors').select('id'),
  ])
  for (const r of [classes, att, enrols, staff, directors]) if (r.error) throw r.error
  return unmarkedByTutor({
    lessons: lessons || [], classes: classes.data || [],
    marked: new Set((att.data || []).map(a => `${a.class_id}|${a.session_date}`)),
    enrolled: new Set((enrols.data || []).map(e => e.class_id)),
    staff: staff.data || [], directorIds: new Set((directors.data || []).map(d => d.id)), now,
  })
}

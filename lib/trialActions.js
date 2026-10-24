/*
 * Trial actionables for the home page's Action Centre — the action each
 * open trial card's stage pill asks for (lib/trialNextStep trialStage),
 * worked out the way the Trials page does: one item per student, with the
 * family's first emails (invitation, level test) counting for every subject,
 * and per-subject items once the subjects are at different stages.
 *
 * trialActionables(subs, today, nowTime) is pure (tests/trialActions.test.mjs);
 * loadTrialActionables(sb) reads the same extras the Trials page loads —
 * trial lesson dates, the level test booking and the class-picker answer.
 */
import { trialStage, sydneyClock } from './trialNextStep.js'
import { trialDatesFor } from './trialDates.js'
import { inviteAnswer } from './trialInvite.js'

const CLOSED = ['enrolled', 'declined', 'on_hold']
const familyKey = (s) => s.converted_student_id
  || `${(s.student_name || '').trim().toLowerCase()}|${(s.parent_email || '').trim().toLowerCase()}`
const subjectOf = (s) => (Array.isArray(s.subjects) ? s.subjects.join(', ') : s.subjects) || 'Subject'

/** [{ key, student, label, detail, stage }] — one per action to take. */
export function trialActionables(subs = [], today, nowTime = null) {
  const groups = new Map()
  for (const s of subs.filter(x => !CLOSED.includes(x.status))) {
    const k = familyKey(s)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(s)
  }
  const out = []
  for (const [key, list] of groups) {
    list.sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)))
    const earliest = (f) => list.map(s => s[f]).filter(Boolean).sort()[0] || null
    const family = {
      invitation_sent_at: earliest('invitation_sent_at'),
      level_test_invitation_sent_at: earliest('level_test_invitation_sent_at'),
      _levelTest: list.find(s => s._levelTest?.booked)?._levelTest || list.find(s => s._levelTest)?._levelTest || null,
    }
    const withFamily = (s) => ({
      ...s,
      invitation_sent_at: s.invitation_sent_at || family.invitation_sent_at,
      level_test_invitation_sent_at: s.level_test_invitation_sent_at || family.level_test_invitation_sent_at,
      _levelTest: s._levelTest?.booked ? s._levelTest : (family._levelTest || s._levelTest),
    })
    const stages = list.map(s => ({ sub: s, stage: trialStage(withFamily(s), today, nowTime) })).filter(x => x.stage)
    const same = stages.every(x => x.stage.id === stages[0]?.stage.id && x.stage.action?.key === stages[0]?.stage.action?.key)
    const items = same && stages.length && !['trial_1', 'trial_2', 'deciding'].includes(stages[0].stage.id)
      ? [{ ...stages[0], prefix: '' }]
      : stages.map(x => ({ ...x, prefix: list.length > 1 ? `${subjectOf(x.sub)}: ` : '' }))
    for (const it of items) {
      if (!it.stage.action) continue
      const student = it.sub.student_name || 'Trial student'
      out.push({
        key: `${key}:${it.sub.id}:${it.stage.action.key}`, student, stage: it.stage,
        label: `${student} — ${it.prefix}${it.stage.action.label}`,
        detail: [it.stage.label, it.stage.note].filter(Boolean).join(' · '),
      })
    }
  }
  return out
}

export async function loadTrialActionables(sb, { now = new Date() } = {}) {
  const { today, time } = sydneyClock(now)
  const { data: subs, error } = await sb.from('trial_submissions').select('*').not('status', 'in', `(${CLOSED.join(',')})`)
  if (error) throw error
  if (!subs?.length) return []
  const studentIds = [...new Set(subs.map(s => s.converted_student_id).filter(Boolean))]
  const classIds = [...new Set(subs.map(s => s.trial_class_id).filter(c => c != null))]
  const ids = subs.map(s => s.id)
  const [enr, lessons, lts, invites] = await Promise.all([
    studentIds.length ? sb.from('enrolments').select('student_id, class_id, trial_start_date').in('student_id', studentIds).in('status', ['trial', 'trial complete']) : { data: [] },
    classIds.length ? sb.from('lessons').select('class_id, lesson_date').in('class_id', classIds).eq('is_makeup', false).neq('status', 'cancelled').order('lesson_date') : { data: [] },
    sb.from('level_test_invites').select('submission_id, lesson_id, parent_note, responded_at, lessons:lesson_id(lesson_date, start_time, end_time, report_emailed_at)').in('submission_id', ids),
    sb.from('trial_invites').select('submission_ids, sections, picks, note, responded_at, created_at').overlaps('submission_ids', ids).order('created_at'),
  ])
  const datesByClass = {}
  for (const l of lessons.data || []) (datesByClass[l.class_id] ||= []).push(l.lesson_date)
  const ltBySub = Object.fromEntries((lts.data || []).map(i => [i.submission_id, i]))
  const pickBySub = {}
  for (const inv of invites.data || []) {
    for (const sid of inv.submission_ids || []) {
      pickBySub[sid] = inviteAnswer(inv, sid)
    }
  }
  for (const s of subs) {
    const row = (enr.data || []).find(r => r.student_id === s.converted_student_id && r.class_id === s.trial_class_id)
    s._trialDates = s.trial_class_id != null ? trialDatesFor([...new Set(datesByClass[s.trial_class_id] || [])], row?.trial_start_date || null) : []
    const i = ltBySub[s.id]
    s._levelTest = i ? {
      booked: i.lessons ? { date: i.lessons.lesson_date, start: String(i.lessons.start_time || '').slice(0, 5), end: String(i.lessons.end_time || '').slice(0, 5) } : null,
      note: i.responded_at && !i.lessons ? (i.parent_note || '') : '',
      reportSent: !!i.lessons?.report_emailed_at,
    } : null
    s._trialInvite = pickBySub[s.id] || null
  }
  return trialActionables(subs, today, time)
}

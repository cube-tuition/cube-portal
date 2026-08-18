import { supabase } from './supabase'
import { T_STUDENT_FLAGS } from './tables'

/*
 * Student flags — a tutor raises one from the lesson page when something about
 * a student needs a director's attention. Flags stay open (and therefore keep
 * showing in the Action Centre) until a director resolves them.
 *
 * Writing goes through createFlag() so every caller stores the same shape,
 * including the denormalised student/class names the Action Centre renders
 * without a join.
 */

export const FLAG_REASONS = [
  { value: 'attendance',    label: 'Attendance',    icon: '📅', hint: 'Lateness, absences, a pattern of missed lessons' },
  { value: 'homework',      label: 'Homework',      icon: '📚', hint: 'Repeatedly incomplete or not attempted' },
  { value: 'behaviour',     label: 'Behaviour',     icon: '⚠️', hint: 'Disruption, attitude, an incident in class' },
  { value: 'understanding', label: 'Understanding', icon: '🧠', hint: 'Falling behind, a concept that has not landed' },
  { value: 'engagement',    label: 'Engagement',    icon: '💤', hint: 'Disengaged, not participating, low effort' },
  { value: 'wellbeing',     label: 'Wellbeing',     icon: '💛', hint: 'Something pastoral — mood, stress, a worry at home' },
  { value: 'other',         label: 'Other',         icon: '🚩', hint: 'Anything else worth raising' },
]

export const reasonMeta = (v) =>
  FLAG_REASONS.find(r => r.value === v) || { value: v, label: v, icon: '🚩', hint: '' }

// Wellbeing is acted on the same day; everything else can wait a day or two,
// then escalates so nothing quietly rots in the list.
export const STALE_FLAG_DAYS = 3

export function flagSeverity(flag) {
  if (flag.reason === 'wellbeing') return 'red'
  const age = Date.now() - new Date(flag.created_at).getTime()
  return age > STALE_FLAG_DAYS * 86400000 ? 'red' : 'amber'
}

export async function createFlag({
  student, classId = null, className = null, lessonDate = null,
  reason, note = '', staff = null,
}) {
  if (!student?.id) throw new Error('Pick a student')
  if (!reason) throw new Error('Pick a reason')
  const row = {
    student_id: student.id,
    student_name: student.full_name || 'Unknown',
    class_id: classId ?? null,
    class_name: className ?? null,
    lesson_date: lessonDate ?? null,
    reason,
    note: (note || '').trim() || null,
    raised_by: staff?.id ?? null,
    raised_by_name: staff?.full_name ?? null,
  }
  const { data, error } = await supabase.from(T_STUDENT_FLAGS).insert(row).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function openFlags() {
  const { data, error } = await supabase.from(T_STUDENT_FLAGS)
    .select('*').eq('status', 'open').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function allFlags({ limit = 400 } = {}) {
  const { data, error } = await supabase.from(T_STUDENT_FLAGS)
    .select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function resolveFlag(id, { resolution = '', staff = null } = {}) {
  const { error } = await supabase.from(T_STUDENT_FLAGS).update({
    status: 'resolved',
    resolution: (resolution || '').trim() || null,
    resolved_by: staff?.id ?? null,
    resolved_by_name: staff?.full_name ?? null,
    resolved_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function reopenFlag(id) {
  const { error } = await supabase.from(T_STUDENT_FLAGS).update({
    status: 'open', resolution: null, resolved_by: null,
    resolved_by_name: null, resolved_at: null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
}

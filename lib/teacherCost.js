import { isOneToOneClass } from './classFormat'

/*
 * Teacher-cost projection — shared between the accounting Forecast page and the
 * accounting dashboard so they can't drift. A class's termly teacher fee is
 * lessonHours × hourly rate × LESSONS_PER_TERM. Rates come from the rate matrix
 * (current_tutor_rates), keyed by tutor + year band + mode (1:1 vs class).
 */

export const LESSONS_PER_TERM = 10
export const SUPER_RATE = 0.12   // 12% superannuation (not paid to cash tutors)

const parseTimeToMins = (t) => {
  if (!t) return 0
  const [h, m] = String(t).split(':').map(Number)
  return h * 60 + (m || 0)
}
export const lessonHoursFromClass = (cls) =>
  Math.max(0, (parseTimeToMins(cls.end_time) - parseTimeToMins(cls.start_time)) / 60)

export function yearBandFromClassName(name) {
  if (!name) return null
  const m = name.match(/Y(\d+)/i)
  // Year-less classes (Speaking Development, HW Help…) use the 'other' band —
  // same fallback as the DB's resolve_matrix_rate.
  if (!m) return 'other'
  const y = parseInt(m[1])
  if (y <= 6)  return '1-6'
  if (y <= 8)  return '7-8'
  if (y <= 10) return '9-10'
  return '11-12'
}

// classes.teacher is a free-typed name, sometimes just a first name. Resolve it
// to a staff record by exact full-name match first, then by first-name-token
// equality ("Sam" must not match "Samantha", which startsWith did). If two staff
// share the typed first name the match is ambiguous — return null so the class
// shows up as missing-rate rather than silently costing the wrong teacher.
export function findTeacher(teacherName, tutors = []) {
  const name = (teacherName || '').trim().toLowerCase()
  if (!name) return null
  const exact = tutors.filter(t => (t.full_name || '').trim().toLowerCase() === name)
  if (exact.length === 1) return exact[0]
  const first = name.split(/\s+/)[0]
  const byFirst = tutors.filter(t => (t.full_name || '').trim().toLowerCase().split(/\s+/)[0] === first)
  return byFirst.length === 1 ? byFirst[0] : null
}

// Rate + tutor for a class. ctx = { tutors, rateMatrix, courseModes }, where
// courseModes maps course_id → 'Class' | '1:1' (courses.delivery_mode).
export function rateForClass(cls, { tutors = [], rateMatrix = [], courseModes = {} } = {}) {
  const tutor = findTeacher(cls.teacher, tutors)
  if (!tutor) return { rate: null, tutor: null }
  const band = yearBandFromClassName(cls.class_name)
  const mode = isOneToOneClass(cls, courseModes) ? 'tutor' : 'class'
  const row  = rateMatrix.find(r => r.tutor_id === tutor.id && r.year_band === band && r.mode === mode)
  return { rate: row ? Number(row.hourly_rate) : null, tutor }
}

// Projected full-term teacher pay for the given classes, optionally restricted to
// a pay method ('cash' | 'bank'). Returns { total, perTutor[], missingRate[] }.
export function projectedTeacherPay(classes = [], ctx = {}, { payMethod } = {}) {
  let total = 0
  const perTutor = {}
  const missingRate = []
  for (const cls of classes) {
    const { rate, tutor } = rateForClass(cls, ctx)
    if (!tutor) continue
    if (payMethod && (tutor.pay_method || 'bank') !== payMethod) continue
    if (!rate) { missingRate.push(cls.class_name || `Class ${cls.id}`); continue }
    const fee = lessonHoursFromClass(cls) * rate * LESSONS_PER_TERM
    total += fee
    if (!perTutor[tutor.id]) perTutor[tutor.id] = { id: tutor.id, name: tutor.full_name, amount: 0 }
    perTutor[tutor.id].amount += fee
  }
  return { total, perTutor: Object.values(perTutor).sort((a, b) => b.amount - a.amount), missingRate }
}

/*
 * Who may touch a lesson — the single source of truth.
 *
 * Two teachers can be attached to one session:
 *
 *   main teacher       classes.teacher, a free-text first or full name. Whoever
 *                      normally runs the class.
 *   scheduled teacher  lessons.scheduled_teacher_id, a real staff id. Whoever is
 *                      running THIS session. Unset means "the main teacher" —
 *                      the scheduled teacher defaults to them rather than to
 *                      nobody, so an untouched lesson behaves exactly as before.
 *
 * The rule, in one line: the scheduled teacher runs the session, so the
 * scheduled teacher edits it.
 *
 *   admin                                    → edit
 *   scheduled teacher (explicit or default)  → edit
 *   main teacher, when someone else is       → view: they keep sight of their
 *     scheduled                                own class without being able to
 *                                              mark a session they didn't teach
 *   sub_assignments row (older mechanism)    → edit
 *   anyone else                              → none
 *
 * Payroll follows the same person: the attendance→shift trigger
 * (create_shift_from_class_attendance) reads lessons.scheduled_teacher_id and
 * falls back to the class teacher's name, so the shift lands on whoever this
 * module says holds `edit`.
 */

export const firstName = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()

/** Match a free-text teacher name ("Charis", "Kevin Park") to a staff row.
 *  First names are what the class table stores, so that is what we compare on —
 *  the same rule `resolve_tutor_by_first_name` uses in the database. */
export function resolveTeacherByName(name, staffList = []) {
  const f = firstName(name)
  if (!f) return null
  return staffList.find(s => firstName(s.full_name) === f) || null
}

/**
 * Who is actually running this session.
 * Returns { id, name, isSub, isDefault } — isDefault means nobody was scheduled
 * explicitly, so this fell back to the class's main teacher.
 */
export function effectiveTeacher(lesson, cls, staffList = []) {
  const mainName = lesson?.main_teacher || cls?.teacher || ''
  const mainStaff = resolveTeacherByName(mainName, staffList)

  const schedId = lesson?.scheduled_teacher_id || null
  if (!schedId) {
    return {
      id: mainStaff?.id || null,
      name: mainStaff?.full_name || mainName || null,
      isSub: false,
      isDefault: true,
    }
  }
  const schedStaff = staffList.find(s => s.id === schedId) || null
  const name = schedStaff?.full_name || null
  return {
    id: schedId,
    name: name || mainName || null,
    // A sub is someone other than the main teacher. Compare on first name so
    // "Kevin" and "Kevin Park" aren't mistaken for two different people.
    isSub: !!name && !!mainName && firstName(name) !== firstName(mainName),
    isDefault: false,
  }
}

/**
 * What `staff` may do with this lesson: 'edit' | 'view' | 'none'.
 *
 * `subAssignment` is the row from sub_assignments for this class/date, if any —
 * pass it to keep the older covering mechanism working.
 */
export function lessonAccess({ lesson, cls, staff, staffList = [], subAssignment = null }) {
  if (!staff) return 'none'
  if (staff.role === 'admin') return 'edit'

  const eff = effectiveTeacher(lesson, cls, staffList)

  // Running this session — by explicit assignment, or by being the main teacher
  // when nobody else was scheduled.
  if (eff.id && eff.id === staff.id) return 'edit'

  // Covering it under the older sub_assignments mechanism.
  if (subAssignment && subAssignment.sub_tutor_id === staff.id) return 'edit'

  // The class's own teacher, with someone else scheduled: it is still their
  // class, so they may read it — but the person who taught it does the marking.
  const isMain = firstName(staff.full_name) === firstName(lesson?.main_teacher || cls?.teacher)
  if (isMain) return eff.isSub ? 'view' : 'edit'

  return 'none'
}

/** May this person open the class page at all? True if they can edit or view
 *  any of its lessons — checked across the term so an empty week never locks
 *  someone out of a class that is genuinely theirs. */
export function canOpenClass({ cls, staff, lessons = [], staffList = [], subAssignments = {} }) {
  if (!staff) return false
  if (staff.role === 'admin') return true
  if (firstName(staff.full_name) === firstName(cls?.teacher)) return true
  if (Object.values(subAssignments).some(s => s?.sub_tutor_id === staff.id)) return true
  return lessons.some(l =>
    lessonAccess({ lesson: l, cls, staff, staffList }) !== 'none')
}

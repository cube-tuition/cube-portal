/*
 * Homework grades (the A–E "previous week's HWK" mark) are not kept for senior
 * classes — Year 11 and 12. Seniors are set work differently and the grade was
 * not telling anyone anything, so it is neither collected nor shown for them:
 * not on the lesson tab, not in reports, not on the student's own class page.
 *
 * Existing grades are left in quiz_results untouched. Nothing is deleted — the
 * rule is about what is asked for and displayed from now on, and hiding rather
 * than deleting keeps the decision reversible.
 *
 * Which classes count as senior:
 *   - the class name carries the year, as nearly all of them do ("Y11
 *     Chemistry", "Y12 Advanced Maths 1:1"); otherwise
 *   - the roster decides, for the handful of classes named without a year
 *     ("Speaking Development 1:1", whose student is in Year 11). A class counts
 *     as senior only if EVERY student on it whose year is known is Year 11+, so
 *     a mixed class keeps its homework column.
 */
const SENIOR_FROM = 11

export function isSeniorClass(cls, roster = []) {
  const m = String(cls?.class_name || '').match(/Y(\d+)/i)
  if (m) return parseInt(m[1], 10) >= SENIOR_FROM
  const years = (roster || [])
    .map((s) => parseInt(s?.year ?? s?.students?.year, 10))
    .filter(Number.isFinite)
  return years.length > 0 && years.every((y) => y >= SENIOR_FROM)
}

// The question every caller actually asks.
export const showsHomeworkGrade = (cls, roster) => !isSeniorClass(cls, roster)

// For screens that hold a student rather than a class (the analytics roster),
// where every class the student sits in is a senior one.
export const isSeniorStudent = (student) =>
  Number.isFinite(parseInt(student?.year, 10)) && parseInt(student.year, 10) >= SENIOR_FROM

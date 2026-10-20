/*
 * Which of a booklet's stored PDFs is which, by its storage path (and, where
 * given, its display name). Publishing names the copies *_student.pdf,
 * *_solutions.pdf and *_quiz.pdf; older uploads carry .MS./.MT. style names.
 *
 * Students may open the student copy, and the solutions copy once it unlocks.
 * The revision quiz is printed and sat in class, so it is staff-only — every
 * student-facing list must filter with isStaffOnlyPath, not just isSolutionsPath.
 */
export const isSolutionsPath = (p) => /_solutions|_teacher|\.mt\./i.test(p || '')
export const isQuizPath = (p) => /_quiz\.pdf$|revision quiz/i.test(p || '')
export const isStaffOnlyPath = (p) => isSolutionsPath(p) || isQuizPath(p)

export const bookletPaths = (b) => (b?.file_paths?.length ? b.file_paths : (b?.file_path ? [b.file_path] : []))

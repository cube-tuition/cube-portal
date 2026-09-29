/*
 * One-off report merges — a student who changed class part-way through a term
 * gets ONE report for that term, drawn from both classes.
 *
 * The term report reads attendance and the weekly "no revision quiz" flags
 * from its own class only (quiz marks are matched by subject, so they already
 * span both classes). A student who moved class mid-term therefore showed
 * quiz marks for weeks with no attendance behind them, and still appeared —
 * with half a term — on the old class's report too.
 *
 * Each entry below is a deliberate, hand-made exception, not a rule: it names
 * the student, the term, the report kind(s), the class whose report they get
 * (`into`) and the class they left (`from`). For those reports only:
 *
 *   - `into` also loads their attendance from `from`, and for the weeks they
 *     sat in `from` uses that class's revision-quiz flags;
 *   - `from` leaves them off its roster, so no second report is made.
 *
 * Remove an entry once its reports have gone out; nothing else refers to it.
 */
export const REPORT_MERGES = [
  {
    // Susie Shin moved from Y9 English (Sat, until 5 Sep) to Y8 English (Tue,
    // from 6 Sep) in Term 3 2026. Her end-of-term report is the Y8 one.
    studentId: '2fe9ed13-112f-469a-bed0-83515606f7be',
    termId: '9217beb5-7ed2-42d4-b0b7-733e5a358558',
    kinds: ['end_of_term'],
    into: 621,
    from: 626,
  },
]

const applies = (m, termId, kindKey) => m.termId === termId && m.kinds.includes(kindKey)

/** Merges that bring a student INTO this class's report. */
export function mergesInto(classId, termId, kindKey) {
  return REPORT_MERGES.filter(m => applies(m, termId, kindKey) && Number(m.into) === Number(classId))
}

/** Student ids to leave OFF this class's report (they're reported in `into`). */
export function mergedAway(classId, termId, kindKey) {
  return new Set(REPORT_MERGES
    .filter(m => applies(m, termId, kindKey) && Number(m.from) === Number(classId))
    .map(m => m.studentId))
}

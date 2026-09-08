/*
 * Class membership is a PERIOD, not a flag.
 *
 * An enrolment row says which class a student is in, but a roll is a
 * per-session list: it has to be read AS AT that session's date, not as a flat
 * "are they in this class now". A student who left mid-term belongs on the
 * sessions they attended and on none of the ones after; a student who joined
 * mid-term belongs on none of the sessions before they arrived.
 *
 * Both ends are recorded on the row:
 *   started_at  — first date on the roll. NULL = since the class began.
 *   ended_at    — last date on the roll, alongside status 'disenrol'.
 *
 * Without the joining end, moving a student between classes rewrote history:
 * the new class listed them from week 1 of a term they had not been in, and the
 * old class — its enrolment deleted rather than ended — no longer recognised
 * them, so their real attendance made them look like a make-up guest.
 */
export const ENROLMENT_LEFT = 'disenrol'

/*
 * Has this enrolment already ended as at `dateISO`? An enrolment marked
 * 'disenrol' with no end date has ended with nothing to bound it, so it is off
 * the roll entirely — the marks already recorded stay visible in the class's
 * attendance history and reports.
 */
export const hasLeftBy = (status, endedAt, dateISO) =>
  status === ENROLMENT_LEFT && (!endedAt || dateISO > endedAt)

/* Had this student not yet joined as at `dateISO`? No start date means they
 * have always been in the class, which is true of every row predating this
 * column and of every row the term-transition wizard copies forward. */
export const hasNotJoinedBy = (startedAt, dateISO) =>
  !!startedAt && dateISO < startedAt

/*
 * On the roll for this session? Takes the shape SessionMarker keeps on a roster
 * entry (camelCase) or a raw enrolments row (snake_case), so callers can pass
 * either without reshaping.
 */
export const isOnRollAt = (e, dateISO) => {
  const status    = e.enrolmentStatus ?? e.status
  const startedAt = e.startedAt ?? e.started_at
  const endedAt   = e.endedAt ?? e.ended_at
  return !hasLeftBy(status, endedAt, dateISO) && !hasNotJoinedBy(startedAt, dateISO)
}

/*
 * Is this a CURRENT member of the class — the question head-counts and "students
 * enrolled" tiles ask? Independent of any date: a student who has left is not a
 * current member even though they still belong on the rolls they attended.
 */
export const isCurrentMember = (e) => (e.enrolmentStatus ?? e.status) !== ENROLMENT_LEFT

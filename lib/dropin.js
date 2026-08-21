/*
 * Drop-in session rules — year targeting and recurrence.
 *
 * Kept out of the pages so both portals apply the SAME rule: the director's
 * form previews exactly the dates it will create, and the student portal hides
 * exactly the sessions the director aimed away from them.
 */

// Years a drop-in can be aimed at. Students are stored with `year` as text
// ('5'…'12'), so these are strings and comparisons are string comparisons.
export const YEAR_GROUPS = ['5', '6', '7', '8', '9', '10', '11', '12']

/*
 * Is this session open to this student?
 *
 * An empty (or missing) year_groups means "every year" — that is what every
 * session created before year targeting existed looks like, and it keeps them
 * visible rather than silently hiding the lot. Targeting is opt-in.
 */
export function sessionOpenToYear(session, year) {
  const groups = session?.year_groups
  if (!Array.isArray(groups) || groups.length === 0) return true
  if (year == null || year === '') return false
  return groups.map(String).includes(String(year))
}

/* Filter a list of sessions down to the ones a student may see. */
export function visibleSessions(sessions, year) {
  return (sessions || []).filter((s) => sessionOpenToYear(s, year))
}

/* A short human label for the chips: "Years 7–9", "Year 6", "All years". */
export function yearGroupLabel(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return 'All years'
  const ns = groups.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  if (ns.length === 0) return 'All years'
  if (ns.length === 1) return `Year ${ns[0]}`
  // Collapse straight runs so a long tick-list reads as a range.
  const runs = []
  let start = ns[0], prev = ns[0]
  for (const n of ns.slice(1)) {
    if (n === prev + 1) { prev = n; continue }
    runs.push([start, prev]); start = prev = n
  }
  runs.push([start, prev])
  return 'Years ' + runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')
}

// ── Recurrence ──────────────────────────────────────────────────────────────

export const REPEAT_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
]

const isoOf = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
// Parse as LOCAL midnight. `new Date('2026-08-20')` is parsed as UTC, which in
// Sydney lands on the previous day and shifts every generated date by one.
const localDate = (iso) => new Date(`${iso}T00:00:00`)

/*
 * The term a date falls inside, from the terms table. Returns null when the
 * date sits outside every term (school holidays), in which case a recurring
 * session has no term end to stop at and the caller should say so.
 */
export function termContaining(terms, iso) {
  if (!iso) return null
  return (terms || []).find(
    (t) => t.start_date && t.end_date && iso >= t.start_date && iso <= t.end_date,
  ) || null
}

/*
 * Every date in the series: starts on `startIso`, repeats on that weekday, and
 * stops on `endIso` inclusive. A 'none' repeat is just the single date, so
 * callers can treat one-offs and series through the same path.
 */
export function seriesDates(startIso, repeat, endIso) {
  if (!startIso) return []
  if (repeat !== 'weekly' && repeat !== 'fortnightly') return [startIso]
  if (!endIso || endIso < startIso) return [startIso]
  const step = repeat === 'fortnightly' ? 14 : 7
  const out = []
  const d = localDate(startIso)
  const end = localDate(endIso)
  // Guard against a runaway loop if a caller ever passes a silly range.
  while (d <= end && out.length < 60) {
    out.push(isoOf(d))
    d.setDate(d.getDate() + step)
  }
  return out
}

/*
 * Build the rows for a series. Every occurrence carries the same details and
 * its own date; they share a series_id so they can later be edited or
 * cancelled together. A one-off gets series_id null rather than a series of
 * one, so "this and all later ones" never appears where it means nothing.
 */
export function buildSeriesRows(base, dates, seriesId) {
  const many = dates.length > 1
  return dates.map((session_date) => ({
    ...base,
    session_date,
    series_id: many ? seriesId : null,
  }))
}

// ── Who is on ───────────────────────────────────────────────────────────────

/*
 * Is this staff member rostered on this drop-in?
 *
 * `tutors` is free text typed by the director, so match the same two ways the
 * database does (`resolve_tutor_by_first_name`): the whole name, or the first
 * name on its own. Getting this wrong client-side would offer a Save button
 * that the RPC then refuses.
 */
export function isRosteredTutor(session, fullName) {
  const me = String(fullName || '').trim().toLowerCase()
  if (!me) return false
  const myFirst = me.split(' ')[0]
  return (session?.tutors || []).some((t) => {
    const n = String(t || '').trim().toLowerCase()
    if (!n) return false
    // A bare first name on the roster matches this person's first name; a full
    // name has to match in full, so two tutors called Sally don't both claim it.
    return n === me || (!n.includes(' ') && n === myFirst)
  })
}

/*
 * Universal calendar week labelling. The weekly/full calendar is driven purely
 * by dates, so any week can be named by resolving it against ALL terms:
 *   - inside a term            → "W{n}"  (n = week number within that term)
 *   - in the gap after a term  → "Term {N} Holidays · Wk {x}"
 *   - before the first term     → null (caller shows a plain date range)
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function isoDate(d) {
  const x = new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const dd = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Monday of the week containing d.
export function mondayOf(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = (x.getDay() + 6) % 7 // 0 = Monday
  x.setDate(x.getDate() - day)
  return x
}

// Whole weeks between two Mondays. Compared as calendar days via Date.UTC, not
// as elapsed milliseconds: a week containing a daylight-saving change is 167 or
// 169 hours long, so dividing the raw difference by WEEK_MS dropped (or added)
// a week for the rest of the term. In Sydney that hits early October and early
// April, both of which fall inside term time.
function weeksBetweenMondays(fromMon, toMon) {
  const utc = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((utc(toMon) - utc(fromMon)) / WEEK_MS)
}

// The breaks between terms are themselves term rows (see lib/terms.js), so a
// holiday week now overlaps a term and must not be numbered as a teaching week
// — otherwise the calendar reads W10, W1, W2 straight across a holiday.
const isHoliday = (t) => Number(t?.term_number) > 10

// Trim the trailing year: "Term 3–4 Holidays 2026" → "Term 3–4 Holidays".
const holidayName = (t) =>
  (t?.name || `Term ${t?.term_number} Holidays`).replace(/\s+\d{4}$/, '')

// Resolve a week (given its Monday) to a label using the full term list.
// Returns { kind: 'term'|'holiday', label, term } or null.
export function weekLabelFor(weekStart, terms) {
  if (!weekStart || !terms || !terms.length) return null
  const mon = mondayOf(weekStart)
  const wkISO = isoDate(mon)
  const weekEndISO = isoDate(addDays(mon, 6))
  const overlaps = (t) => t.start_date && t.end_date && t.start_date <= weekEndISO && t.end_date >= wkISO

  // A week counts as a teaching week if it overlaps a teaching term at all, so
  // the week a term starts in reads W1 even when the break owns its first days.
  const inTerm = terms.filter(t => !isHoliday(t)).find(overlaps)
  if (inTerm) {
    const termMon = mondayOf(new Date(`${inTerm.start_date}T00:00:00`))
    return { kind: 'term', label: `W${weeksBetweenMondays(termMon, mon) + 1}`, term: inTerm }
  }

  // Wholly inside a break. Prefer the holiday term covering it — it knows which
  // two terms it sits between — and fall back to the last finished term for any
  // gap that has no holiday term row yet (e.g. the summer break).
  const inHoliday = terms.filter(isHoliday).find(overlaps)
  if (inHoliday) {
    const holMon = mondayOf(new Date(`${inHoliday.start_date}T00:00:00`))
    const x = weeksBetweenMondays(holMon, mon) + 1
    return { kind: 'holiday', label: `${holidayName(inHoliday)} · Wk ${Math.max(1, x)}`, term: inHoliday }
  }

  const prior = terms
    .filter(t => t.end_date && t.end_date < wkISO && !isHoliday(t))
    .sort((a, b) => b.end_date.localeCompare(a.end_date))[0]
  if (prior) {
    const priorMon = mondayOf(new Date(`${prior.end_date}T00:00:00`))
    const x = weeksBetweenMondays(priorMon, mon)
    return { kind: 'holiday', label: `Term ${prior.term_number} Holidays · Wk ${Math.max(1, x)}`, term: prior }
  }
  return null
}

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

// Resolve a week (given its Monday) to a label using the full term list.
// Returns { kind: 'term'|'holiday', label, term } or null.
export function weekLabelFor(weekStart, terms) {
  if (!weekStart || !terms || !terms.length) return null
  const mon = mondayOf(weekStart)
  const wkISO = isoDate(mon)
  const weekEndISO = isoDate(addDays(mon, 6))

  // The week belongs to a term if its 7-day window overlaps the term range.
  const inTerm = terms.find(t => t.start_date && t.end_date && t.start_date <= weekEndISO && t.end_date >= wkISO)
  if (inTerm) {
    const termMon = mondayOf(new Date(`${inTerm.start_date}T00:00:00`))
    const n = Math.floor((mon.getTime() - termMon.getTime()) / WEEK_MS) + 1
    return { kind: 'term', label: `W${n}`, term: inTerm }
  }

  // Otherwise it's a holiday week — name it after the most recent finished term.
  const prior = terms
    .filter(t => t.end_date && t.end_date < wkISO)
    .sort((a, b) => b.end_date.localeCompare(a.end_date))[0]
  if (prior) {
    const priorMon = mondayOf(new Date(`${prior.end_date}T00:00:00`))
    const x = Math.floor((mon.getTime() - priorMon.getTime()) / WEEK_MS)
    return { kind: 'holiday', label: `Term ${prior.term_number} Holidays · Wk ${Math.max(1, x)}`, term: prior }
  }
  return null
}

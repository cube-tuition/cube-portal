/*
 * CUBE terms start on a Monday.
 * ─────────────────────────────────────────────────────────────────────────────
 * The terms table follows the NSW school calendar, so a term can be stored as
 * starting on a Tuesday (e.g. after the Labour Day long weekend). Our lessons
 * run Monday–Sunday weeks, so for us that term starts on the Monday of that
 * week. Every term read in the portal goes through normaliseTerm(s) so week
 * numbers, lesson dates, invoices and messages all agree on the Monday.
 *
 * Pure date maths — no imports — so API routes can use it too.
 */

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The Monday on or before an ISO date ("2026-10-13" → "2026-10-12"). */
export function mondayOf(isoDate) {
  if (!isoDate) return isoDate
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return iso(d)
}

/** A term with its start_date moved back to the Monday of its first week. */
export function normaliseTerm(term) {
  if (!term?.start_date) return term
  const start = mondayOf(term.start_date)
  return start === term.start_date ? term : { ...term, start_date: start }
}

/** Normalise a list of terms. An earlier term that would now overlap a term's
 *  Monday start (e.g. the holidays ending on that Monday) ends the day before. */
export function normaliseTerms(terms) {
  if (!Array.isArray(terms)) return terms
  const out = terms.map(normaliseTerm)
  for (const t of out) {
    if (!t?.start_date || !t.end_date) continue
    for (let i = 0; i < out.length; i++) {
      const o = out[i]
      if (o === t || !o?.start_date || !o.end_date) continue
      if (o.start_date < t.start_date && o.end_date >= t.start_date) {
        const d = new Date(`${t.start_date}T00:00:00`); d.setDate(d.getDate() - 1)
        out[i] = { ...o, end_date: iso(d) }
      }
    }
  }
  return out
}

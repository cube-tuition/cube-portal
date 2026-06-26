// ─── Time ─────────────────────────────────────────────────────────────────────

/**
 * Format a 24h "HH:MM(:SS)" time string to 12h: "4:30pm".
 */
export function fmtTime(t) {
  if (!t) return ''
  const [hRaw, mRaw] = String(t).split(':')
  const h = parseInt(hRaw, 10)
  if (Number.isNaN(h)) return String(t)
  const m = (mRaw || '00').padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hr}:${m}${ampm}`
}

/**
 * Format a start/end 24h time pair into a compact range: "4–5:30pm" or "11am–1pm".
 * Handles PM crossover (end < start) automatically.
 */
export function fmtTimeRange(start, end) {
  const parse = (t) => {
    if (!t) return null
    const [hRaw, mRaw] = String(t).split(':')
    const h = parseInt(hRaw, 10)
    const m = parseInt(mRaw || '0', 10) || 0
    if (Number.isNaN(h)) return null
    return { h, m }
  }
  const s = parse(start)
  let e = parse(end)
  if (!s || !e) return [fmtTime(start), fmtTime(end)].filter(Boolean).join('–')
  if (e.h < s.h || (e.h === s.h && e.m < s.m)) e = { ...e, h: e.h + 12 } // PM crossover
  const piece = ({ h, m }, withAmPm) => {
    const ampm = h >= 12 && h !== 24 ? 'pm' : 'am'
    const hr = h === 0 ? 12 : h > 12 ? h - 12 : h
    const mm = m === 0 ? '' : `:${String(m).padStart(2, '0')}`
    return `${hr}${mm}${withAmPm ? ampm : ''}`
  }
  const sameAmPm = (s.h >= 12) === (e.h >= 12)
  return `${piece(s, !sameAmPm)}–${piece(e, true)}`
}

// ─── Date ─────────────────────────────────────────────────────────────────────

/**
 * Format a Date object to ISO "YYYY-MM-DD" using local time (no timezone shift).
 */
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Format an ISO date string to "3 Jan 2025" (en-AU short month).
 */
export const fmtDate = iso =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

/**
 * Format an ISO date string to "3 January 2025" (en-AU long month).
 */
export const fmtDateLong = iso =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

// ─── Money ────────────────────────────────────────────────────────────────────

/**
 * Format a number as "$12.50".
 */
export const fmtMoney = n => `$${(Number(n) || 0).toFixed(2)}`

// ─── Subject labelling ─────────────────────────────────────────────────────────

/** True for the Chemistry subject (which counts in "Lessons", not "Weeks"). */
export const isChemistry = (subject) => /chem/i.test(String(subject || ''))

/** The word for a weekly slot: "Lesson" for Chemistry, otherwise "Week". */
export const weekWord = (subject) => (isChemistry(subject) ? 'Lesson' : 'Week')

/** "Week 2" / "Lesson 2" depending on subject. */
export const weekLabel = (subject, n) => `${weekWord(subject)} ${n}`

/**
 * Display a Chemistry compact workbook code with L instead of W:
 *   "M3W2" → "M3L2".  Non-Chemistry (or non-matching) values pass through.
 */
export const fmtWorkbookCode = (name, subject) =>
  isChemistry(subject) ? String(name ?? '').replace(/^(M\d+)W(\d+)$/i, '$1L$2') : (name ?? '')

// ─── Days ─────────────────────────────────────────────────────────────────────

/**
 * Normalize a day-of-week value coming from the DB.
 *
 * Accepts:
 *   - "Monday"           → "Monday"
 *   - "[\"Monday\"]"     → "Monday"   (string that looks like a JSON array)
 *   - ["Monday"]         → "Monday"   (real JS array, e.g. from text[]/jsonb)
 *   - ["Monday","Wed"]   → "Monday"   (first item)
 *   - null / undefined   → ""
 */
export function normalizeDay(value) {
  const days = normalizeDays(value)
  return days[0] || ''
}

/**
 * Same as normalizeDay but returns EVERY day a class runs on.
 *
 * A class with `day_of_week = "[\"Tuesday\",\"Thursday\"]"` runs twice a week,
 * and the tutor classes view needs to render it on both days. normalizeDay()
 * silently drops the second day, so use normalizeDays() any time you care
 * about full coverage.
 *
 * Returns an array of trimmed day strings, e.g. ["Tuesday", "Thursday"].
 * Always returns an array — empty if there's nothing to parse.
 */
export function normalizeDays(value) {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean)
  }
  if (typeof value !== 'string') {
    const s = String(value).trim()
    return s ? [s] : []
  }

  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v).trim()).filter(Boolean)
      }
    } catch {
      // Not valid JSON — strip brackets/quotes manually
    }
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(s => s.replace(/['"]/g, '').trim())
      .filter(Boolean)
  }
  return [trimmed]
}

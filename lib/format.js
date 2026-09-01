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
export const fmtDate = iso => {
  if (!iso) return '—'
  // Date-only strings ("2025-01-03") get parsed at local midnight to avoid a
  // timezone shift; full timestamps are parsed as-is.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00' : iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Format an ISO date string to "3 January 2025" (en-AU long month).
 */
export const fmtDateLong = iso => {
  if (!iso) return '—'
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00' : iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

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
 * Chemistry workbook codes are stored as "M3L2" — Chemistry counts in lessons,
 * not weeks. Legacy "M3W2" names still display as "M3L2"; anything else (and
 * every other subject) passes through untouched.
 */
export const fmtWorkbookCode = (name, subject) =>
  isChemistry(subject) ? String(name ?? '').replace(/^(M\d+)W(\d+)$/i, '$1L$2') : (name ?? '')

/*
 * Chemistry files its workbooks by MODULE, not by topic. The module is already
 * in the name — "M3L2" is module 3, lesson 2 — so it is derived on read rather
 * than typed into `booklets.topic`, and can never drift out of step with the
 * booklet it labels. Every other subject keeps its topic bank.
 */

/** Module number off a Chemistry booklet name — "M3L2" → 3; null if unnamed. */
export const chemModuleNumber = (name) => {
  const m = /^\s*M\s*(\d+)\s*[LW]/i.exec(String(name ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * Lesson number — "M3L2" → 2. Orders lessons within a module, so M3L10 lands
 * after M3L9 rather than beside M3L1 as a plain name sort would have it.
 */
export const chemLessonNumber = (name) => {
  const m = /^\s*M\s*\d+\s*[LW]\s*(\d+)/i.exec(String(name ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * Heading for a module group. `names` maps module number → the syllabus module
 * name ("Module 3: Reactive Chemistry"); without one, the number still stands.
 */
export const chemModuleLabel = (moduleNo, names) =>
  moduleNo == null ? '' : (names?.[moduleNo] || `Module ${moduleNo}`)

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

/*
 * Booklet display code: "9.M. Linear Relationships 3".
 *
 * The prefix is DERIVED from the booklet's year and subject, not stored — the
 * database holds only "Linear Relationships 3". Screens have shown names this
 * way all along, so anything that copies a booklet's name into another record
 * (a builder draft, say) must use this, or the code silently disappears the
 * moment the copy is made.
 *
 * NOT the same map as lib/bookletNaming, which names the PDF FILES and appends
 * a role letter — "5.MS. Algebra 1" is Maths/Student there, so Standard Maths
 * must stay 'M' to avoid the clash. Here 'MS' means Standard Maths. Keep the
 * two separate.
 */
export const SUBJECT_CODE = {
  'Maths': 'M', 'English': 'E', 'Chemistry': 'C', 'Science': 'S', 'Physics': 'P',
  'Standard Maths': 'MS', 'Adv Maths': 'MA',
  'Ext 1 Maths': 'M1', 'Ext 2 Maths': 'M2',
}

/** Subject → its short code, falling back to the first letter. */
export const subjectCode = (s) => SUBJECT_CODE[s] || (s || '')[0]?.toUpperCase() || ''

/**
 * "9.M. Linear Relationships 3" — falls back to the bare name without a year.
 * Chemistry names stored as "M3W2" display as "M3L2" (Chemistry counts lessons).
 */
export const bookletLabel = (b) => {
  const name = fmtWorkbookCode(b?.booklet_name, b?.subject)
  if (!b?.year) return name
  return `${b.year}.${subjectCode(b.subject)}. ${name}`
}

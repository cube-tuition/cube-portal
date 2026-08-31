import { supabase } from './supabase'
import { T_TERMS } from '../lib/tables'

/*
 * Term model
 * ─────────────────────────────────────────────────────────────────────────────
 * CUBE runs ~10-week terms aligned to NSW public school terms where possible.
 *
 * SQL — create this once in Supabase:
 *
 *   create table terms (
 *     id          uuid primary key default gen_random_uuid(),
 *     name        text not null,         -- "Term 2 2026"
 *     year        int  not null,
 *     term_number int  not null,         -- 1..4 (5 = holiday workshops if you use it)
 *     start_date  date not null,
 *     end_date    date not null,
 *     created_at  timestamptz default now()
 *   );
 *   create unique index terms_year_number_idx on terms (year, term_number);
 *
 * NSW-aligned seed rows you can tweak any time (the portal re-reads on each load):
 *
 *   insert into terms (name, year, term_number, start_date, end_date) values
 *     ('Term 1 2025', 2025, 1, '2025-02-04', '2025-04-11'),
 *     ('Term 2 2025', 2025, 2, '2025-04-29', '2025-07-04'),
 *     ('Term 3 2025', 2025, 3, '2025-07-21', '2025-09-26'),
 *     ('Term 4 2025', 2025, 4, '2025-10-13', '2025-12-19'),
 *     ('Term 1 2026', 2026, 1, '2026-01-27', '2026-04-03'),
 *     ('Term 2 2026', 2026, 2, '2026-04-20', '2026-06-26'),
 *     ('Term 3 2026', 2026, 3, '2026-07-13', '2026-09-18'),
 *     ('Term 4 2026', 2026, 4, '2026-10-05', '2026-12-11');
 *
 * The portal:
 *  - Picks the "current term" by date automatically (no manual flip).
 *  - During school holidays it falls back to the most recently-completed term,
 *    so the dashboard never goes empty between terms.
 *  - All archived terms remain accessible from /archive.
 */

// ── Terms cache ──────────────────────────────────────────────────────────────
// fetchAllTerms() is called on almost every page, sometimes more than once per
// screen (e.g. the director home calls it, and so does the Action Centre). Terms
// only change a few times a year, so a tiny in-memory cache collapses those into
// a single query while staying fresh:
//   • the resolved list is reused for TERMS_TTL_MS, then re-fetched, and
//   • concurrent callers share one in-flight request (no duplicate round trips).
// Every call still returns a fresh array of the same shape as before, so callers
// can't mutate the cache and behaviour is unchanged.
const TERMS_TTL_MS = 60_000
let _termsCache = null     // { data, at } | null
let _termsInFlight = null  // Promise<term[]> | null

/**
 * Clear the cached terms. Call this after creating, editing or deleting a term
 * so the next read re-fetches immediately. (The cache also self-heals after
 * TERMS_TTL_MS regardless.)
 */
export function invalidateTermsCache() {
  _termsCache = null
  _termsInFlight = null
}

/** Fetch every term, newest first. Cached briefly; pass { force: true } to bypass. */
export async function fetchAllTerms({ force = false } = {}) {
  if (!force && _termsCache && Date.now() - _termsCache.at < TERMS_TTL_MS) {
    return _termsCache.data.slice()
  }
  if (!force && _termsInFlight) {
    return (await _termsInFlight).slice()
  }
  _termsInFlight = (async () => {
    const { data, error } = await supabase
      .from(T_TERMS)
      .select('*')
      .order('start_date', { ascending: false })
    const result = error ? [] : (data || [])
    if (!error) _termsCache = { data: result, at: Date.now() }  // don't cache errors
    return result
  })()
  try {
    return (await _termsInFlight).slice()
  } finally {
    _termsInFlight = null
  }
}

/** 1-based teaching week of `now` within a term (week 1 begins on start_date).
 *  Returns null when `now` falls outside the term's dates (holidays). */
export function weekOfTerm(term, now = new Date()) {
  if (!term?.start_date || !term?.end_date) return null
  const today = toISODate(now)
  if (today < term.start_date || today > term.end_date) return null
  const days = Math.floor((new Date(today) - new Date(term.start_date)) / 86400000)
  return Math.floor(days / 7) + 1
}

const DAY_INDEX = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }

/** Date (local midnight) of a class's lesson in a teaching week: the first
 *  occurrence of its weekday on/after the term's start, plus (week−1) weeks. */
export function lessonDateForWeek(term, dayOfWeek, week) {
  if (!term?.start_date || !dayOfWeek || !week) return null
  const target = DAY_INDEX[String(dayOfWeek).trim().toLowerCase()]
  if (target == null) return null
  const d0 = new Date(term.start_date + 'T00:00:00')
  const dt = new Date(d0)
  dt.setDate(d0.getDate() + ((target - d0.getDay() + 7) % 7) + (week - 1) * 7)
  return dt
}

/** When a week's SOLUTIONS booklet unlocks for students: one week after that
 *  week's lesson, at lesson end time — i.e. once the NEXT lesson has finished,
 *  so the homework due in between can't be copied from the answers. */
export function solutionsUnlockAt(term, dayOfWeek, endTime, week) {
  const lesson = lessonDateForWeek(term, dayOfWeek, week)
  if (!lesson) return null
  const unlock = new Date(lesson)
  unlock.setDate(unlock.getDate() + 7)
  const m = String(endTime || '').match(/^(\d{1,2}):(\d{2})/)
  if (m) unlock.setHours(+m[1], +m[2], 0, 0)
  else unlock.setHours(23, 59, 0, 0)   // no end time recorded — unlock end of day
  return unlock
}

/** Pick the current term given a list and "now". */
export function getCurrentTerm(terms, now = new Date()) {
  if (!terms || terms.length === 0) return null
  const today = toISODate(now)

  // 1. Today falls inside a term
  const inside = terms.find(t => today >= t.start_date && today <= t.end_date)
  if (inside) return inside

  // 2. Holidays — fall back to the most recently-completed term
  const past = terms
    .filter(t => t.end_date < today)
    .sort((a, b) => b.end_date.localeCompare(a.end_date))
  if (past[0]) return past[0]

  // 3. New install before any term has started — use the next upcoming one
  const upcoming = terms
    .filter(t => t.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  return upcoming[0] || null
}

/**
 * The term a NEW student would join: today's term if we're inside one,
 * otherwise the next upcoming term (during holidays new trials/enrolments
 * belong to next term, unlike getCurrentTerm which looks back so dashboards
 * don't go empty). Falls back to the most recently-completed term.
 */
export function getEnrolmentTerm(terms, now = new Date()) {
  if (!terms || terms.length === 0) return null
  const today = toISODate(now)

  const inside = terms.find(t => today >= t.start_date && today <= t.end_date)
  if (inside) return inside

  const upcoming = terms
    .filter(t => t.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  if (upcoming[0]) return upcoming[0]

  const past = terms
    .filter(t => t.end_date < today)
    .sort((a, b) => b.end_date.localeCompare(a.end_date))
  return past[0] || null
}

// ── Holiday terms ────────────────────────────────────────────────────────────
// The break between two teaching terms is itself a term row, so holiday courses
// can be created and enrolled against it like any other. They are numbered
// 10 + the term they follow (Term 2–3 Holidays → 12), which keeps them unique
// under the (year, term_number) index and clear of the 1–4 teaching terms.
//
// A holiday course does NOT run on a fixed weekday: its lessons sit on dates
// chosen by hand at creation, stored as lesson rows with week = 1..N in date
// order (session 1, session 2, …). So a holiday class has no day_of_week, and
// the weekly lesson generator skips it — see add_lessons_for_class.
export const HOLIDAY_TERM_OFFSET = 10

/** True when this term is a between-terms holiday period rather than a teaching term. */
export function isHolidayTerm(term) {
  const n = Number(term?.term_number)
  return Number.isFinite(n) && n > HOLIDAY_TERM_OFFSET
}

/** Every date inside a term, as ISO strings — the pickable days of a holiday course. */
export function datesInTerm(term) {
  if (!term?.start_date || !term?.end_date) return []
  const out = []
  const end = parseISODate(term.end_date)
  for (let d = parseISODate(term.start_date); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(toISODate(d))
  }
  return out
}

/** Past terms (end_date strictly before today), newest first. */
export function getPastTerms(terms, currentTermId, now = new Date()) {
  const today = toISODate(now)
  return (terms || [])
    .filter(t => t.id !== currentTermId && t.end_date < today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
}

/** Format a term for display, e.g. "Term 2 · 2026". */
export function formatTermLabel(term) {
  if (!term) return ''
  if (term.name) return term.name.replace(/\s+(\d{4})$/, ' · $1')
  return `Term ${term.term_number} · ${term.year}`
}

/** Short date range, e.g. "20 Apr – 26 Jun". */
export function formatTermRange(term) {
  if (!term) return ''
  const s = parseISODate(term.start_date)
  const e = parseISODate(term.end_date)
  const sameYear = s.getFullYear() === e.getFullYear()
  const fmt = (d, withYear) =>
    `${d.getDate()} ${MONTH[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`
  return sameYear ? `${fmt(s)} – ${fmt(e, true)}` : `${fmt(s, true)} – ${fmt(e, true)}`
}

// ── Curriculum terms per year level ─────────────────────────────────────────
// A year level's curriculum normally runs across all four terms. Year 11 is the
// exception: its course finishes in Term 3, because the HSC course starts in
// Term 4 — by which point the cohort is taught as Year 12. So a Year 11
// curriculum has three terms, and Term 4 must not be offered for it.
export const ALL_CURRICULUM_TERMS = [1, 2, 3, 4]
const Y11_CURRICULUM_TERMS = [1, 2, 3]

/** The curriculum terms for a year level. Year 11 → [1,2,3], everything else → [1,2,3,4]. */
export function curriculumTerms(year) {
  return Number(year) === 11 ? Y11_CURRICULUM_TERMS : ALL_CURRICULUM_TERMS
}

/** True when `term` is not a curriculum term for `year` (i.e. Year 11 + Term 4). */
export function isTermOutOfCurriculum(year, term) {
  return term != null && !curriculumTerms(year).includes(Number(term))
}

/** Filter rows whose date column falls inside [term.start_date, term.end_date]. */
export function filterByTerm(rows, dateKey, term) {
  if (!term) return rows
  return (rows || []).filter(r => {
    const v = readDate(r, dateKey)
    if (!v) return false
    return v >= term.start_date && v <= term.end_date
  })
}

// ── Internal helpers ───────────────────────────────────────────────────────
const MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function toISODate(d) {
  if (typeof d === 'string') return d.slice(0, 10)
  // Local calendar date, NOT toISOString(): that converts to UTC, so in Sydney
  // (UTC+10/+11) every moment before 10am resolves to the previous day. Term
  // dates are plain dates, and the comparison must be against the local day.
  // With gaps between terms a day's drift was invisible; now that holiday terms
  // make the calendar contiguous, it would show the wrong term (and the wrong
  // week, via weekOfTerm) every morning at a boundary.
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function parseISODate(s) {
  return new Date(`${s}T00:00:00`)
}
function readDate(row, key) {
  // Supports dotted keys like "exams.exam_date"
  const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), row)
  if (!v) return null
  return toISODate(v)
}

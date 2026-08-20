/*
 * Portal analytics — the maths under /tutor/admin/monitoring.
 *
 * Everything here is a pure function over rows the page has already fetched,
 * so the whole layer can be exercised headlessly (node) against real data.
 * Dates are Sydney-day ISO strings throughout, matching what the tracking
 * tables store.
 *
 * Honesty rules, because directors will act on these numbers:
 *  - Sessions and durations come from the portal_events stream, which only
 *    accrues from the day it shipped. Until a window is fully covered by
 *    events, session KPIs are flagged `estimated` and fall back to active
 *    days (one session ≈ one active day).
 *  - Homework and quiz figures are the tutor-recorded ones (homework grades,
 *    RQ marks) — CUBE homework is physical, so "did the portal see them open
 *    it" would be the wrong question. The engagement score says what it
 *    measures.
 */

const DAY_MS = 86400000
export const SESSION_GAP_MIN = 30

// ── Sydney-day helpers ───────────────────────────────────────────────────────
export const sydneyToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
export const sydneyDayOf = (ts) =>
  new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
export const addDays = (iso, n) => {
  // Anchor at noon and format from local getters — toISOString() is UTC and
  // would roll a Sydney date back a day. Noon also rides out DST switches.
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const daysBetween = (a, b) =>
  Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY_MS)
export const eachDay = (from, to) => {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}
// Monday of the week containing `iso` (Sydney weeks run Mon–Sun).
export const mondayOf = (iso) => {
  const d = new Date(iso + 'T00:00:00')
  return addDays(iso, -((d.getDay() + 6) % 7))
}

// ── Feature map: student routes → the feature a director thinks in ──────────
export const FEATURES = [
  { key: 'home',      label: 'Home',            paths: ['/dashboard'] },
  { key: 'classes',   label: 'Classes',         paths: ['/classes', '/classes/:id'] },
  { key: 'workbooks', label: 'Online workbooks', paths: ['/workbook/:id', '/workbook/view/:id'] },
  { key: 'pastpapers', label: 'Past papers',     paths: ['/pastpapers'] },
  { key: 'resources', label: 'Resources',       paths: ['/resources'] },
  { key: 'dropin',    label: 'Drop-in help',    paths: ['/dropin'] },
  { key: 'results',   label: 'Results',         paths: ['/results'] },
  { key: 'timetable', label: 'Timetable',       paths: ['/timetable'] },
  { key: 'study',     label: 'Study',           paths: ['/study'] },
  { key: 'archive',   label: 'Past terms',      paths: ['/archive', '/archive/:id'] },
]
const FEATURE_BY_PATH = new Map(FEATURES.flatMap(f => f.paths.map(p => [p, f])))
export const featureOf = (path) => FEATURE_BY_PATH.get(path) || null

// ── Sessions: gap-based, from timestamped events ────────────────────────────
// Events sorted per user; a gap over SESSION_GAP_MIN starts a new session.
// A one-event session still took real time — floor at one minute.
export function sessionise(events) {
  const byUser = new Map()
  for (const e of events) {
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, [])
    byUser.get(e.user_id).push(+new Date(e.ts))
  }
  const sessions = []
  for (const [user_id, stamps] of byUser) {
    stamps.sort((a, b) => a - b)
    let start = stamps[0], last = stamps[0], views = 1
    for (let i = 1; i < stamps.length; i++) {
      if (stamps[i] - last > SESSION_GAP_MIN * 60000) {
        sessions.push({ user_id, start, end: last, ms: Math.max(60000, last - start), views })
        start = stamps[i]; views = 0
      }
      last = stamps[i]; views++
    }
    sessions.push({ user_id, start, end: last, ms: Math.max(60000, last - start), views })
  }
  return sessions
}

export function fmtDuration(ms) {
  if (ms == null) return '—'
  const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(s).padStart(2, '0')}s`
}

// ── Engagement score (0–100): PORTAL engagement, not ability ────────────────
// login 25 · homework 30 · quiz 25 · resources 10 · consistency 10.
export const SCORE_PARTS = [
  { key: 'login',       label: 'Login frequency',    weight: 25 },
  { key: 'homework',    label: 'Homework (tutor-recorded)', weight: 30 },
  { key: 'quiz',        label: 'Revision quizzes',   weight: 25 },
  { key: 'resources',   label: 'Resource usage',     weight: 10 },
  { key: 'consistency', label: 'Consistency',        weight: 10 },
]
const HW_VALUE = { A: 1, B: 0.8, C: 0.55, D: 0.3, E: 0.1 }

/*
 * inputs (all over the selected window):
 *   activeDays      distinct days with any portal activity
 *   windowDays      length of the window
 *   hwGrades        tutor homework grades, e.g. ['A','B',null] one per marked week
 *   rqWeeks         number of weeks with an RQ mark recorded
 *   rqPossible      number of weeks an RQ was on offer
 *   resourceDays    distinct days with a resources/pastpapers/study/dropin view
 *   activeWeeks     distinct Mon-weeks with any activity
 *   windowWeeks     weeks spanned by the window
 */
export function engagementScore(i) {
  const weeks = Math.max(1, i.windowWeeks)
  const parts = {
    // ~3 active days a week is full marks — daily use isn't expected of a
    // once-a-week tuition student.
    login: Math.min(1, i.activeDays / (weeks * 3)),
    homework: i.hwGrades.length
      ? i.hwGrades.reduce((a, g) => a + (HW_VALUE[g] ?? 0), 0) / i.hwGrades.length
      : 0,
    quiz: i.rqPossible ? Math.min(1, i.rqWeeks / i.rqPossible) : 0,
    resources: Math.min(1, i.resourceDays / weeks),
    consistency: Math.min(1, i.activeWeeks / weeks),
  }
  const total = Math.round(SCORE_PARTS.reduce((a, p) => a + parts[p.key] * p.weight, 0))
  return { total, parts }
}

export function statusOf(score, daysSinceActive) {
  if (daysSinceActive == null || daysSinceActive >= 14)
    return { key: 'inactive', label: 'Inactive', color: '#B23A3A', bg: '#FDECEC' }
  if (score >= 80) return { key: 'high',     label: 'Highly engaged', color: '#047857', bg: '#DCFCE7' }
  if (score >= 60) return { key: 'engaged',  label: 'Engaged',        color: '#0E7490', bg: '#E0F2FE' }
  if (score >= 40) return { key: 'moderate', label: 'Moderate',       color: '#325099', bg: '#E8EDFB' }
  return { key: 'low', label: 'Low engagement', color: '#B45309', bg: '#FEF3C7' }
}

export const partLevel = (v) =>
  v >= 0.7 ? { label: 'High', color: '#047857' }
  : v >= 0.4 ? { label: 'Moderate', color: '#B45309' }
  : { label: 'Low', color: '#B23A3A' }

// ── Heatmap: Sydney day-of-week × daypart, from events ──────────────────────
export const DAYPARTS = [
  { key: 'morning',   label: 'Morning',   from: 5,  to: 12 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { key: 'evening',   label: 'Evening',   from: 17, to: 24 },
]
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function heatmapOf(events) {
  const grid = WEEKDAYS.map(() => DAYPARTS.map(() => 0))
  for (const e of events) {
    const d = new Date(e.ts)
    const syd = new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }))
    const day = (syd.getDay() + 6) % 7
    const h = syd.getHours()
    const part = DAYPARTS.findIndex(p => h >= p.from && h < p.to)
    if (part >= 0) grid[day][part]++
    else grid[day][h < 5 ? 2 : 0]++    // small hours fold into evening
  }
  return grid
}

// ── Journeys: where students go right after the dashboard ───────────────────
export function journeysFrom(events, fromPath = '/dashboard', withinMin = 10) {
  const byUser = new Map()
  for (const e of events) {
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, [])
    byUser.get(e.user_id).push(e)
  }
  const next = new Map()
  let total = 0
  for (const list of byUser.values()) {
    list.sort((a, b) => new Date(a.ts) - new Date(b.ts))
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].path !== fromPath) continue
      const nxt = list[i + 1]
      if (nxt.path === fromPath) continue
      if (new Date(nxt.ts) - new Date(list[i].ts) > withinMin * 60000) continue
      const f = featureOf(nxt.path)
      const label = f ? f.label : nxt.path
      next.set(label, (next.get(label) || 0) + 1)
      total++
    }
  }
  return {
    total,
    steps: [...next].map(([label, n]) => ({ label, n, pct: Math.round((n / total) * 100) }))
      .sort((a, b) => b.n - a.n),
  }
}

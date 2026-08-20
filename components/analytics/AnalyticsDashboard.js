'use client'
import { useMemo, useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { inferSubject } from '../CourseDetail'
import {
  FEATURES, featureOf, sessionise, fmtDuration, engagementScore, statusOf,
  partLevel, SCORE_PARTS, heatmapOf, journeysFrom, DAYPARTS, WEEKDAYS,
  addDays, daysBetween, eachDay, mondayOf, sydneyDayOf,
} from '../../lib/portalAnalytics'

/*
 * Portal Analytics — the dashboard body. Pure client compute over rows the
 * page fetched, so a harness can render it with baked data.
 *
 * Reading order is the director's: KPIs → trend → what's used → who needs
 * attention → classes → students → one student. Every number is real; the
 * session/heatmap/feed sections read the portal_events stream and say so
 * while it is still accruing.
 */

const INK = '#2A2035'
const NAVY = '#062E63'
const BLUE = '#325099'
const LINE = '#DEE7FF'
const FAINT = '#F4F7FF'

const EVENTS_LIVE_FROM = '2026-08-19'   // the day timestamped tracking shipped

const parseYear = (name) => {
  const m = String(name || '').match(/^y?\s*(\d{1,2})/i)
  return m ? parseInt(m[1], 10) : null
}
const firstName = (s) => String(s || '').split(' ')[0]

const relLabel = (days) => {
  if (days == null) return 'never'
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}
const relColor = (days) => {
  if (days == null) return '#B23A3A'
  if (days <= 2) return '#047857'
  if (days <= 7) return BLUE
  if (days <= 13) return '#B45309'
  return '#B23A3A'
}
const sydTime = (ts) =>
  new Date(ts).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', hour: 'numeric', minute: '2-digit' })

// ── Small building blocks ───────────────────────────────────────────────────
function Delta({ now, prev, suffix = '', invert = false }) {
  if (prev == null || !isFinite(prev)) return null
  const diff = now - prev
  const pct = prev !== 0 ? Math.round((diff / prev) * 100) : null
  if (diff === 0 || (pct !== null && Math.abs(pct) < 2))
    return <span className="text-[11px] text-[#2A2035]/40">→ steady</span>
  const up = diff > 0
  const good = invert ? !up : up
  return (
    <span className="text-[11px] font-semibold" style={{ color: good ? '#047857' : '#B45309' }}>
      {up ? '↑' : '↓'} {pct !== null ? `${Math.abs(pct)}%` : Math.abs(diff)}{suffix} vs prev period
    </span>
  )
}

function Kpi({ label, value, sub, delta, title }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] px-5 py-4" title={title}>
      <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">{label}</p>
      <p className="text-[26px] leading-8 font-bold mt-1 font-display tabular-nums" style={{ color: NAVY }}>{value}</p>
      <div className="mt-0.5 min-h-[16px]">
        {delta || (sub ? <span className="text-[11px] text-[#2A2035]/45">{sub}</span> : null)}
      </div>
    </div>
  )
}

function Bar({ pct, color = BLUE, h = 6 }) {
  return (
    <div className="rounded-full bg-[#EEF2FB] overflow-hidden" style={{ height: h }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  )
}

function Chip({ status }) {
  return (
    <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: status.bg, color: status.color }}>{status.label}</span>
  )
}

function SectionTitle({ title, sub, right }) {
  return (
    <div className="flex items-baseline gap-3 mb-3 flex-wrap">
      <h2 className="text-base font-bold font-display" style={{ color: NAVY }}>{title}</h2>
      {sub && <span className="text-[11px] text-[#2A2035]/45">{sub}</span>}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}

function AccruingNote() {
  return (
    <p className="text-xs text-[#2A2035]/45 px-4 py-6 text-center">
      Timestamped tracking went live on 19 Aug 2026 — this section fills in as students use the portal.
    </p>
  )
}

// ── The dashboard ───────────────────────────────────────────────────────────
export default function AnalyticsDashboard({ students, classes, enrolments, views, activity, events, quizzes, term, today }) {
  // ── Filters ──────────────────────────────────────────────────────────────
  const [range, setRange] = useState('week')       // week | 7d | 30d | term | custom
  const [customFrom, setCustomFrom] = useState(addDays(today, -13))
  const [customTo, setCustomTo] = useState(today)
  const [fYear, setFYear] = useState('all')
  const [fSubject, setFSubject] = useState('all')
  const [fClass, setFClass] = useState('all')
  const [fTeacher, setFTeacher] = useState('all')
  const [q, setQ] = useState('')
  const [fStatus, setFStatus] = useState('all')
  const [attention, setAttention] = useState(null) // inactive | never | quietWeek | declining
  const [drawerId, setDrawerId] = useState(null)
  const [featureOpen, setFeatureOpen] = useState(null)
  const [featureSort, setFeatureSort] = useState('most')
  const [trendMetric, setTrendMetric] = useState('active')  // active | views | sessions
  const [compare, setCompare] = useState(true)
  const [stuSort, setStuSort] = useState({ key: 'score', dir: -1 })
  const tableRef = useRef(null)

  const { from, to } = useMemo(() => {
    if (range === 'week') return { from: mondayOf(today), to: today }
    if (range === '7d') return { from: addDays(today, -6), to: today }
    if (range === '30d') return { from: addDays(today, -29), to: today }
    if (range === 'term' && term?.start_date) return { from: term.start_date, to: today }
    if (range === 'custom') return { from: customFrom <= customTo ? customFrom : customTo, to: customTo }
    return { from: addDays(today, -6), to: today }
  }, [range, today, term, customFrom, customTo])
  const windowDays = daysBetween(from, to) + 1
  const prevFrom = addDays(from, -windowDays)
  const prevTo = addDays(from, -1)
  // Engagement components need a few marked weeks to mean anything, so the
  // score always looks back at least 28 days even when the view is "this week".
  const scoreFrom = daysBetween(addDays(to, -27), from) > 0 ? addDays(to, -27) : from
  const scoreWeeks = Math.max(1, Math.round((daysBetween(scoreFrom, to) + 1) / 7))

  // ── Static shape: classes, rosters, subjects ─────────────────────────────
  const classById = useMemo(() => new Map(classes.map(c => [c.id, {
    ...c, subject: inferSubject(c), year: parseYear(c.class_name),
    teacher: firstName(c.teacher),
  }])), [classes])

  const byStudent = useMemo(() => {
    const m = new Map()
    for (const s of students) m.set(s.id, { classes: [], subjects: new Set(), teachers: new Set() })
    for (const e of enrolments) {
      const c = classById.get(e.class_id); const rec = m.get(e.student_id)
      if (!c || !rec) continue
      rec.classes.push(c); rec.subjects.add(c.subject); rec.teachers.add(c.teacher)
    }
    return m
  }, [students, enrolments, classById])

  // Students the filters leave in view (status/attention applied later).
  const inView = useMemo(() => students.filter(s => {
    const rec = byStudent.get(s.id)
    if (fYear !== 'all' && String(s.year) !== String(fYear)) return false
    if (fSubject !== 'all' && !rec.subjects.has(fSubject)) return false
    if (fClass !== 'all' && !rec.classes.some(c => String(c.id) === String(fClass))) return false
    if (fTeacher !== 'all' && !rec.teachers.has(fTeacher)) return false
    return true
  }), [students, byStudent, fYear, fSubject, fClass, fTeacher])
  const inViewIds = useMemo(() => new Set(inView.map(s => s.id)), [inView])

  // ── Activity: distinct Sydney days per student (views ∪ heartbeat) ───────
  const daysByUser = useMemo(() => {
    const m = new Map()
    const add = (uid, day) => {
      if (!m.has(uid)) m.set(uid, new Set())
      m.get(uid).add(day)
    }
    for (const v of views) add(v.user_id, v.day)
    for (const a of activity) add(a.user_id, a.day)
    return m
  }, [views, activity])

  const studentEvents = useMemo(
    () => events.filter(e => inViewIds.has(e.user_id) && sydneyDayOf(e.ts) >= from && sydneyDayOf(e.ts) <= to),
    [events, inViewIds, from, to])

  // Sessions are real once the event stream covers the whole window.
  const eventsCover = from >= EVENTS_LIVE_FROM
  const sessions = useMemo(() => sessionise(studentEvents), [studentEvents])

  // ── Per-student aggregates ───────────────────────────────────────────────
  const rows = useMemo(() => {
    const qByStudent = new Map()
    for (const r of quizzes) {
      if (!qByStudent.has(r.student_id)) qByStudent.set(r.student_id, [])
      qByStudent.get(r.student_id).push(r)
    }
    // Weeks a revision quiz was on offer, per class: any roster mark that week.
    const classRqWeeks = new Map()
    for (const [sid, list] of qByStudent) {
      const rec = byStudent.get(sid)
      if (!rec) continue
      for (const r of list) {
        if (r.score == null || !r.quiz_date || r.quiz_date < scoreFrom || r.quiz_date > to) continue
        for (const c of rec.classes) {
          if (c.subject && r.subject && c.subject !== r.subject) continue
          if (!classRqWeeks.has(c.id)) classRqWeeks.set(c.id, new Set())
          classRqWeeks.get(c.id).add(r.week)
        }
      }
    }
    const sessByUser = new Map()
    for (const s of sessions) {
      if (!sessByUser.has(s.user_id)) sessByUser.set(s.user_id, [])
      sessByUser.get(s.user_id).push(s)
    }

    return inView.map(s => {
      const rec = byStudent.get(s.id)
      const days = daysByUser.get(s.id) || new Set()
      const inWin = [...days].filter(d => d >= from && d <= to)
      const inScoreWin = [...days].filter(d => d >= scoreFrom && d <= to)
      const allDays = [...days]
      const lastDay = allDays.length ? allDays.sort().at(-1) : null
      const daysSince = lastDay ? daysBetween(lastDay, today) : null

      const myQ = (qByStudent.get(s.id) || []).filter(r => r.quiz_date >= scoreFrom && r.quiz_date <= to)
      const hwGrades = myQ.map(r => r.homework_grade).filter(Boolean)
      const rqWeeks = new Set(myQ.filter(r => r.score != null).map(r => r.week)).size
      const rqPossible = new Set(rec.classes.flatMap(c => [...(classRqWeeks.get(c.id) || [])])).size

      const resourceDays = new Set(
        views.filter(v => v.user_id === s.id && v.day >= scoreFrom && v.day <= to
          && ['resources', 'pastpapers', 'study', 'dropin'].includes(featureOf(v.path)?.key))
          .map(v => v.day)).size

      const { total: score, parts } = engagementScore({
        activeDays: inScoreWin.length, windowDays: daysBetween(scoreFrom, to) + 1,
        windowWeeks: scoreWeeks, hwGrades, rqWeeks, rqPossible, resourceDays,
        activeWeeks: new Set(inScoreWin.map(mondayOf)).size,
      })
      const status = statusOf(score, daysSince)
      const mySess = sessByUser.get(s.id) || []
      // Declining: second half of the window much quieter than the first.
      const mid = addDays(from, Math.floor(windowDays / 2))
      const firstHalf = inWin.filter(d => d < mid).length
      const secondHalf = inWin.filter(d => d >= mid).length
      return {
        s, rec, score, parts, status, lastDay, daysSince,
        activeDays: inWin.length, sessions: mySess.length,
        sessMs: mySess.reduce((a, x) => a + x.ms, 0),
        hwGrades, rqWeeks, rqPossible,
        declining: firstHalf >= 2 && secondHalf <= Math.floor(firstHalf / 2),
        neverSeen: lastDay == null,
        quietWeek: inWin.length === 0,
      }
    })
  }, [inView, byStudent, daysByUser, quizzes, sessions, views, from, to, scoreFrom, scoreWeeks, today, windowDays])

  // ── KPIs (with previous-window deltas) ───────────────────────────────────
  const kpis = useMemo(() => {
    const activeNow = rows.filter(r => r.activeDays > 0)
    const countActive = (f0, t0) => inView.filter(s => {
      const days = daysByUser.get(s.id)
      return days && [...days].some(d => d >= f0 && d <= t0)
    }).length
    const prevActive = countActive(prevFrom, prevTo)
    const viewsIn = (f0, t0) => views.filter(v => inViewIds.has(v.user_id) && v.day >= f0 && v.day <= t0)
      .reduce((a, v) => a + v.views, 0)
    const totalViews = viewsIn(from, to)
    const totalDays = rows.reduce((a, r) => a + r.activeDays, 0)
    const inactive14 = rows.filter(r => r.daysSince == null || r.daysSince >= 14).length
    const totalSessMs = sessions.reduce((a, x) => a + x.ms, 0)
    return {
      active: activeNow.length, enrolled: inView.length,
      rate: inView.length ? Math.round((activeNow.length / inView.length) * 100) : 0,
      prevRate: inView.length ? Math.round((prevActive / inView.length) * 100) : null,
      avgDays: activeNow.length ? totalDays / inView.length : 0,
      sessions: sessions.length,
      avgSessDur: sessions.length ? totalSessMs / sessions.length : null,
      pagesPerSession: sessions.length ? totalViews / sessions.length
        : totalDays ? totalViews / totalDays : null,
      totalViews, prevViews: viewsIn(prevFrom, prevTo),
      inactive14,
    }
  }, [rows, inView, inViewIds, daysByUser, views, sessions, from, to, prevFrom, prevTo])

  // ── Trend series ─────────────────────────────────────────────────────────
  const trend = useMemo(() => {
    const days = eachDay(from, to)
    const prevDays = eachDay(prevFrom, prevTo)
    const dayViews = new Map(), dayUsers = new Map()
    for (const v of views) {
      if (!inViewIds.has(v.user_id)) continue
      dayViews.set(v.day, (dayViews.get(v.day) || 0) + v.views)
      if (!dayUsers.has(v.day)) dayUsers.set(v.day, new Set())
      dayUsers.get(v.day).add(v.user_id)
    }
    for (const a of activity) {
      if (!inViewIds.has(a.user_id)) continue
      if (!dayUsers.has(a.day)) dayUsers.set(a.day, new Set())
      dayUsers.get(a.day).add(a.user_id)
    }
    const daySess = new Map()
    for (const s of sessions) {
      const d = sydneyDayOf(s.start)
      daySess.set(d, (daySess.get(d) || 0) + 1)
    }
    const pick = (d) => trendMetric === 'views' ? (dayViews.get(d) || 0)
      : trendMetric === 'sessions' ? (daySess.get(d) || 0)
      : (dayUsers.get(d)?.size || 0)
    return days.map((d, i) => ({
      day: d.slice(5).replace('-', '/'),
      now: pick(d),
      prev: compare && prevDays[i] ? pick(prevDays[i]) : null,
    }))
  }, [views, activity, sessions, inViewIds, from, to, prevFrom, prevTo, trendMetric, compare])

  // ── Feature usage ────────────────────────────────────────────────────────
  const features = useMemo(() => {
    const agg = new Map(FEATURES.map(f => [f.key, { ...f, users: new Set(), visits: 0, last: null, daily: new Map(), prevVisits: 0 }]))
    for (const v of views) {
      if (!inViewIds.has(v.user_id)) continue
      const f = featureOf(v.path); if (!f) continue
      const a = agg.get(f.key)
      if (v.day >= prevFrom && v.day <= prevTo) a.prevVisits += v.views
      if (v.day < from || v.day > to) continue
      a.users.add(v.user_id); a.visits += v.views
      a.daily.set(v.day, (a.daily.get(v.day) || 0) + v.views)
      if (!a.last || v.day > a.last) a.last = v.day
    }
    let out = [...agg.values()].filter(f => f.visits > 0 || f.prevVisits > 0)
      .map(f => ({ ...f, users: f.users.size, rate: inView.length ? Math.round((f.users.size / inView.length) * 100) : 0 }))
    const sorters = {
      most: (a, b) => b.visits - a.visits,
      least: (a, b) => a.visits - b.visits,
      growing: (a, b) => (b.visits - b.prevVisits) - (a.visits - a.prevVisits),
      declining: (a, b) => (a.visits - a.prevVisits) - (b.visits - b.prevVisits),
    }
    out.sort(sorters[featureSort] || sorters.most)
    return out
  }, [views, inViewIds, inView.length, from, to, prevFrom, prevTo, featureSort])
  const maxFeatureVisits = features.reduce((a, f) => Math.max(a, f.visits), 0)

  // ── Attention cards ──────────────────────────────────────────────────────
  const attn = useMemo(() => ({
    inactive: rows.filter(r => r.daysSince != null && r.daysSince >= 14),
    never: rows.filter(r => r.neverSeen),
    quietWeek: rows.filter(r => !r.neverSeen && r.quietWeek),
    declining: rows.filter(r => r.declining),
  }), [rows])

  // ── Class comparison ─────────────────────────────────────────────────────
  const classRows = useMemo(() => {
    const rowById = new Map(rows.map(r => [r.s.id, r]))
    return classes.map(c => {
      const meta = classById.get(c.id)
      const roster = enrolments.filter(e => e.class_id === c.id).map(e => rowById.get(e.student_id)).filter(Boolean)
      if (!roster.length) return null
      const active = roster.filter(r => r.activeDays > 0).length
      const avg = (sel) => roster.reduce((a, r) => a + sel(r), 0) / roster.length
      return {
        id: c.id, name: c.class_name, teacher: meta.teacher, subject: meta.subject,
        total: roster.length, active,
        engagement: Math.round(avg(r => r.score)),
        avgDays: avg(r => r.activeDays),
        hw: Math.round(avg(r => r.parts.homework * 100)),
        rq: Math.round(avg(r => r.parts.quiz * 100)),
      }
    }).filter(Boolean).sort((a, b) => b.engagement - a.engagement)
  }, [classes, classById, enrolments, rows])

  // ── Student table ────────────────────────────────────────────────────────
  const tableRows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = rows.filter(r => {
      if (needle && !r.s.full_name.toLowerCase().includes(needle)) return false
      if (fStatus !== 'all' && r.status.key !== fStatus) return false
      if (attention === 'inactive' && !(r.daysSince == null || r.daysSince >= 14)) return false
      if (attention === 'never' && !r.neverSeen) return false
      if (attention === 'quietWeek' && !(r.quietWeek && !r.neverSeen)) return false
      if (attention === 'declining' && !r.declining) return false
      return true
    })
    const val = (r) => {
      switch (stuSort.key) {
        case 'name': return r.s.full_name
        case 'year': return r.s.year ?? 0
        case 'last': return r.daysSince ?? 9999
        case 'days': return r.activeDays
        case 'hw': return r.parts.homework
        case 'rq': return r.parts.quiz
        default: return r.score
      }
    }
    out.sort((a, b) => {
      const x = val(a), y = val(b)
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * stuSort.dir
    })
    return out
  }, [rows, q, fStatus, attention, stuSort])

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [
      ['Student', 'Year', 'Classes', 'Last active', 'Active days', 'Sessions', 'Homework', 'Quizzes', 'Score', 'Status'].join(','),
      ...tableRows.map(r => [
        esc(r.s.full_name), r.s.year ?? '', esc(r.rec.classes.map(c => c.class_name).join('; ')),
        r.lastDay ?? 'never', r.activeDays, eventsCover ? r.sessions : '',
        Math.round(r.parts.homework * 100) + '%', Math.round(r.parts.quiz * 100) + '%',
        r.score, r.status.label,
      ].join(',')),
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `portal-engagement-${from}-to-${to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Heatmap / journeys / feed (event stream) ─────────────────────────────
  const heat = useMemo(() => heatmapOf(studentEvents), [studentEvents])
  const heatMax = Math.max(1, ...heat.flat())
  const journeys = useMemo(() => journeysFrom(studentEvents), [studentEvents])
  const nameById = useMemo(() => new Map(students.map(s => [s.id, s.full_name])), [students])
  const feed = useMemo(() =>
    [...studentEvents].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 12),
  [studentEvents])

  const drawer = drawerId ? rows.find(r => r.s.id === drawerId) : null
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setDrawerId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const jumpToTable = (key) => {
    setAttention(key); setFStatus('all')
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const yearOptions = [...new Set(students.map(s => s.year).filter(Boolean))].sort((a, b) => a - b)
  const subjectOptions = [...new Set([...classById.values()].map(c => c.subject).filter(Boolean))].sort()
  const teacherOptions = [...new Set([...classById.values()].map(c => c.teacher).filter(Boolean))].sort()
  const sel = 'text-xs font-semibold text-[#2A2035] bg-white border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#325099]'

  const sortHead = (key, label, extra = '') => (
    <th className={`px-3 py-2.5 font-bold whitespace-nowrap cursor-pointer select-none hover:text-[#062E63] ${extra}`}
      onClick={() => setStuSort(s => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
      {label}{stuSort.key === key ? (stuSort.dir < 0 ? ' ↓' : ' ↑') : ''}
    </th>
  )

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 pb-20">

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        <div className="inline-flex rounded-lg border border-[#DEE7FF] overflow-hidden text-xs font-semibold bg-white">
          {[['week', 'This week'], ['7d', '7 days'], ['30d', '30 days'], ['term', 'This term'], ['custom', 'Custom']].map(([v, l]) => (
            <button key={v} onClick={() => setRange(v)}
              className={`px-3 py-1.5 transition ${range === v ? 'bg-[#325099] text-white' : 'text-[#2A2035]/60 hover:bg-[#F8FAFF]'}`}>{l}</button>
          ))}
        </div>
        {range === 'custom' && (
          <span className="inline-flex items-center gap-1">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className={sel} />
            <span className="text-xs text-[#2A2035]/40">→</span>
            <input type="date" value={customTo} max={today} onChange={e => setCustomTo(e.target.value)} className={sel} />
          </span>
        )}
        <span className="text-[11px] text-[#2A2035]/40">{from} → {to}</span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select value={fYear} onChange={e => setFYear(e.target.value)} className={sel}>
            <option value="all">All years</option>
            {yearOptions.map(y => <option key={y} value={y}>Year {y}</option>)}
          </select>
          <select value={fSubject} onChange={e => setFSubject(e.target.value)} className={sel}>
            <option value="all">All subjects</option>
            {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={fClass} onChange={e => setFClass(e.target.value)} className={sel}>
            <option value="all">All classes</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.class_name}</option>)}
          </select>
          <select value={fTeacher} onChange={e => setFTeacher(e.target.value)} className={sel}>
            <option value="all">All teachers</option>
            {teacherOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
        <Kpi label="Active students" value={`${kpis.active} / ${kpis.enrolled}`}
          sub={`${kpis.rate}% of enrolled`} />
        <Kpi label="Active rate" value={`${kpis.rate}%`}
          delta={<Delta now={kpis.rate} prev={kpis.prevRate} />} />
        <Kpi label="Avg active days" value={kpis.avgDays.toFixed(1)}
          sub="per enrolled student" />
        <Kpi label="Avg session length" value={eventsCover ? fmtDuration(kpis.avgSessDur) : '—'}
          sub={eventsCover ? `${kpis.sessions} sessions` : 'accruing from 19 Aug'}
          title="Sessions are read from the timestamped event stream (30-min gap rule)." />
        <Kpi label="Pages / session" value={kpis.pagesPerSession ? kpis.pagesPerSession.toFixed(1) : '—'}
          sub={eventsCover ? null : 'per active day until sessions accrue'}
          delta={<Delta now={kpis.totalViews} prev={kpis.prevViews} />} />
        <Kpi label="Inactive 14+ days" value={kpis.inactive14}
          sub="no portal activity" />
      </div>

      {/* ── Trend ── */}
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 mb-8">
        <SectionTitle title="Portal engagement" sub={compare ? 'solid = this period · dashed = previous' : null}
          right={
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-[#DEE7FF] overflow-hidden text-[11px] font-semibold">
                {[['active', 'Active students'], ['views', 'Page views'], ['sessions', 'Sessions']].map(([v, l]) => (
                  <button key={v} onClick={() => setTrendMetric(v)}
                    className={`px-2.5 py-1 transition ${trendMetric === v ? 'bg-[#325099] text-white' : 'bg-white text-[#2A2035]/60 hover:bg-[#F8FAFF]'}`}>{l}</button>
                ))}
              </div>
              <button onClick={() => setCompare(c => !c)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition ${compare ? 'border-[#BACBFF] bg-[#EEF4FF] text-[#062E63]' : 'border-[#DEE7FF] bg-white text-[#2A2035]/50'}`}>
                vs previous
              </button>
            </div>
          } />
        {trendMetric === 'sessions' && !eventsCover ? <AccruingNote /> : (
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={FAINT} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#8B93A7' }} tickLine={false} axisLine={{ stroke: LINE }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#8B93A7' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12 }} />
                {compare && <Line type="monotone" dataKey="prev" name="Previous" stroke="#B9C4DE" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />}
                <Line type="monotone" dataKey="now" name="This period" stroke={BLUE} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Feature usage ── */}
      <div className="mb-8">
        <SectionTitle title="Feature usage" sub="student portal pages, grouped by feature"
          right={
            <select value={featureSort} onChange={e => setFeatureSort(e.target.value)} className={sel}>
              <option value="most">Most used</option>
              <option value="least">Least used</option>
              <option value="growing">Growing</option>
              <option value="declining">Declining</option>
            </select>
          } />
        <div className="bg-white rounded-2xl border border-[#DEE7FF] divide-y divide-[#F4F7FF]">
          {features.map(f => (
            <div key={f.key}>
              <button className="w-full grid grid-cols-[1.2fr_2fr_auto_auto_auto] items-center gap-4 px-5 py-3 text-left hover:bg-[#FAFBFF] transition"
                onClick={() => setFeatureOpen(o => o === f.key ? null : f.key)}>
                <span className="text-sm font-semibold" style={{ color: INK }}>{f.label}</span>
                <Bar pct={maxFeatureVisits ? (f.visits / maxFeatureVisits) * 100 : 0} />
                <span className="text-xs tabular-nums text-[#2A2035]/70 w-24 text-right">{f.users} student{f.users === 1 ? '' : 's'} · {f.rate}%</span>
                <span className="text-xs tabular-nums font-semibold w-16 text-right" style={{ color: NAVY }}>{f.visits}</span>
                <span className="text-[#325099]/40 text-xs">{featureOpen === f.key ? '▾' : '▸'}</span>
              </button>
              {featureOpen === f.key && (
                <div className="px-5 pb-4 pt-1 grid md:grid-cols-[1fr_2fr] gap-4">
                  <div className="text-xs text-[#2A2035]/70 space-y-1">
                    <p><span className="font-semibold" style={{ color: NAVY }}>{f.users}</span> unique students ({f.rate}% of view)</p>
                    <p><span className="font-semibold" style={{ color: NAVY }}>{f.visits}</span> visits this period · {f.prevVisits} previous</p>
                    <p>Last opened {f.last ? relLabel(daysBetween(f.last, today)) : '—'}</p>
                  </div>
                  <div className="flex items-end gap-[3px] h-14">
                    {eachDay(from, to).slice(-28).map(d => {
                      const v = f.daily.get(d) || 0
                      const peak = Math.max(1, ...[...f.daily.values()])
                      return <div key={d} title={`${d}: ${v}`} className="flex-1 rounded-sm"
                        style={{ height: `${Math.max(4, (v / peak) * 100)}%`, background: v ? BLUE : '#EEF2FB' }} />
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
          {features.length === 0 && <p className="px-5 py-8 text-center text-xs text-[#2A2035]/40">No student page views in this period.</p>}
        </div>
      </div>

      {/* ── Requires attention ── */}
      <div className="mb-8">
        <SectionTitle title="Requires attention" sub="each card filters the table below" />
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ['inactive', attn.inactive.length, 'no portal activity for 14+ days'],
            ['quietWeek', attn.quietWeek.length, 'previously active, nothing this period'],
            ['never', attn.never.length, 'have never opened the portal'],
            ['declining', attn.declining.length, 'activity dropped sharply mid-period'],
          ].map(([key, n, blurb]) => (
            <div key={key} className={`bg-white rounded-2xl border px-5 py-4 ${n ? 'border-[#F3D9A4]' : 'border-[#DEE7FF]'}`}>
              <p className="text-[22px] font-bold font-display tabular-nums" style={{ color: n ? '#B45309' : NAVY }}>
                {n} <span className="text-xs font-semibold text-[#2A2035]/50">student{n === 1 ? '' : 's'}</span>
              </p>
              <p className="text-[11px] text-[#2A2035]/55 mt-0.5 min-h-[28px]">{blurb}</p>
              <button onClick={() => jumpToTable(key)} disabled={!n}
                className="text-[11px] font-bold text-[#325099] hover:text-[#062E63] disabled:opacity-30 mt-1">
                View students →
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Engagement by class ── */}
      <div className="mb-8">
        <SectionTitle title="Engagement by class" sub="sorted highest → lowest · click a class to filter" />
        <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-[9px] tracking-[0.16em] uppercase text-[#325099]/60 border-b border-[#EEF2FB]">
                <th className="px-4 py-2.5 font-bold">Class</th>
                <th className="px-3 py-2.5 font-bold">Teacher</th>
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">Active</th>
                <th className="px-3 py-2.5 font-bold w-44">Engagement</th>
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">Avg days</th>
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">Homework</th>
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">Quizzes</th>
              </tr>
            </thead>
            <tbody>
              {classRows.map(c => (
                <tr key={c.id} onClick={() => { setFClass(String(c.id)); setAttention(null) }}
                  className={`border-b border-[#F4F7FF] last:border-0 cursor-pointer transition hover:bg-[#FAFBFF] ${String(fClass) === String(c.id) ? 'bg-[#F3F7FF]' : ''}`}>
                  <td className="px-4 py-2.5 font-semibold" style={{ color: INK }}>{c.name}</td>
                  <td className="px-3 py-2.5 text-xs text-[#2A2035]/60">{c.teacher}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{c.active}/{c.total}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><Bar pct={c.engagement} color={c.engagement >= 60 ? '#0E7490' : c.engagement >= 40 ? BLUE : '#B45309'} /></div>
                      <span className="text-xs tabular-nums font-semibold w-8" style={{ color: NAVY }}>{c.engagement}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{c.avgDays.toFixed(1)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{c.hw}%</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{c.rq}%</td>
                </tr>
              ))}
              {classRows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-[#2A2035]/40">No classes match the filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Student table ── */}
      <div className="mb-8" ref={tableRef}>
        <SectionTitle title="Student engagement"
          sub={`score = portal engagement over the last ${daysBetween(scoreFrom, to) + 1} days, not academic ability`}
          right={
            <div className="flex items-center gap-2">
              {attention && (
                <button onClick={() => setAttention(null)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#B45309] border border-[#F3D9A4]">
                  {{ inactive: 'Inactive 14+d', never: 'Never seen', quietWeek: 'Quiet this period', declining: 'Declining' }[attention]} ✕
                </button>
              )}
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search students…" className={`${sel} w-44`} />
              <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={sel}>
                <option value="all">All statuses</option>
                <option value="high">Highly engaged</option>
                <option value="engaged">Engaged</option>
                <option value="moderate">Moderate</option>
                <option value="low">Low engagement</option>
                <option value="inactive">Inactive</option>
              </select>
              <button onClick={exportCsv} className="text-[11px] font-bold text-[#325099] border border-[#DEE7FF] bg-white px-3 py-1.5 rounded-lg hover:border-[#325099] transition">
                Export CSV
              </button>
            </div>
          } />
        <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-[9px] tracking-[0.16em] uppercase text-[#325099]/60 border-b border-[#EEF2FB]">
                {sortHead('name', 'Student', 'px-4')}
                {sortHead('year', 'Year')}
                <th className="px-3 py-2.5 font-bold">Classes</th>
                {sortHead('last', 'Last active')}
                {sortHead('days', 'Active days')}
                {sortHead('hw', 'Homework')}
                {sortHead('rq', 'Quizzes')}
                {sortHead('score', 'Score')}
                <th className="px-3 py-2.5 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(r => (
                <tr key={r.s.id} onClick={() => setDrawerId(r.s.id)}
                  className="border-b border-[#F4F7FF] last:border-0 cursor-pointer hover:bg-[#FAFBFF] transition">
                  <td className="px-4 py-2.5 font-semibold whitespace-nowrap" style={{ color: INK }}>{r.s.full_name}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{r.s.year ?? '—'}</td>
                  <td className="px-3 py-2.5 text-[11px] text-[#2A2035]/55 max-w-[180px] truncate">
                    {r.rec.classes.map(c => c.class_name).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: relColor(r.daysSince) }}>
                    {relLabel(r.daysSince)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{r.activeDays}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{Math.round(r.parts.homework * 100)}%</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{Math.round(r.parts.quiz * 100)}%</td>
                  <td className="px-3 py-2.5">
                    <span className="text-sm font-bold tabular-nums font-display" style={{ color: NAVY }}
                      title={SCORE_PARTS.map(p => `${p.label}: ${Math.round(r.parts[p.key] * 100)}% × ${p.weight}`).join('\n')}>
                      {r.score}
                    </span>
                  </td>
                  <td className="px-3 py-2.5"><Chip status={r.status} /></td>
                </tr>
              ))}
              {tableRows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-xs text-[#2A2035]/40">No students match.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-[#2A2035]/40 mt-2">
          {tableRows.length} of {rows.length} students shown · Homework and quiz figures are tutor-recorded (grades and RQ marks), portal activity is tracked automatically.
        </p>
      </div>

      {/* ── Event-stream sections ── */}
      <div className="grid lg:grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
          <SectionTitle title="Usage heatmap" sub="sessions by day and time (Sydney)" />
          {studentEvents.length === 0 ? <AccruingNote /> : (
            <div className="grid" style={{ gridTemplateColumns: 'auto repeat(7, 1fr)', gap: 4 }}>
              <div />
              {WEEKDAYS.map(d => <div key={d} className="text-[10px] text-center text-[#2A2035]/45 font-semibold">{d}</div>)}
              {DAYPARTS.map((p, pi) => (
                <FragmentRow key={p.key} label={p.label}>
                  {WEEKDAYS.map((d, di) => {
                    const v = heat[di][pi]
                    return <div key={d} title={`${d} ${p.label}: ${v} view${v === 1 ? '' : 's'}`}
                      className="h-9 rounded-md"
                      style={{ background: v ? `rgba(50, 80, 153, ${0.12 + 0.78 * (v / heatMax)})` : '#F4F7FF' }} />
                  })}
                </FragmentRow>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
          <SectionTitle title="After the dashboard" sub="where students go next" />
          {journeys.total === 0 ? <AccruingNote /> : (
            <div className="space-y-2">
              {journeys.steps.slice(0, 6).map(s => (
                <div key={s.label} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3">
                  <span className="text-xs font-semibold" style={{ color: INK }}>{s.label}</span>
                  <Bar pct={s.pct} color="#0E7490" />
                  <span className="text-xs tabular-nums text-[#2A2035]/60 w-10 text-right">{s.pct}%</span>
                </div>
              ))}
              <p className="text-[10px] text-[#2A2035]/40 pt-1">{journeys.total} dashboard exits measured</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent activity ── */}
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
        <SectionTitle title="Recent activity" sub="latest student page opens" />
        {feed.length === 0 ? <AccruingNote /> : (
          <ul className="divide-y divide-[#F4F7FF]">
            {feed.map(e => (
              <li key={e.id} className="py-1.5 flex items-baseline gap-3 text-xs">
                <span className="text-[#2A2035]/40 tabular-nums w-24 shrink-0">{sydTime(e.ts)}</span>
                <span className="font-semibold" style={{ color: INK }}>{firstName(nameById.get(e.user_id) || 'Student')}</span>
                <span className="text-[#2A2035]/60">opened {featureOf(e.path)?.label || e.path}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Student drawer ── */}
      {drawer && (
        <div className="fixed inset-0 z-50" onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawerId(null) }}>
          <div className="absolute inset-0 bg-[#062E63]/30 backdrop-blur-[2px]" onMouseDown={() => setDrawerId(null)} />
          <aside className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl overflow-y-auto">
            <div className="px-6 py-5 border-b border-[#F0F4FF] bg-[#F8FAFF] sticky top-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold font-display" style={{ color: NAVY }}>{drawer.s.full_name}</h3>
                  <p className="text-[11px] text-[#2A2035]/55 mt-0.5">
                    {drawer.s.year ? `Year ${drawer.s.year} · ` : ''}{drawer.rec.classes.map(c => c.class_name).join(' · ') || 'No classes'}
                  </p>
                </div>
                <button onClick={() => setDrawerId(null)} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none">✕</button>
              </div>
              <div className="flex items-center gap-4 mt-3">
                <div>
                  <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">Engagement</p>
                  <p className="text-2xl font-bold font-display tabular-nums" style={{ color: NAVY }}>{drawer.score}<span className="text-xs text-[#2A2035]/40"> /100</span></p>
                </div>
                <div>
                  <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">Last active</p>
                  <p className="text-sm font-semibold mt-1" style={{ color: relColor(drawer.daysSince) }}>{relLabel(drawer.daysSince)}</p>
                </div>
                <div>
                  <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">Active days</p>
                  <p className="text-sm font-semibold mt-1 tabular-nums" style={{ color: INK }}>{drawer.activeDays}</p>
                </div>
                <Chip status={drawer.status} />
              </div>
            </div>

            <div className="px-6 py-5 space-y-6">
              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-bold mb-2">What builds the score</p>
                <div className="space-y-2">
                  {SCORE_PARTS.map(p => {
                    const v = drawer.parts[p.key]
                    const lv = partLevel(v)
                    return (
                      <div key={p.key} className="grid grid-cols-[9.5rem_1fr_auto] items-center gap-3">
                        <span className="text-xs text-[#2A2035]/70">{p.label}</span>
                        <Bar pct={v * 100} color={lv.color} h={5} />
                        <span className="text-[10px] font-bold w-16 text-right" style={{ color: lv.color }}>{lv.label}</span>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-[#2A2035]/40 mt-2">Portal engagement only — not a measure of ability.</p>
              </section>

              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-bold mb-2">Weekly activity · 8 weeks</p>
                <DrawerTrend days={daysByUser.get(drawer.s.id)} today={today} />
              </section>

              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-bold mb-2">Features used · this period</p>
                <DrawerFeatures views={views} uid={drawer.s.id} from={from} to={to} />
              </section>

              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-bold mb-2">Recent activity</p>
                <DrawerFeed events={events} uid={drawer.s.id} />
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

// grid rows can't use <Fragment> with the key inside a styled grid, so a tiny helper
function FragmentRow({ label, children }) {
  return <>
    <div className="text-[10px] text-[#2A2035]/45 font-semibold flex items-center">{label}</div>
    {children}
  </>
}

function DrawerTrend({ days, today }) {
  const weeks = []
  for (let i = 7; i >= 0; i--) {
    const mon = addDays(mondayOf(today), -7 * i)
    const n = days ? [...days].filter(d => d >= mon && d <= addDays(mon, 6)).length : 0
    weeks.push({ mon, n })
  }
  const has = weeks.some(w => w.n > 0)
  if (!has) return <p className="text-xs text-[#2A2035]/40">No portal activity recorded in the last 8 weeks.</p>
  return (
    <div className="flex items-end gap-1.5 h-16">
      {weeks.map(w => (
        <div key={w.mon} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full rounded-sm" title={`w/c ${w.mon}: ${w.n} day${w.n === 1 ? '' : 's'}`}
            style={{ height: `${Math.max(6, (w.n / 7) * 100)}%`, background: w.n ? '#325099' : '#EEF2FB' }} />
          <span className="text-[8px] text-[#2A2035]/35">{w.mon.slice(5).replace('-', '/')}</span>
        </div>
      ))}
    </div>
  )
}

function DrawerFeatures({ views, uid, from, to }) {
  const mine = new Map()
  for (const v of views) {
    if (v.user_id !== uid || v.day < from || v.day > to) continue
    const f = featureOf(v.path); if (!f) continue
    mine.set(f.label, (mine.get(f.label) || 0) + v.views)
  }
  const list = [...mine].sort((a, b) => b[1] - a[1])
  if (!list.length) return <p className="text-xs text-[#2A2035]/40">Nothing opened in this period.</p>
  const max = list[0][1]
  return (
    <div className="space-y-1.5">
      {list.map(([label, n]) => (
        <div key={label} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3">
          <span className="text-xs text-[#2A2035]/70">{label}</span>
          <Bar pct={(n / max) * 100} h={5} />
          <span className="text-[11px] tabular-nums text-[#2A2035]/60 w-8 text-right">{n}</span>
        </div>
      ))}
    </div>
  )
}

function DrawerFeed({ events, uid }) {
  const mine = events.filter(e => e.user_id === uid)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 8)
  if (!mine.length) return <p className="text-xs text-[#2A2035]/40">No timestamped activity yet — tracking went live 19 Aug 2026.</p>
  return (
    <ul className="space-y-1.5">
      {mine.map(e => (
        <li key={e.id} className="text-xs flex items-baseline gap-2">
          <span className="text-[#2A2035]/40 tabular-nums w-24 shrink-0">{sydTime(e.ts)}</span>
          <span className="text-[#2A2035]/75">opened {featureOf(e.path)?.label || e.path}</span>
        </li>
      ))}
    </ul>
  )
}

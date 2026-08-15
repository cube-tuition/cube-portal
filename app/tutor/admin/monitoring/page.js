'use client'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { subjectOf } from '../../../../lib/subjectColours'
import { getCurrentTerm } from '../../../../lib/terms'

/*
 * Portal Monitoring — /tutor/admin/monitoring (admin/director only)
 *
 * Who is actually using the portal, per student and per staff member, from the
 * portal_activity table (one row per user per Sydney day; `visits` = throttled
 * portal opens, `logins` = fresh password sign-ins).
 *
 * Honest-numbers note, shown on the page too: sessions persist, so people
 * rarely re-enter a password — "logins" alone would undercount usage badly.
 * Active days is the headline metric; logins are shown alongside.
 */

const DAY_MS = 86400000
const WINDOW = 30      // headline window, days
const STRIP = 14       // per-row activity strip, days

/*
 * Friendly names for the normalised routes stored in portal_page_views. The
 * table keeps routes (/workbook/:id), not URLs, so this map stays small and
 * an unknown route simply shows its path rather than disappearing.
 */
const PAGE_NAMES = {
  '/dashboard': 'Home',
  '/classes': 'Classes',
  '/classes/:id': 'Class page',
  '/workbook/:id': 'Online workbook',
  '/workbook/view/:id': 'Workbook (view)',
  '/resources': 'Resources',
  '/pastpapers': 'Past Papers',
  '/dropin': 'Drop-in Help',
  '/archive': 'Past Terms',
  '/archive/:id': 'Past term detail',
  '/results': 'Results',
  '/timetable': 'Timetable',
  '/study': 'Study',
  '/analytics': 'Analytics',
  '/reset-password': 'Password reset',
  '/': 'Login',
}
const pageName = (p) => PAGE_NAMES[p] || p

/*
 * Activity buckets for the filter. Derived from "days since last seen" rather
 * than stored, so they always agree with the Last seen column.
 */
const ACTIVITY = [
  ['all', 'All activity', () => true],
  ['active', 'Active · 7d', (d) => d != null && d <= 6],
  ['lapsed', 'Lapsed · 7–30d', (d) => d != null && d > 6 && d <= 30],
  ['stale', 'Over 30d', (d) => d != null && d > 30],
  ['never', 'Never seen', (d) => d == null],
]

const sydneyToday = () => {
  // en-CA gives YYYY-MM-DD, which is also what portal_activity.day stores.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
}
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const relDay = (iso, today) => {
  if (!iso) return null
  return Math.round((new Date(today + 'T00:00:00') - new Date(iso + 'T00:00:00')) / DAY_MS)
}

function lastSeenLabel(days) {
  if (days == null) return { text: 'never', color: '#B23A3A' }
  if (days <= 0) return { text: 'today', color: '#047857' }
  if (days === 1) return { text: 'yesterday', color: '#047857' }
  if (days <= 7) return { text: `${days} days ago`, color: '#92400E' }
  return { text: `${days} days ago`, color: '#B23A3A' }
}

export default function PortalMonitoringPage() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)
  const [rows, setRows] = useState([])          // portal_activity, last 60 days
  const [views, setViews] = useState([])        // portal_page_views, last 60 days
  const [students, setStudents] = useState([])
  const [tutors, setTutors] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('students')    // 'students' | 'staff' | 'pages'
  const [sort, setSort] = useState({ key: 'lastSeen', dir: 'desc' })
  const [q, setQ] = useState('')
  const [openRow, setOpenRow] = useState(null)  // person id whose pages are expanded
  const [subjects, setSubjects] = useState({}) // student id -> ['Maths', 'English']
  const [fYear, setFYear] = useState('all')
  const [fActivity, setFActivity] = useState('all')
  const [fSubject, setFSubject] = useState('all')

  const today = useMemo(() => sydneyToday(), [])

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setStaff(profile)
      const since = addDays(today, -60)
      const [act, pv, stu, tut, dir] = await Promise.all([
        supabase.from('portal_activity').select('user_id, day, visits, logins, last_seen').gte('day', since),
        supabase.from('portal_page_views').select('user_id, day, path, views, last_seen').gte('day', since),
        supabase.from('students').select('id, full_name, year, status'),
        supabase.from('tutors').select('id, full_name, active'),
        supabase.from('directors').select('id, full_name'),
      ])
      setRows(act.data || [])
      setViews(pv.data || [])
      setStudents((stu.data || []).filter(s => s.status === 'active'))
      setTutors([
        ...(tut.data || []).filter(t => t.active !== false).map(t => ({ ...t, kind: 'Tutor' })),
        ...(dir.data || []).map(d => ({ ...d, kind: 'Director' })),
      ])

      // Which subjects each student is taking THIS term. Classes are per-term
      // rows, so this must be term-scoped or a student who did Maths two terms
      // ago would still be filtered as a Maths student today.
      const { data: terms } = await supabase.from('terms')
        .select('id, name, term_number, year, start_date, end_date')
      const term = getCurrentTerm(terms || [])
      if (term) {
        const { data: enr } = await supabase.from('enrolments')
          .select('student_id, status, classes!inner(term_id, courses(course_name))')
          .eq('classes.term_id', term.id)
        const map = {}
        for (const e of enr || []) {
          if (e.status === 'disenrol') continue
          const subj = subjectOf(e.classes?.courses?.course_name || '') || 'Other'
          const list = map[e.student_id] || (map[e.student_id] = [])
          if (!list.includes(subj)) list.push(subj)
        }
        for (const k of Object.keys(map)) map[k].sort()
        setSubjects(map)
      }
      setLoading(false)
    })()
  }, [router, today])

  // Per-user aggregates over the fetched window.
  const byUser = useMemo(() => {
    const cut30 = addDays(today, -(WINDOW - 1))
    const cutStrip = addDays(today, -(STRIP - 1))
    const m = new Map()
    for (const r of rows) {
      const u = m.get(r.user_id) || { lastDay: null, activeDays30: 0, logins30: 0, visits30: 0, strip: {} }
      if (!u.lastDay || r.day > u.lastDay) u.lastDay = r.day
      if (r.day >= cut30) {
        u.activeDays30 += 1
        u.logins30 += r.logins
        u.visits30 += r.visits
      }
      if (r.day >= cutStrip) u.strip[r.day] = (u.strip[r.day] || 0) + r.visits
      m.set(r.user_id, u)
    }
    return m
  }, [rows, today])

  // Page views over the headline window, sliced two ways: per person (for the
  // expandable row) and per page (for the Pages tab).
  const { pagesByUser, pageTotals } = useMemo(() => {
    const cut = addDays(today, -(WINDOW - 1))
    const byUser = new Map()   // user_id -> Map(path -> {views, last})
    const totals = new Map()   // path -> {views, users:Set, last}
    for (const r of views) {
      if (r.day < cut) continue
      const mine = byUser.get(r.user_id) || new Map()
      const cur = mine.get(r.path) || { views: 0, last: null }
      cur.views += r.views
      if (!cur.last || r.day > cur.last) cur.last = r.day
      mine.set(r.path, cur)
      byUser.set(r.user_id, mine)

      const t = totals.get(r.path) || { views: 0, users: new Set(), last: null }
      t.views += r.views
      t.users.add(r.user_id)
      if (!t.last || r.day > t.last) t.last = r.day
      totals.set(r.path, t)
    }
    return { pagesByUser: byUser, pageTotals: totals }
  }, [views, today])

  // Pages tab rows. Students and staff are counted separately, because "12
  // people opened Classes" means something different if 11 of them are tutors.
  const pageRows = useMemo(() => {
    const studentIds = new Set(students.map(s => s.id))
    const needle = q.trim().toLowerCase()
    const out = []
    for (const [path, t] of pageTotals) {
      const label = pageName(path)
      if (needle && !label.toLowerCase().includes(needle) && !path.toLowerCase().includes(needle)) continue
      let stuViews = 0
      const stuUsers = new Set()
      for (const [uid, m] of pagesByUser) {
        if (!studentIds.has(uid)) continue
        const cur = m.get(path)
        if (!cur) continue
        stuViews += cur.views
        stuUsers.add(uid)
      }
      out.push({
        path, label,
        views: t.views, users: t.users.size,
        stuViews, stuUsers: stuUsers.size,
        last: t.last, daysAgo: relDay(t.last, today),
      })
    }
    out.sort((a, b) => b.views - a.views || a.label.localeCompare(b.label))
    return out
  }, [pageTotals, pagesByUser, students, q, today])

  const maxPageViews = pageRows.length ? pageRows[0].views : 0

  const people = useMemo(() => {
    const isStudents = tab === 'students'
    const base = isStudents
      ? students.map(s => ({
          id: s.id, name: s.full_name, sub: s.year ? `Year ${s.year}` : '',
          year: s.year ?? null, subjects: subjects[s.id] || [],
        }))
      : tutors.map(t => ({ id: t.id, name: t.full_name, sub: t.kind, year: null, subjects: [] }))
    const needle = q.trim().toLowerCase()
    const activityTest = (ACTIVITY.find(a => a[0] === fActivity) || ACTIVITY[0])[2]
    const list = base
      .filter(p => !needle || p.name.toLowerCase().includes(needle))
      // The three filters only apply to students; the staff tab has no year
      // or subject, so leaving them set while switching tabs must not blank it.
      .filter(p => !isStudents || fYear === 'all' || String(p.year ?? '') === fYear)
      .filter(p => !isStudents || fSubject === 'all' || p.subjects.includes(fSubject))
      .map(p => {
        const u = byUser.get(p.id)
        return {
          ...p,
          lastSeen: u?.lastDay ?? null,
          daysAgo: relDay(u?.lastDay ?? null, today),
          activeDays30: u?.activeDays30 ?? 0,
          logins30: u?.logins30 ?? 0,
          visits30: u?.visits30 ?? 0,
          strip: u?.strip ?? {},
          pages: [...(pagesByUser.get(p.id) || new Map())]
            .map(([path, v]) => ({ path, label: pageName(path), ...v }))
            .sort((a, b) => b.views - a.views || a.label.localeCompare(b.label)),
        }
      })
    const filtered = list.filter(p => activityTest(p.daysAgo))
    const dir = sort.dir === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      if (sort.key === 'name') return dir * a.name.localeCompare(b.name)
      // Year sorts numerically, and students with no year recorded sink.
      if (sort.key === 'year') {
        const ay = Number(a.year), by = Number(b.year)
        const aOk = Number.isFinite(ay), bOk = Number.isFinite(by)
        if (!aOk && !bOk) return a.name.localeCompare(b.name)
        if (!aOk) return 1
        if (!bOk) return -1
        return dir * (ay - by) || a.name.localeCompare(b.name)
      }
      if (sort.key === 'subjects') {
        const as = a.subjects.join(', '), bs = b.subjects.join(', ')
        if (!as && !bs) return a.name.localeCompare(b.name)
        if (!as) return 1
        if (!bs) return -1
        return dir * as.localeCompare(bs) || a.name.localeCompare(b.name)
      }
      if (sort.key === 'lastSeen') {
        // "never" always sinks to the bottom regardless of direction.
        if (!a.lastSeen && !b.lastSeen) return a.name.localeCompare(b.name)
        if (!a.lastSeen) return 1
        if (!b.lastSeen) return -1
        return dir * a.lastSeen.localeCompare(b.lastSeen)
      }
      return dir * ((a[sort.key] || 0) - (b[sort.key] || 0)) || a.name.localeCompare(b.name)
    })
    return filtered
  }, [tab, students, tutors, subjects, byUser, pagesByUser, q, sort, today,
      fYear, fActivity, fSubject])

  const tiles = useMemo(() => {
    const active7 = (list) => list.filter(p => p.daysAgo != null && p.daysAgo <= 6).length
    const all = (kind) => (kind === 'students'
      ? students.map(s => ({ id: s.id }))
      : tutors.map(t => ({ id: t.id })))
      .map(p => ({ ...p, daysAgo: relDay(byUser.get(p.id)?.lastDay ?? null, today) }))
    const stu = all('students'), stf = all('staff')
    const cut7 = addDays(today, -6)
    const logins7 = rows.filter(r => r.day >= cut7).reduce((s, r) => s + r.logins, 0)
    return {
      students: `${active7(stu)}/${stu.length}`,
      staffN: `${active7(stf)}/${stf.length}`,
      logins7,
      never: stu.filter(p => p.daysAgo == null).length,
    }
  }, [students, tutors, byUser, rows, today])

  // Year and Subjects only exist for students, so the staff tab drops them.
  const headers = [
    ['name', 'Name'],
    ...(tab === 'students' ? [['year', 'Year'], ['subjects', 'Subjects']] : []),
    ['lastSeen', 'Last seen'], ['activeDays30', `Active days · ${WINDOW}d`],
    ['logins30', `Logins · ${WINDOW}d`], ['visits30', `Visits · ${WINDOW}d`],
  ]
  const colCount = headers.length + 2   // + activity strip + pages column

  // Year options come from the roster, so a new year level needs no code change.
  const yearOptions = useMemo(() => {
    const ys = [...new Set(students.map(s => s.year).filter(y => y != null && y !== ''))]
    return ys.sort((a, b) => Number(a) - Number(b)).map(String)
  }, [students])
  const subjectOptions = useMemo(() => {
    const set = new Set()
    for (const list of Object.values(subjects)) list.forEach(s => set.add(s))
    return [...set].sort()
  }, [subjects])
  const filtersOn = fYear !== 'all' || fActivity !== 'all' || fSubject !== 'all'
  const stripDays = Array.from({ length: STRIP }, (_, i) => addDays(today, i - (STRIP - 1)))

  if (loading || !staff) return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff?.full_name} isAdmin />
      <p className="text-sm text-[#325099]/60 text-center mt-24 animate-pulse font-semibold tracking-widest uppercase font-display">Loading…</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin={staff.role === 'admin'} />
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-8">
        <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">Admin</p>
        <h1 className="text-2xl font-bold text-[#2A2035] font-display mb-1">Portal Monitoring</h1>
        <p className="text-xs text-[#2A2035]/55 mb-6 max-w-2xl">
          Who is actually using the portal. Sessions stay signed in for weeks, so <strong>active days</strong> is
          the truthful measure of usage — logins only count fresh password sign-ins.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            ['Students active · 7d', tiles.students, '#047857'],
            ['Staff active · 7d', tiles.staffN, '#047857'],
            ['Fresh logins · 7d', tiles.logins7, '#325099'],
            ['Students never seen', tiles.never, tiles.never ? '#B23A3A' : '#047857'],
          ].map(([l, v, color]) => (
            <div key={l} className="bg-white rounded-2xl border border-[#DEE7FF] px-4 py-3">
              <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">{l}</p>
              <p className="text-2xl font-bold mt-0.5 font-display" style={{ color }}>{v}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {[['students', `Students · ${students.length}`], ['staff', `Staff · ${tutors.length}`],
            ['pages', `Pages · ${pageTotals.size}`]].map(([v, label]) => (
            <button key={v} onClick={() => { setTab(v); setOpenRow(null) }}
              className={`px-4 py-2 rounded-xl border text-sm font-semibold transition ${tab === v
                ? 'bg-[#DEE7FF] text-[#062E63] border-[#BACBFF]'
                : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`}>
              {label}
            </button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder={tab === 'pages' ? 'Search pages…' : 'Search names…'}
            className="ml-auto text-sm border border-[#DEE7FF] rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-[#325099] w-56" />
        </div>

        {tab === 'students' && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {[
              ['Year', fYear, setFYear, [['all', 'All years'], ...yearOptions.map(y => [y, `Year ${y}`])]],
              ['Activity', fActivity, setFActivity, ACTIVITY.map(([v, label]) => [v, label])],
              ['Subject', fSubject, setFSubject, [['all', 'All subjects'], ...subjectOptions.map(s => [s, s])]],
            ].map(([label, value, setter, options]) => (
              <label key={label} className="flex items-center gap-1.5">
                <span className="text-[9px] tracking-[0.16em] uppercase text-[#325099]/60 font-bold">{label}</span>
                <select value={value} onChange={e => setter(e.target.value)}
                  className="text-sm border border-[#DEE7FF] rounded-xl px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]">
                  {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            ))}
            <span className="text-xs text-[#2A2035]/45">
              {people.length} of {students.length} students
            </span>
            {filtersOn && (
              <button onClick={() => { setFYear('all'); setFActivity('all'); setFSubject('all') }}
                className="text-[11px] font-bold text-[#325099] hover:text-[#062E63] underline">
                clear filters
              </button>
            )}
          </div>
        )}

        {tab === 'pages' ? (
          <>
            <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
              <table className="w-full text-sm min-w-[680px]">
                <thead>
                  <tr className="text-left text-[9px] tracking-[0.16em] uppercase text-[#325099]/60 border-b border-[#EEF2FB]">
                    <th className="px-4 py-2.5 font-bold">Page</th>
                    <th className="px-4 py-2.5 font-bold whitespace-nowrap">Views · {WINDOW}d</th>
                    <th className="px-4 py-2.5 font-bold whitespace-nowrap">By students</th>
                    <th className="px-4 py-2.5 font-bold whitespace-nowrap">Students</th>
                    <th className="px-4 py-2.5 font-bold whitespace-nowrap">Last opened</th>
                    <th className="px-4 py-2.5 font-bold w-40">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(p => {
                    const seen = lastSeenLabel(p.daysAgo)
                    return (
                      <tr key={p.path} className="border-b border-[#F4F7FF] last:border-0">
                        <td className="px-4 py-2">
                          <span className="font-semibold text-[#2A2035]">{p.label}</span>
                          <span className="ml-2 text-[10px] text-[#2A2035]/35 font-mono">{p.path}</span>
                        </td>
                        <td className="px-4 py-2 tabular-nums font-semibold">{p.views}</td>
                        <td className="px-4 py-2 tabular-nums">{p.stuViews || <span className="text-[#2A2035]/30">—</span>}</td>
                        <td className="px-4 py-2 tabular-nums">{p.stuUsers || <span className="text-[#2A2035]/30">—</span>}</td>
                        <td className="px-4 py-2 font-semibold whitespace-nowrap" style={{ color: seen.color }}>{seen.text}</td>
                        <td className="px-4 py-2">
                          <div className="h-2 rounded-full bg-[#EEF2FB] overflow-hidden">
                            <div className="h-full rounded-full bg-[#325099]"
                              style={{ width: `${maxPageViews ? Math.round((p.views / maxPageViews) * 100) : 0}%` }} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {pageRows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-[#2A2035]/40">
                      No page views recorded yet.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-[#2A2035]/40 mt-3">
              Pages are grouped by route, so every online workbook counts under <span className="font-mono">/workbook/:id</span> rather
              than one row per booklet. &ldquo;By students&rdquo; excludes staff views.
            </p>
          </>
        ) : (
        <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-[9px] tracking-[0.16em] uppercase text-[#325099]/60 border-b border-[#EEF2FB]">
                {headers.map(([key, label]) => (
                  <th key={key} className="px-4 py-2.5 font-bold cursor-pointer select-none whitespace-nowrap"
                    onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
                    {label}{sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
                <th className="px-4 py-2.5 font-bold whitespace-nowrap">Last {STRIP} days</th>
                <th className="px-4 py-2.5 font-bold whitespace-nowrap">Pages</th>
              </tr>
            </thead>
            <tbody>
              {people.map(p => {
                const seen = lastSeenLabel(p.daysAgo)
                const open = openRow === p.id
                return (
                  <Fragment key={p.id}>
                  <tr className="border-b border-[#F4F7FF] last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-semibold text-[#2A2035]">{p.name}</span>
                      {/* The year already has its own column on the students
                          tab, so only staff need the sub-label here. */}
                      {p.sub && tab !== 'students' && (
                        <span className="ml-2 text-[10px] text-[#2A2035]/40">{p.sub}</span>
                      )}
                    </td>
                    {tab === 'students' && (
                      <>
                        <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                          {p.year != null && p.year !== ''
                            ? p.year
                            : <span className="text-[#2A2035]/30">—</span>}
                        </td>
                        <td className="px-4 py-2">
                          {p.subjects.length ? (
                            <span className="flex flex-wrap gap-1">
                              {p.subjects.map(s => (
                                <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#EEF2FB] text-[#062E63] whitespace-nowrap">{s}</span>
                              ))}
                            </span>
                          ) : <span className="text-[#2A2035]/30">—</span>}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-2 font-semibold whitespace-nowrap" style={{ color: seen.color }}>{seen.text}</td>
                    <td className="px-4 py-2 tabular-nums">{p.activeDays30 || <span className="text-[#2A2035]/30">—</span>}</td>
                    <td className="px-4 py-2 tabular-nums">{p.logins30 || <span className="text-[#2A2035]/30">—</span>}</td>
                    <td className="px-4 py-2 tabular-nums">{p.visits30 || <span className="text-[#2A2035]/30">—</span>}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-[3px]" title="One square per day, oldest → today">
                        {stripDays.map(d => {
                          const v = p.strip[d] || 0
                          return <span key={d} className="w-2.5 h-2.5 rounded-[3px]"
                            style={{ background: v === 0 ? '#EEF2FB' : v < 3 ? '#A7F3D0' : '#10B981' }} />
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {p.pages.length ? (
                        <button
                          onClick={() => setOpenRow(open ? null : p.id)}
                          className="text-[11px] font-bold text-[#325099] hover:text-[#062E63] underline whitespace-nowrap"
                        >
                          {open ? 'hide' : `${p.pages.length} page${p.pages.length === 1 ? '' : 's'}`}
                        </button>
                      ) : <span className="text-[#2A2035]/30">—</span>}
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-[#F8FAFF] border-b border-[#F4F7FF]">
                      <td colSpan={colCount} className="px-4 py-3">
                        <p className="text-[9px] tracking-[0.16em] uppercase text-[#325099]/60 font-bold mb-2">
                          Pages opened · {WINDOW}d
                        </p>
                        <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                          {p.pages.map(pg => (
                            <span key={pg.path} className="text-xs text-[#2A2035]/80 whitespace-nowrap">
                              {pg.label}
                              <span className="ml-1.5 font-bold tabular-nums text-[#062E63]">{pg.views}</span>
                              <span className="ml-1 text-[10px] text-[#2A2035]/40">
                                last {relDay(pg.last, today) === 0 ? 'today' : `${relDay(pg.last, today)}d ago`}
                              </span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
              {people.length === 0 && (
                <tr><td colSpan={colCount} className="px-4 py-8 text-center text-xs text-[#2A2035]/40">
                  {filtersOn ? 'No students match those filters.' : 'Nobody matches that search.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        <p className="text-[10px] text-[#2A2035]/40 mt-3">
          Tracking began {today} — history before that only knows each user&rsquo;s single most recent
          sign-in (seeded from the auth records), so 30-day counts grow more meaningful from here on.
        </p>
      </div>
    </div>
  )
}

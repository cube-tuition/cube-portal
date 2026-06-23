'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { normalizeDays, fmtTime, fmtTimeRange, isoDate } from '../../../lib/format'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../lib/terms'
import { weekLabelFor } from '../../../lib/calendarWeeks'
import MonthCalendarModal from '../../../components/calendar/MonthCalendarModal'
import { inferSubject } from '../../../components/CourseDetail'
import { T_CLASSES, T_ENROLMENTS, T_LESSONS, T_SUB_ASSIGNMENTS } from '../../../lib/tables'
import { buildClassLabelMap } from '../../../lib/classLabels'

// Parse "Y8 Maths" → 8 ; returns null if no Y-prefix.
const parseYearFromClass = (name) => {
  const m = String(name || '').match(/^[Yy](\d{1,2})/)
  return m ? parseInt(m[1], 10) : null
}

/*
 * Tutor classes view (Phase 2 — revised layout)
 * ─────────────────────────────────────────────────────────────────────────────
 * Two stacked sections, each anchored on a different question:
 *
 *   1. "Classes you teach this term"
 *      One card per distinct class_name (case-insensitive). Multi-section
 *      courses (e.g. "Y11 Chem" running Tue+Thu, or two 4pm/6pm offerings of
 *      the same name) collapse into a single card with all weekly slots
 *      listed. Untitled rows are HIDDEN — they're typically incomplete
 *      Airtable rows and were the main source of noise on the old view.
 *      Click → expand the merged roster across all sections.
 *
 *   2. "Next 7 days"
 *      Actual session occurrences derived from each class's day_of_week,
 *      rolling window today..today+6. Grouped by date with today highlighted.
 *      Click → expand to session-specific details (date, time, room, roster).
 *
 * Tutors are matched to classes by FIRST NAME on classes.teacher (Airtable
 * writes it that way). Admins see everything.
 *
 * NOTE: the `classes` table has no term_id, so "this term" effectively means
 * "everything currently in classes assigned to this tutor". If we add term
 * scoping later, this becomes a one-line filter in the load() block.
 */

const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const DAY_SHORT = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat', Sunday:'Sun' }
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const SUBJECT_COLOR = {
  Maths:     { bg: '#DEE7FF', fg: '#062E63' },
  Math:      { bg: '#DEE7FF', fg: '#062E63' },
  English:   { bg: '#FCE7F3', fg: '#9D174D' },
  EALD:      { bg: '#FCE7F3', fg: '#9D174D' },
  SpeakDev:  { bg: '#EDE9FE', fg: '#5B21B6' },
  Chemistry: { bg: '#D1FAE5', fg: '#065F46' },
  Chem:      { bg: '#D1FAE5', fg: '#065F46' },
  Physics:   { bg: '#E0E7FF', fg: '#3730A3' },
  Biology:   { bg: '#D1FAE5', fg: '#065F46' },
  Economics: { bg: '#FEF3C7', fg: '#92400E' },
  Econ:      { bg: '#FEF3C7', fg: '#92400E' },
  Science:   { bg: '#D1FAE5', fg: '#065F46' },
}
const pickSubjectColor = (name = '') => {
  const lower = name.toLowerCase()
  const keys = Object.keys(SUBJECT_COLOR).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    if (lower.includes(k.toLowerCase())) return SUBJECT_COLOR[k]
  }
  return { bg: '#DEE7FF', fg: '#062E63' }
}

// start_time / end_time are stored as PostgreSQL time (HH:MM:SS), 24-hour.
function startMinutes(t) {
  if (!t) return 99999
  const [hRaw, mRaw] = String(t).split(':')
  const h = parseInt(hRaw, 10)
  const m = parseInt(mRaw || '0', 10) || 0
  if (Number.isNaN(h)) return 99999
  return h * 60 + m
}
// Monday of the week containing d.
function mondayOf(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7   // 0 = Mon
  x.setDate(x.getDate() - dow)
  return x
}

// Date helpers — local time, no UTC drift
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  x.setHours(0, 0, 0, 0)
  return x
}
function dayNameOf(d) {
  return DAY_ORDER[(d.getDay() + 6) % 7] // Monday-indexed
}
function fmtDateLabel(d) {
  return `${DAY_SHORT[dayNameOf(d)]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
}

export default function TutorClassesPage() {
  const [staff, setStaff] = useState(null)
  const [allTerms, setAllTerms] = useState([])
  const [currentTerm, setCurrentTerm] = useState(null)
  const [selectedTermId, setSelectedTermId] = useState(null)
  const [classes, setClasses] = useState([])
  const [rosters, setRosters] = useState({}) // { [class_id]: [{ id, full_name, school, year }] }
  const [subSessions, setSubSessions] = useState([]) // [{ classId, dateISO, cls }] — sessions this tutor is subbing
  const [makeupSessions, setMakeupSessions] = useState([]) // [{ dateISO, lesson }] — 1:1 makeup lessons for this tutor
  const [dropinSessions, setDropinSessions] = useState([]) // [dropin_sessions row] — drop-in sessions for this tutor
  const [subDates, setSubDates] = useState(new Set()) // Set of "classId|dateISO" — own classes that have a sub assigned
  const [weekLessons, setWeekLessons] = useState([])  // actual lesson rows for the current week
  const [monthOpen, setMonthOpen] = useState(false)   // full-screen month calendar modal
  const [search, setSearch] = useState('')
  const [authErr, setAuthErr] = useState(null)
  const [expandedCourse, setExpandedCourse] = useState(null)   // course key (lowercased name)
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [selectedYear, setSelectedYear]       = useState(null)   // null = all years
  const [selectedSubject, setSelectedSubject] = useState(null)   // null = all subjects
  const [classView, setClassView]             = useState('all')  // 'all' | 'mine' — admins only
  const router = useRouter()

  // ── Auth + terms load (once) ──────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile) { setAuthErr('No profile found.'); return }
      if (profile.role !== 'tutor' && profile.role !== 'admin') {
        router.push('/dashboard')
        return
      }
      setStaff(profile)

      const terms = await fetchAllTerms()
      const cur = getCurrentTerm(terms)
      setAllTerms(terms)
      setCurrentTerm(cur)
      setSelectedTermId(cur?.id ?? null)
    }
    load()
  }, [])

  // ── Classes load (re-runs when term or staff changes) ─────────────────────
  useEffect(() => {
    if (!staff || !selectedTermId) return
    const load = async () => {
      const isAdmin = staff.role === 'admin'
      const firstName = (staff.full_name || '').split(' ')[0]

      // Filter by the selected term.
      let q = supabase.from(T_CLASSES).select('*')
        .eq('term_id', selectedTermId)
      // Non-admins always see only their own classes.
      // Admins see all classes unless they've switched to "My Classes".
      if (!isAdmin && firstName) q = q.ilike('teacher', firstName)
      else if (isAdmin && classView === 'mine' && firstName) q = q.ilike('teacher', firstName)
      const { data: cls } = await q

      // Hide untitled rows — these are typically incomplete Airtable rows and
      // were the main source of noise on the old day-by-day view. If a row
      // genuinely needs to appear here, give it a class_name in Airtable.
      const named = (cls || []).filter(c => (c.class_name || '').trim())
      setClasses(named)

      const classIds = named.map(c => c.id)
      if (classIds.length > 0) {
        const { data: links } = await supabase
          .from(T_ENROLMENTS)
          .select('class_id, students (id, full_name, school, year)')
          .in('class_id', classIds)
        const grouped = {}
        for (const link of links || []) {
          if (!link.students) continue
          if (!grouped[link.class_id]) grouped[link.class_id] = []
          grouped[link.class_id].push(link.students)
        }
        setRosters(grouped)
      } else {
        setRosters({})
      }

      // For non-admin tutors: also fetch any sub assignments for them
      // within a 6-week window (past 1 week → 5 weeks ahead) so their
      // subbed sessions show up in the weekly calendar.
      if (!isAdmin) {
        const today = isoDate(new Date())
        const sixWeeksAhead = isoDate(addDays(new Date(), 35))
        const oneWeekAgo = isoDate(addDays(new Date(), -7))
        const { data: subRows } = await supabase
          .from(T_SUB_ASSIGNMENTS)
          .select('class_id, session_date')
          .eq('sub_tutor_id', staff.id)
          .gte('session_date', oneWeekAgo)
          .lte('session_date', sixWeeksAhead)

        if (subRows?.length) {
          // Fetch the class rows for these sub assignments
          const subClassIds = [...new Set(subRows.map(r => r.class_id))]
          const { data: subClasses } = await supabase
            .from(T_CLASSES).select('*').in('id', subClassIds)
          const clsById = {}
          for (const c of subClasses || []) clsById[c.id] = c

          setSubSessions(subRows.map(r => ({
            classId: r.class_id,
            dateISO: r.session_date,
            cls: clsById[r.class_id],
          })).filter(r => r.cls))
        } else {
          setSubSessions([])
        }
      }

      // Fetch makeup 1:1 lessons assigned to this tutor (within 6 weeks either side)
      const today2 = isoDate(new Date())
      const ahead = isoDate(addDays(new Date(), 42))
      const behind = isoDate(addDays(new Date(), -7))
      const makeupQuery = supabase
        .from(T_LESSONS)
        .select('id, lesson_date, start_time, end_time, room, class_id, makeup_student_id, makeup_source_lesson_id, students!makeup_student_id(full_name, year), classes(class_name)')
        .eq('is_makeup', true)
        .gte('lesson_date', behind)
        .lte('lesson_date', ahead)
      if (!isAdmin || classView === 'mine') makeupQuery.eq('scheduled_teacher_id', staff.id)
      const { data: makeupRows } = await makeupQuery
      setMakeupSessions((makeupRows || []).map(r => ({ dateISO: r.lesson_date, lesson: r })))

      // (dropin sessions fetched in separate effect below)
    }
    load()
  }, [staff, selectedTermId, classView])

  // ── Fetch sub assignments for the visible week ────────────────────────────
  // Re-runs whenever the week or the class list changes. Populates subDates
  // so session pills on own classes can be highlighted amber when a sub is
  // covering them.
  useEffect(() => {
    if (!staff || classes.length === 0) return
    const weekISODates = Array.from({ length: 7 }, (_, i) =>
      isoDate(addDays(weekStart, i))
    )
    const classIds = classes.map(c => c.id)
    supabase
      .from(T_SUB_ASSIGNMENTS)
      .select('class_id, session_date')
      .in('class_id', classIds)
      .in('session_date', weekISODates)
      .then(({ data }) => {
        setSubDates(new Set((data || []).map(r => `${r.class_id}|${r.session_date}`)))
      })
  }, [weekStart, classes, staff])

  // ── Actual lessons for the current week (to override schedule-derived dates) ──
  useEffect(() => {
    if (classes.length === 0) return
    const weekMin = isoDate(weekStart)
    const weekMax = isoDate(addDays(weekStart, 6))
    supabase
      .from(T_LESSONS)
      .select('id, lesson_date, start_time, end_time, class_id, status')
      .gte('lesson_date', weekMin)
      .lte('lesson_date', weekMax)
      .is('makeup_student_id', null)
      .then(({ data }) => setWeekLessons(data || []))
  }, [weekStart, classes])

  // ── Drop-in sessions: re-fetch whenever week or staff changes ────────────
  useEffect(() => {
    if (!staff) return
    const isAdmin = staff.role === 'admin'
    const weekISODates = Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i)))
    const weekMin = weekISODates[0]
    const weekMax = weekISODates[6]
    const fetchDropins = async () => {
      let q = supabase
        .from('dropin_sessions')
        .select('*')
        .gte('session_date', weekMin)
        .lte('session_date', weekMax)
      if (!isAdmin || classView === 'mine') {
        q = q.contains('tutors', [staff.full_name])
      }
      const { data } = await q
      setDropinSessions(data || [])
    }
    fetchDropins()
  }, [staff, weekStart, classView])

  // ── Top section: distinct courses by class_name ────────────────────────
  // We merge multiple DB rows that share a name (e.g. a course that runs on
  // Tue AND Thu shows once) and union the rosters (deduping students).
  // Classes sharing a course get A/B/C labels when 2+ exist for that course.
  const classLabelMap = useMemo(() => buildClassLabelMap(classes), [classes])

  // ── Filter options derived from loaded classes ─────────────────────────────
  const availableYears = useMemo(() => {
    const s = new Set()
    for (const c of classes) { const y = parseYearFromClass(c.class_name); if (y) s.add(y) }
    return [...s].sort((a, b) => a - b)
  }, [classes])

  const availableSubjects = useMemo(() => {
    const s = new Set()
    for (const c of classes) { const sub = inferSubject({ class_name: c.class_name }); if (sub) s.add(sub) }
    return [...s].sort()
  }, [classes])

  const filteredClasses = useMemo(() => {
    return classes.filter(c => {
      const q = search.trim().toLowerCase()
      if (q && !((c.class_name||'').toLowerCase().includes(q)||(c.teacher||'').toLowerCase().includes(q)||(c.room||'').toLowerCase().includes(q))) return false
      if (selectedYear !== null && parseYearFromClass(c.class_name) !== selectedYear) return false
      if (selectedSubject !== null && inferSubject({ class_name: c.class_name }) !== selectedSubject) return false
      return true
    })
  }, [classes, search, selectedYear, selectedSubject])

  const courses = useMemo(() => {
    const map = new Map()
    for (const c of classes) {
      const label = classLabelMap.get(c.id) ?? c.class_name?.trim() ?? ''
      // Use class id as key so labelled siblings don't collapse into one card
      const key = c.id
      if (!map.has(key)) {
        map.set(key, { key: String(key), displayName: label, rows: [] })
      }
      map.get(key).rows.push(c)
    }

    return [...map.values()]
      .map(course => {
        // Weekly sections: one entry per (row × day_of_week). A row with
        // day_of_week = ["Tue","Thu"] contributes two sections.
        const sections = []
        for (const row of course.rows) {
          const days = normalizeDays(row.day_of_week)
          const common = {
            classId: row.id,
            time: row.start_time,
            end: row.end_time,
            room: row.room,
            teacher: row.teacher,
            rate: row.hourly_rate, // teacher pay rate, $/hr
          }
          if (days.length === 0) {
            sections.push({ ...common, day: '' })
          } else {
            for (const d of days) sections.push({ ...common, day: d })
          }
        }
        sections.sort((a, b) => {
          const di = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day)
          if (di !== 0) return di
          return startMinutes(a.time) - startMinutes(b.time)
        })

        // Dedupe students across all class IDs grouped under this name
        const studentMap = new Map()
        for (const row of course.rows) {
          for (const s of (rosters[row.id] || [])) {
            if (s?.id && !studentMap.has(s.id)) studentMap.set(s.id, s)
          }
        }

        return {
          ...course,
          sections,
          roster: [...studentMap.values()].sort((a, b) =>
            (a.full_name || '').localeCompare(b.full_name || '')
          ),
          teachers: [...new Set(course.rows.map(r => r.teacher).filter(Boolean))],
        }
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [classes, rosters])

  // ── Bottom section: explode classes into session occurrences for the
  // currently-viewed week (Mon-Sun). Driven by `weekStart`.
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const upcomingSessions = useMemo(() => {
    const out = []

    // The calendar is driven PURELY by actual lesson rows for the visible dates —
    // no recurring-schedule projection — so a week with no rows (e.g. beyond the
    // term) shows nothing, matching the database exactly.
    const activeLessons = weekLessons.filter(l => l.status !== 'cancelled')

    // When a 1:1 lesson is moved to another day, a makeup row is created pointing
    // back at the original via makeup_source_lesson_id (the original row stays).
    // Hide that original so the session only shows on its new (makeup) day.
    const movedSourceIds = new Set(
      (makeupSessions || []).map(m => m.lesson?.makeup_source_lesson_id).filter(Boolean)
    )
    const isOneToOne = (c) => /\b1\s*:\s*1\b/.test(c?.class_name || '')

    for (const lesson of activeLessons) {
      const cls = classes.find(c => c.id === lesson.class_id)
      if (!cls) continue
      if (movedSourceIds.has(lesson.id) && isOneToOne(cls)) continue // moved 1:1 — shows on the makeup day only
      const d = new Date(lesson.lesson_date + 'T00:00:00')
      out.push({
        key:     `lesson-${lesson.id}`,
        date:    d,
        dateISO: lesson.lesson_date,
        dayName: dayNameOf(d),
        cls:     { ...cls, start_time: lesson.start_time || cls.start_time, end_time: lesson.end_time || cls.end_time },
        lessonId: lesson.id,
      })
    }

    out.sort((a, b) => {
      if (a.date.getTime() !== b.date.getTime()) return a.date - b.date
      return startMinutes(a.cls.start_time) - startMinutes(b.cls.start_time)
    })
    return out
  }, [classes, weekLessons, makeupSessions])

  const sessionsByDate = useMemo(() => {
    const map = new Map()
    for (const s of upcomingSessions) {
      if (!map.has(s.dateISO)) map.set(s.dateISO, [])
      map.get(s.dateISO).push({
        ...s,
        hasSub: subDates.has(`${s.cls.id}|${s.dateISO}`),
      })
    }
    // Inject sub sessions into the calendar (only those in the current week view)
    for (const sub of subSessions) {
      const weekISODates = weekDays.map(d => isoDate(d))
      if (!weekISODates.includes(sub.dateISO)) continue
      // Avoid duplicates (if somehow the sub is also listed as regular teacher)
      const existing = map.get(sub.dateISO) || []
      if (existing.some(s => s.cls.id === sub.classId)) continue
      if (!map.has(sub.dateISO)) map.set(sub.dateISO, [])
      map.get(sub.dateISO).push({
        key: `sub-${sub.classId}-${sub.dateISO}`,
        date: new Date(sub.dateISO + 'T00:00:00'),
        dateISO: sub.dateISO,
        dayName: '',
        cls: sub.cls,
        isSub: true,
      })
    }
    // Inject makeup 1:1 sessions for this tutor
    for (const { dateISO, lesson } of makeupSessions) {
      const weekISODates = weekDays.map(d => isoDate(d))
      if (!weekISODates.includes(dateISO)) continue
      if (!map.has(dateISO)) map.set(dateISO, [])
      const studentName = lesson.students?.full_name || 'Student'
      // Build a synthetic cls-like object for the pill renderer
      const syntheticCls = {
        id: `makeup-${lesson.id}`,
        class_name: `1:1 Makeup · ${studentName}`,
        start_time: lesson.start_time,
        end_time: lesson.end_time,
        room: lesson.room,
        teacher: null,
      }
      map.get(dateISO).push({
        key: `makeup-${lesson.id}-${dateISO}`,
        date: new Date(dateISO + 'T00:00:00'),
        dateISO,
        dayName: '',
        cls: syntheticCls,
        isMakeup: true,
        lesson,
        studentName,
      })
    }
    // Inject drop-in sessions for this tutor
    for (const di of dropinSessions) {
      const weekISODates = weekDays.map(d => isoDate(d))
      if (!weekISODates.includes(di.session_date)) continue
      if (!map.has(di.session_date)) map.set(di.session_date, [])
      const syntheticCls = {
        id: `dropin-${di.id}`,
        class_name: `Drop-in · ${di.location || 'Centre'}`,
        start_time: di.start_time,
        end_time: di.end_time,
        room: di.location || null,
        teacher: null,
      }
      map.get(di.session_date).push({
        key: `dropin-${di.id}`,
        date: new Date(di.session_date + 'T00:00:00'),
        dateISO: di.session_date,
        dayName: '',
        cls: syntheticCls,
        isDropin: true,
        dropin: di,
      })
    }
    return map
  }, [upcomingSessions, subSessions, weekDays, subDates, makeupSessions, dropinSessions])

  const todayISO = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return isoDate(d)
  }, [])

  const totalStudents = useMemo(
    () => courses.reduce((sum, c) => sum + c.roster.length, 0),
    [courses]
  )

  if (authErr) return (
    <div className="min-h-screen flex items-center justify-center bg-white px-6">
      <p className="text-sm text-[#B23A3A]">{authErr}</p>
    </div>
  )

  if (!staff) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">
        Loading…
      </div>
    </div>
  )

  const isAdmin = staff.role === 'admin'
  const firstName = (staff.full_name || '').split(' ')[0]

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={isAdmin} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-7 md:py-9">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">
              {isAdmin ? (classView === 'mine' ? `My classes · ${firstName}` : 'All classes · Admin view') : 'My classes · Tutor view'}
            </p>
            {allTerms.length > 0 && (
              <div className="relative">
                <select
                  value={selectedTermId || ''}
                  onChange={e => { setSelectedTermId(e.target.value); setExpandedCourse(null); setSelectedYear(null); setSelectedSubject(null) }}
                  className="appearance-none inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] pl-2.5 pr-6 py-1 rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition"
                >
                  {allTerms.map(t => (
                    <option key={t.id} value={t.id}>
                      {formatTermLabel(t)}{t.id === currentTerm?.id ? ' · Current' : ''}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#325099] text-[8px]">▼</span>
              </div>
            )}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Your Classes
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            What you're teaching this term, and what's coming up over the next week.
          </p>

          <div className="mt-8 max-w-xs">
            <StatTile
              label={allTerms.find(t => t.id === selectedTermId)?.name ?? 'This term'}
              value={courses.length}
              suffix={`class${courses.length === 1 ? '' : 'es'}`}
            />
          </div>
        </div>
      </section>

      {/* STICKY FILTER BAR */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#DEE7FF] shadow-[0_1px_8px_-4px_rgba(50,80,153,0.10)]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-2.5 flex flex-wrap items-center gap-2">

          {/* Search */}
          <div className="relative shrink-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#325099]/40 text-xs pointer-events-none">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search classes, teachers, rooms…"
              className="pl-7 pr-7 py-1.5 text-xs bg-[#F8FAFF] border border-[#DEE7FF] rounded-full text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition w-52"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#2A2035]/30 hover:text-[#2A2035]/70 transition text-xs leading-none">✕</button>
            )}
          </div>

          {/* All / My Classes toggle — admins only */}
          {isAdmin && (
            <>
              <span className="w-px h-5 bg-[#DEE7FF] hidden sm:block" />
              <div className="flex items-center bg-[#F0F4FF] rounded-full p-0.5 gap-0.5">
                {[['all', 'All classes'], ['mine', 'My classes']].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setClassView(val)}
                    className={`text-[10px] font-bold px-3 py-1 rounded-full transition ${classView === val ? 'bg-white text-[#062E63] shadow-sm' : 'text-[#325099]/60 hover:text-[#325099]'}`}
                  >{label}</button>
                ))}
              </div>
            </>
          )}

          {/* Divider */}
          {availableYears.length > 0 && <span className="w-px h-5 bg-[#DEE7FF] hidden sm:block" />}

          {/* Year chips */}
          {availableYears.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setSelectedYear(null)}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition ${selectedYear === null ? 'bg-[#062E63] text-white' : 'bg-[#F0F4FF] text-[#325099] hover:bg-[#DEE7FF]'}`}
              >All years</button>
              {availableYears.map(y => (
                <button
                  key={y}
                  onClick={() => { setSelectedYear(selectedYear === y ? null : y); setSelectedSubject(null) }}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition ${selectedYear === y ? 'bg-[#325099] text-white' : 'bg-[#F0F4FF] text-[#325099] hover:bg-[#DEE7FF]'}`}
                >Y{y}</button>
              ))}
            </div>
          )}

          {/* Subject chips — only shown when year is selected or few subjects */}
          {availableSubjects.length > 0 && (availableYears.length <= 1 || selectedYear !== null || availableSubjects.length <= 5) && (
            <>
              <span className="w-px h-5 bg-[#DEE7FF] hidden sm:block" />
              <div className="flex items-center gap-1 flex-wrap">
                {selectedSubject !== null && (
                  <button
                    onClick={() => setSelectedSubject(null)}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#F0F4FF] text-[#325099] hover:bg-[#DEE7FF] transition"
                  >All subjects</button>
                )}
                {availableSubjects
                  .filter(sub => {
                    // Only show subjects that exist in current year filter
                    if (selectedYear === null) return true
                    return classes.some(c => parseYearFromClass(c.class_name) === selectedYear && inferSubject({ class_name: c.class_name }) === sub)
                  })
                  .map(sub => {
                    const col = pickSubjectColor(sub)
                    const active = selectedSubject === sub
                    return (
                      <button
                        key={sub}
                        onClick={() => setSelectedSubject(active ? null : sub)}
                        className="text-[10px] font-bold px-2.5 py-1 rounded-full transition"
                        style={active
                          ? { background: col.fg, color: '#fff' }
                          : { background: col.bg, color: col.fg }}
                      >{sub}</button>
                    )
                  })}
              </div>
            </>
          )}

          {/* Count */}
          <span className="ml-auto text-[10px] tracking-widest uppercase font-semibold text-[#325099]/50 shrink-0">
            {filteredClasses.length} class{filteredClasses.length === 1 ? '' : 'es'}
          </span>
        </div>
      </div>

      {/* SECTION 1 — Classes grouped by Year → Subject */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 pt-8">

        {classes.length === 0 ? (
          <EmptyState isAdmin={isAdmin} firstName={firstName} />
        ) : isAdmin ? (
          <AdminClassesView
            classes={filteredClasses}
            rosters={rosters}
            classLabelMap={classLabelMap}
            selectedYear={selectedYear}
            selectedSubject={selectedSubject}
          />
        ) : (
          <YearSubjectGrid classes={filteredClasses} rosters={rosters} showTeacher={false} classLabelMap={classLabelMap} />
        )}
      </section>

      {/* SECTION 2 — Weekly calendar */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
              {weekStart.getTime() === mondayOf(new Date()).getTime() ? 'This week' : 'Week of'}
            </p>
            <h2 className="text-lg font-semibold text-[#2A2035] font-display">
              {weekLabelFor(weekStart, allTerms)?.label ?? `${fmtDateLabel(weekDays[0])} – ${fmtDateLabel(weekDays[6])}`}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              className="text-xs font-semibold text-[#062E63] bg-white border border-[#DEE7FF] hover:bg-[#F8FAFF] px-3 py-1.5 rounded-full transition"
            >
              ← Previous
            </button>
            <button
              onClick={() => setWeekStart(mondayOf(new Date()))}
              className="text-xs font-semibold text-[#062E63] bg-white border border-[#DEE7FF] hover:bg-[#F8FAFF] px-3 py-1.5 rounded-full transition"
            >
              This week
            </button>
            <button
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              className="text-xs font-semibold text-[#062E63] bg-white border border-[#DEE7FF] hover:bg-[#F8FAFF] px-3 py-1.5 rounded-full transition"
            >
              Next →
            </button>
            <button
              onClick={() => setMonthOpen(true)}
              className="text-xs font-semibold text-white bg-[#062E63] hover:bg-[#325099] px-3 py-1.5 rounded-full transition"
            >
              ▦ Full view
            </button>
            <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60 ml-2">
              {upcomingSessions.length} session{upcomingSessions.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {sessionsByDate.size === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-4xl mb-3">🌤️</div>
            <p className="text-sm font-semibold text-[#2A2035] mb-1">Nothing on this week.</p>
            <p className="text-xs text-[#2A2035]/60 max-w-md mx-auto">
              Use the arrows to view other weeks.
            </p>
          </div>
        ) : (
          <WeekCards
            weekDays={weekDays}
            sessionsByDate={sessionsByDate}
            todayISO={todayISO}
            showTeacher={isAdmin}
            rosters={rosters}
            currentTerm={currentTerm}
            classLabelMap={classLabelMap}
          />
        )}
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">
            © CUBE Tuition · Chatswood
          </p>
        </div>
      </footer>

      {monthOpen && (
        <MonthCalendarModal
          classes={classes}
          staff={staff}
          isAdmin={staff?.role === 'admin'}
          classView={classView}
          terms={allTerms}
          onClose={() => setMonthOpen(false)}
        />
      )}
    </div>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function StatTile({ label, value, suffix }) {
  return (
    <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
      <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">{label}</p>
      <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">
        {value}
        <span className="text-sm font-medium text-[#2A2035]/50 ml-1">{suffix}</span>
      </p>
    </div>
  )
}

// ── Admin hierarchy view: Year → Subject → Class Type → ClassTile grid ────
function AdminClassesView({ classes, rosters, classLabelMap, selectedYear, selectedSubject }) {
  const hierarchy = useMemo(() => {
    const yearMap = new Map()

    for (const c of classes) {
      const yearNum  = parseYearFromClass(c.class_name) ?? 9999
      const yearLabel = yearNum !== 9999 ? `Year ${yearNum}` : 'Other'
      const subject   = inferSubject({ class_name: c.class_name }) || 'Other'
      const isOneToOne = /1.?:?.?1/i.test(c.class_name || '')
      const classType  = isOneToOne ? '1:1 Classes' : 'Group Classes'

      if (!yearMap.has(yearNum)) yearMap.set(yearNum, { yearNum, yearLabel, subjects: new Map() })
      const subjMap = yearMap.get(yearNum).subjects
      if (!subjMap.has(subject)) subjMap.set(subject, new Map())
      const typeMap = subjMap.get(subject)
      if (!typeMap.has(classType)) typeMap.set(classType, [])
      typeMap.get(classType).push(c)
    }

    return [...yearMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, { yearNum, yearLabel, subjects }]) => ({
        yearNum,
        yearLabel,
        subjects: [...subjects.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([subject, types]) => ({
            subject,
            types: [...types.entries()]
              .sort(([a], [b]) => {
                // Group Classes always before 1:1 Classes
                if (a === 'Group Classes') return -1
                if (b === 'Group Classes') return 1
                return 0
              })
              .map(([type, clsList]) => ({
                type,
                classes: [...clsList].sort((a, b) => {
                  const dA = normalizeDays(a.day_of_week)
                  const dB = normalizeDays(b.day_of_week)
                  const iA = dA.length ? DAY_ORDER.indexOf(dA[0]) : 99
                  const iB = dB.length ? DAY_ORDER.indexOf(dB[0]) : 99
                  if (iA !== iB) return iA - iB
                  return startMinutes(a.start_time) - startMinutes(b.start_time)
                }),
              })),
          })),
      }))
  }, [classes])

  if (!hierarchy.length) return null

  const hideYearHeaders    = selectedYear !== null || hierarchy.length === 1
  const hideSubjectHeaders = selectedSubject !== null

  if (!hierarchy.length) return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
      <div className="text-4xl mb-3">🔍</div>
      <p className="text-sm font-semibold text-[#2A2035]">No classes match your filters.</p>
    </div>
  )

  return (
    <div className={hideYearHeaders ? 'space-y-8' : 'space-y-12'}>
      {hierarchy.map(({ yearNum, yearLabel, subjects }) => (
        <div key={yearNum}>
          {/* ── Year header — hidden when filtered to a single year ── */}
          {!hideYearHeaders && (
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-2xl font-bold text-[#2A2035] font-display shrink-0">{yearLabel}</h2>
              <div className="flex-1 h-px bg-[#DEE7FF]" />
            </div>
          )}

          <div className={hideYearHeaders ? 'space-y-6' : 'space-y-8'}>
            {subjects.map(({ subject, types }) => {
              const col = pickSubjectColor(subject)
              return (
                <div key={subject}>
                  {/* ── Subject header — hidden when filtered to one subject ── */}
                  {!hideSubjectHeaders && (
                    <div className="flex items-center gap-3 mb-4">
                      {!hideYearHeaders ? (
                        <>
                          <span className="text-[11px] font-bold tracking-[0.15em] uppercase px-3 py-1 rounded-full" style={{ background: col.bg, color: col.fg }}>
                            {subject}
                          </span>
                          <div className="flex-1 h-px" style={{ background: col.bg }} />
                        </>
                      ) : (
                        /* When year header is gone, show a slightly larger subject label */
                        <>
                          <span className="text-sm font-bold tracking-wide px-3 py-1 rounded-full" style={{ background: col.bg, color: col.fg }}>
                            {subject}
                          </span>
                          <div className="flex-1 h-px" style={{ background: col.bg }} />
                        </>
                      )}
                    </div>
                  )}

                  <div className="space-y-4">
                    {types.map(({ type, classes: typeClasses }) => (
                      <div key={type}>
                        <p className="text-[10px] tracking-[0.3em] uppercase font-semibold text-[#325099]/50 mb-2 font-display pl-0.5">
                          {type}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                          {typeClasses.map(c => (
                            <ClassTile
                              key={c.id}
                              cls={c}
                              label={classLabelMap?.get(c.id)}
                              rosterCount={(rosters[c.id] || []).length}
                              showTeacher={true}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// Flat 4-col grid, sorted by Year ascending then Subject A→Z.
// No section headers — the hierarchy is conveyed by the sort order plus the
// subject pill on each card. Year band sits on the card as a small chip.
function YearSubjectGrid({ classes, rosters, showTeacher, classLabelMap }) {
  const ordered = useMemo(() => {
    return [...classes].sort((a, b) => {
      const ya = parseYearFromClass(a.class_name) ?? 9999
      const yb = parseYearFromClass(b.class_name) ?? 9999
      if (ya !== yb) return ya - yb
      const sa = (inferSubject(a) || 'Other')
      const sb = (inferSubject(b) || 'Other')
      const ds = sa.localeCompare(sb)
      if (ds !== 0) return ds
      return (a.class_name || '').localeCompare(b.class_name || '')
    })
  }, [classes])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {ordered.map(c => (
        <ClassTile
          key={c.id}
          cls={c}
          label={classLabelMap?.get(c.id)}
          rosterCount={(rosters[c.id] || []).length}
          showTeacher={showTeacher}
        />
      ))}
    </div>
  )
}

// Card layout:
//   Heading  — class name (largest) + roster-count badge on the right
//   Body     — Day + Time (prominent, single line)
//              Room (smaller)
//              Teacher (admin only, smaller)
function ClassTile({ cls, label, rosterCount, showTeacher }) {
  const displayName = label ?? cls.class_name
  const col = pickSubjectColor(cls.class_name)
  const days = normalizeDays(cls.day_of_week)

  return (
    <Link
      href={`/tutor/classes/${cls.id}`}
      className="group block rounded-2xl border border-[#DEE7FF] bg-white p-4 hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition relative overflow-hidden"
    >
      {/* Subject color stripe along the left edge */}
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: col.fg }} />

      <div className="pl-2">
        {/* Class name — biggest element. Roster badge sits to the right. */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-base md:text-lg font-bold text-[#2A2035] font-display leading-tight truncate flex-1 min-w-0">
            {displayName}
          </p>
          <span
            className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full shrink-0 ${
              rosterCount === 0 ? 'bg-[#F4F4F4] text-[#9CA3AF]' : 'bg-[#DEE7FF] text-[#062E63]'
            }`}
            title={`${rosterCount} student${rosterCount === 1 ? '' : 's'} enrolled`}
          >
            {rosterCount}
          </span>
        </div>

        {/* Day + time — prominent */}
        {days.length > 0 && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#062E63] bg-[#F8FAFF] border border-[#DEE7FF] px-2 py-0.5 rounded-full">
              {days.map(d => DAY_SHORT[d]).join(' · ')}
            </span>
            <span className="text-sm font-semibold text-[#2A2035] tabular-nums">
              {fmtTime(cls.start_time)}–{fmtTime(cls.end_time)}
            </span>
          </div>
        )}

        {/* Room / teacher — quiet metadata */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#2A2035]/55">
          {cls.room && <span>📍 {cls.room}</span>}
          {showTeacher && cls.teacher && <span>👤 {cls.teacher}</span>}
        </div>

        {/* Subtle arrow on hover */}
        <span className="absolute right-3 top-3 text-[#325099]/0 group-hover:text-[#325099] transition">→</span>
      </div>
    </Link>
  )
}

function EmptyState({ isAdmin, firstName }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
      <div className="text-4xl mb-3">🎓</div>
      <p className="text-sm font-semibold text-[#2A2035] mb-1">
        {isAdmin ? 'No classes on the schedule.' : 'No classes assigned to you yet.'}
      </p>
      <p className="text-xs text-[#2A2035]/60 max-w-md mx-auto">
        {isAdmin
          ? 'Add rows to the classes table (or sync from Airtable) and they\'ll appear here.'
          : `We look up your classes by your first name — make sure ${firstName ? `"${firstName}"` : 'your first name'} appears in the teacher column on each class row.`}
      </p>
    </div>
  )
}

// Summarise the teacher pay rate across all of a course's sections. Most
// courses will have a single rate, but a course running as two separate
// class rows could (in principle) carry different rates — surface that as a
// range instead of silently picking one.
function summariseRate(sections) {
  const rates = sections
    .map(s => s.rate)
    .filter(r => r != null && !Number.isNaN(Number(r)))
    .map(Number)
  if (rates.length === 0) return { label: null, range: false, min: null, max: null }
  const min = Math.min(...rates)
  const max = Math.max(...rates)
  const fmt = n => `$${Number.isInteger(n) ? n : n.toFixed(2)}`
  return min === max
    ? { label: fmt(min), range: false, min, max }
    : { label: `${fmt(min)}–${fmt(max)}`, range: true, min, max }
}

function CourseCard({ course, expanded, onToggle, showTeacher }) {
  const col = pickSubjectColor(course.displayName)
  const count = course.roster.length
  const rate = summariseRate(course.sections)

  return (
    <div className={`rounded-2xl border bg-white overflow-hidden transition ${
      expanded ? 'border-[#BACBFF] shadow-[0_8px_30px_-12px_rgba(50,80,153,0.18)]' : 'border-[#DEE7FF]'
    }`}>
      <button
        onClick={onToggle}
        className="w-full px-5 md:px-6 py-4 flex items-center gap-4 text-left hover:bg-[#F8FAFF] transition"
      >
        <div className="w-1.5 h-12 rounded-full shrink-0" style={{ background: col.fg }} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#2A2035] mb-1">{course.displayName}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#2A2035]/60">
            {course.sections.map((s, i) => (
              <span key={i}>
                {s.day ? DAY_SHORT[s.day] : '—'} {fmtTime(s.time)}
                {s.room ? ` · ${s.room}` : ''}
              </span>
            ))}
            {showTeacher && course.teachers.length > 0 && (
              <span>👤 {course.teachers.join(', ')}</span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0">
          <span className={`text-xs font-bold tabular-nums px-2.5 py-1 rounded-full ${
            count === 0 ? 'bg-[#F4F4F4] text-[#9CA3AF]' : 'bg-[#DEE7FF] text-[#062E63]'
          }`}>
            {count} student{count === 1 ? '' : 's'}
          </span>
          <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60 mt-1">
            {expanded ? 'Hide ↑' : 'Details ↓'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#DEE7FF] bg-[#FBFCFF] px-5 md:px-6 py-5 space-y-5">
          {/* ── Teacher pay rate ─────────────────────────────────────────
              Shows the rate(s) the assigned tutor is paid for this course.
              If the course has multiple sections at the same rate, it's one
              number. If sections carry different rates, we render a range
              up top + a per-section breakdown below. */}
          <div className="rounded-xl border border-[#DEE7FF] bg-white px-5 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                Teacher pay rate
              </p>
              {rate.label ? (
                <p className="text-2xl font-bold text-[#2A2035] font-display tabular-nums">
                  {rate.label}
                  <span className="text-sm font-medium text-[#2A2035]/50 ml-1">/ hr</span>
                </p>
              ) : (
                <>
                  <p className="text-base font-semibold text-[#2A2035]/50">Not set</p>
                  <p className="text-[11px] text-[#2A2035]/40 mt-0.5">
                    Add a value to <code className="font-mono bg-[#F4F4F4] px-1 rounded">classes.hourly_rate</code> in Supabase.
                  </p>
                </>
              )}
            </div>
            {rate.range && (
              <p className="text-[11px] text-[#2A2035]/60 text-right shrink-0">
                Varies across<br />
                {course.sections.length} sessions/wk
              </p>
            )}
          </div>

          {/* Per-section breakdown — only useful when rates differ */}
          {rate.range && (
            <div className="rounded-xl border border-[#DEE7FF] bg-white overflow-hidden">
              <ul className="divide-y divide-[#DEE7FF]">
                {course.sections.map((s, i) => (
                  <li key={i} className="px-4 py-2.5 flex items-center justify-between text-[12px]">
                    <span className="text-[#2A2035]">
                      {s.day ? DAY_SHORT[s.day] : '—'} · {fmtTime(s.time)}
                      {s.room ? ` · ${s.room}` : ''}
                    </span>
                    <span className="font-semibold text-[#062E63] tabular-nums">
                      {s.rate != null ? `$${Number.isInteger(Number(s.rate)) ? Number(s.rate) : Number(s.rate).toFixed(2)}/hr` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Roster */}
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-2 font-display">
              Students enrolled · {count}
            </p>
            {count === 0 ? (
              <p className="text-sm text-[#2A2035]/60 text-center py-4">
                No students linked to this class yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {course.roster.map((s, i) => (
                  <StudentChip key={s.id || i} s={s} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Weekly card view ──────────────────────────────────────────────────────
// One card per day. Each class is a soft subject-tinted block — no double
// borders, no nested header strip. Optimised for a glance.
// Compute the 1-based term week number for a given ISO date string.
function termWeekNumber(dateISO, term) {
  if (!term || !term.start_date) return null
  const termStart = new Date(`${term.start_date}T00:00:00`)
  const sessionDate = new Date(`${dateISO}T00:00:00`)
  const diff = sessionDate.getTime() - termStart.getTime()
  const week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1
  return week >= 1 ? week : null
}

function WeekCards({ weekDays, sessionsByDate, todayISO, showTeacher, rosters, currentTerm, classLabelMap }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
      {weekDays.map(d => {
        const iso = isoDate(d)
        const isToday = iso === todayISO
        const sessions = sessionsByDate.get(iso) || []
        return (
          <div
            key={iso}
            className={`rounded-2xl border p-3 flex flex-col min-h-[160px] transition ${
              isToday
                ? 'border-[#A7F3D0] bg-[#F0FDF4]/40'
                : 'border-[#DEE7FF] bg-white'
            }`}
          >
            {/* Day header — no background fill, no divider */}
            <div className="flex items-baseline justify-between px-1 mb-2.5">
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[10px] tracking-[0.25em] uppercase font-semibold ${isToday ? 'text-[#065F46]' : 'text-[#325099]/70'}`}>
                  {DAY_SHORT[dayNameOf(d)]}
                </span>
                <span className={`text-base font-bold tabular-nums font-display leading-none ${isToday ? 'text-[#065F46]' : 'text-[#2A2035]'}`}>
                  {d.getDate()}
                </span>
                <span className={`text-[10px] font-medium leading-none ${isToday ? 'text-[#065F46]/70' : 'text-[#2A2035]/35'}`}>
                  {MONTH_SHORT[d.getMonth()]}
                </span>
              </div>
              {isToday && (
                <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-[#065F46]">Today</span>
              )}
            </div>

            {/* Class list */}
            <div className="flex-1 space-y-1.5">
              {sessions.length === 0 ? (
                <div className="flex items-center justify-center h-full pb-3">
                  <span className="text-[#2A2035]/20 text-lg leading-none">·</span>
                </div>
              ) : (
                sessions.map(s => {
                  const col = pickSubjectColor(s.cls.class_name)
                  const count = (rosters?.[s.cls.id] || []).length
                  const wk = termWeekNumber(s.dateISO, currentTerm)
                  const href = wk
                    ? `/tutor/classes/${s.cls.id}?week=${wk}`
                    : `/tutor/classes/${s.cls.id}`
                  const isAmber  = s.isSub || s.hasSub
                  const isMakeup = s.isMakeup
                  const isDropin = s.isDropin
                  const pillBg     = isDropin ? '#CCFBF1CC' : isMakeup ? '#EDE9FECC' : isAmber ? '#FEF9ECCC' : col.bg + 'AA'
                  const pillBorder = isDropin ? '1px solid #5EEAD4' : isMakeup ? '1px solid #C4B5FD' : isAmber ? '1px solid #FDE68A' : 'none'
                  const textColor  = isDropin ? '#0F766E' : isMakeup ? '#5B21B6' : isAmber ? '#92400E' : col.fg
                  const subColor   = isDropin ? '#0F766E99' : isMakeup ? '#5B21B699' : isAmber ? '#92400E99' : col.fg + 'AA'
                  const pillHref = isDropin
                    ? '/tutor/dropin'
                    : isMakeup
                    ? `/tutor/classes/makeup/${s.lesson?.id}`
                    : href
                  return (
                    <Link
                      key={s.key}
                      href={pillHref}
                      className="block rounded-lg px-2.5 py-1.5 transition hover:shadow-[0_2px_10px_-4px_rgba(50,80,153,0.25)]"
                      style={{ background: pillBg, border: pillBorder }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 flex-wrap">
                            <p
                              className="text-[12px] font-bold truncate leading-tight"
                              style={{ color: textColor }}
                            >
                              {classLabelMap.get(s.cls.id) ?? s.cls.class_name}
                            </p>
                            {isAmber && (
                              <span className="text-[8px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[#F59E0B]/20 text-[#92400E] shrink-0 whitespace-nowrap">
                                {s.isSub ? 'Sub' : 'Sub covering'}
                              </span>
                            )}
                            {isMakeup && (
                              <span className="text-[8px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[#8B5CF6]/15 text-[#5B21B6] shrink-0 whitespace-nowrap">
                                Makeup
                              </span>
                            )}
                            {isDropin && (
                              <span className="text-[8px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[#CCFBF1] text-[#0F766E] shrink-0 whitespace-nowrap">
                                Drop-in
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] mt-0.5 leading-tight truncate" style={{ color: subColor }}>
                            {fmtTimeRange(s.cls.start_time, s.cls.end_time)}
                            {!isDropin && s.cls.room && <> · {s.cls.room}</>}
                            {isDropin && s.dropin?.tutors?.length > 0 && <> · {s.dropin.tutors.join(', ')}</>}
                          </p>
                          {showTeacher && s.cls.teacher && (
                            <p className="text-[10px] leading-tight truncate" style={{ color: textColor + '88' }}>
                              {s.cls.teacher}
                            </p>
                          )}
                        </div>
                        {count > 0 && (
                          <span
                            className="text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-white/70 shrink-0"
                            style={{ color: textColor }}
                          >
                            {count}
                          </span>
                        )}
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StudentChip({ s }) {
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-white px-3 py-2 flex items-center gap-2">
      <span className="w-7 h-7 rounded-full bg-[#062E63] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
        {(s.full_name || '?').slice(0, 1).toUpperCase()}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-[#2A2035] truncate">{s.full_name || 'Unknown'}</p>
        <p className="text-[10px] text-[#2A2035]/50 truncate">
          {s.school || '—'} · Y{s.year || '?'}
        </p>
      </div>
    </div>
  )
}

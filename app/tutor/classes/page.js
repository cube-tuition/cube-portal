'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import TutorNav from '../../../components/TutorNav'
import { normalizeDays } from '../../../lib/format'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../lib/terms'
import { inferSubject } from '../../../components/CourseDetail'

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

// classes.start_time is TEXT like "4:00", "11:30", "6:30". Centre runs
// 9am–9pm so single-digit hours (1–7) are PM.
function startMinutes(t) {
  if (!t) return 99999
  const [hRaw, mRaw] = String(t).split(':')
  let h = parseInt(hRaw, 10)
  const m = parseInt(mRaw || '0', 10) || 0
  if (Number.isNaN(h)) return 99999
  if (h >= 1 && h <= 7) h += 12
  return h * 60 + m
}
function fmtTime(t) {
  if (!t) return ''
  const [hRaw, mRaw] = String(t).split(':')
  let h = parseInt(hRaw, 10)
  const m = (mRaw || '00').padStart(2, '0')
  if (Number.isNaN(h)) return t
  const ampm = (h >= 1 && h <= 7) ? 'pm' : (h >= 8 && h <= 11) ? 'am' : (h === 12 ? 'pm' : 'am')
  return `${h}:${m}${ampm}`
}

// "4:30–6pm" / "10–11:30am" — compact form for the weekly cards. Drops
// trailing ":00" minutes, and drops the start's am/pm when it matches the
// end's. Falls back to fmtTime if parsing fails.
function fmtTimeRange(start, end) {
  const parse = (t) => {
    if (!t) return null
    const [hRaw, mRaw] = String(t).split(':')
    let h = parseInt(hRaw, 10)
    const m = parseInt(mRaw || '0', 10) || 0
    if (Number.isNaN(h)) return null
    if (h >= 1 && h <= 7) h += 12        // legacy "1-7 = PM" rule
    return { h, m }
  }
  const s = parse(start)
  let e = parse(end)
  if (!s || !e) return [fmtTime(start), fmtTime(end)].filter(Boolean).join('–')
  if (e.h < s.h || (e.h === s.h && e.m < s.m)) e = { ...e, h: e.h + 12 }   // PM crossover

  const piece = ({ h, m }, withAmPm) => {
    const ampm = h >= 12 && h !== 24 ? 'pm' : 'am'
    const hr = h === 0 ? 12 : (h > 12 ? h - 12 : h)
    const mm = m === 0 ? '' : `:${String(m).padStart(2, '0')}`
    return `${hr}${mm}${withAmPm ? ampm : ''}`
  }
  const sameAmPm = (s.h >= 12) === (e.h >= 12)
  return `${piece(s, !sameAmPm)}–${piece(e, true)}`
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
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtDateLabel(d) {
  return `${DAY_SHORT[dayNameOf(d)]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
}

// Returns "W6" given a weekStart date and the current term (which has start_date).
// Falls back to null if the term is unknown or the week is outside the term.
function termWeekLabel(weekStart, term) {
  if (!term || !term.start_date) return null
  const termStart = mondayOf(new Date(`${term.start_date}T00:00:00`))
  const diffMs = weekStart.getTime() - termStart.getTime()
  const weekNum = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1
  if (weekNum < 1) return null
  return `W${weekNum}`
}

export default function TutorClassesPage() {
  const [staff, setStaff] = useState(null)
  const [currentTerm, setCurrentTerm] = useState(null)
  const [classes, setClasses] = useState([])
  const [rosters, setRosters] = useState({}) // { [class_id]: [{ id, full_name, school, school_year }] }
  const [authErr, setAuthErr] = useState(null)
  const [expandedCourse, setExpandedCourse] = useState(null)   // course key (lowercased name)
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile } = await supabase
        .from('students')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!profile) { setAuthErr('No profile found.'); return }
      if (profile.role !== 'tutor' && profile.role !== 'admin') {
        router.push('/dashboard')
        return
      }
      setStaff(profile)

      const terms = await fetchAllTerms()
      setCurrentTerm(getCurrentTerm(terms))

      const isAdmin = profile.role === 'admin'
      const firstName = (profile.full_name || '').split(' ')[0]

      // Hide archived classes (Airtable sweep marks them with archived_at).
      let q = supabase.from('classes').select('*').is('archived_at', null)
      if (!isAdmin && firstName) q = q.ilike('teacher', firstName)
      const { data: cls } = await q

      // Hide untitled rows — these are typically incomplete Airtable rows and
      // were the main source of noise on the old day-by-day view. If a row
      // genuinely needs to appear here, give it a class_name in Airtable.
      const named = (cls || []).filter(c => (c.class_name || '').trim())
      setClasses(named)

      const classIds = named.map(c => c.id)
      if (classIds.length > 0) {
        const { data: links } = await supabase
          .from('student_classes')
          .select('class_id, students (id, full_name, school, school_year)')
          .in('class_id', classIds)
        const grouped = {}
        for (const link of links || []) {
          if (!link.students) continue
          if (!grouped[link.class_id]) grouped[link.class_id] = []
          grouped[link.class_id].push(link.students)
        }
        setRosters(grouped)
      }
    }
    load()
  }, [])

  // ── Top section: distinct courses by class_name ────────────────────────
  // We merge multiple DB rows that share a name (e.g. a course that runs on
  // Tue AND Thu shows once) and union the rosters (deduping students).
  const courses = useMemo(() => {
    const map = new Map()
    for (const c of classes) {
      const key = c.class_name.trim().toLowerCase()
      if (!map.has(key)) {
        map.set(key, { key, displayName: c.class_name.trim(), rows: [] })
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
    for (const d of weekDays) {
      const dn = dayNameOf(d)
      for (const c of classes) {
        const days = normalizeDays(c.day_of_week)
        if (!days.includes(dn)) continue
        out.push({
          key: `${c.id}-${isoDate(d)}`,
          date: d,
          dateISO: isoDate(d),
          dayName: dn,
          cls: c,
        })
      }
    }
    out.sort((a, b) => {
      if (a.date.getTime() !== b.date.getTime()) return a.date - b.date
      return startMinutes(a.cls.start_time) - startMinutes(b.cls.start_time)
    })
    return out
  }, [classes, weekDays])

  const sessionsByDate = useMemo(() => {
    const map = new Map()
    for (const s of upcomingSessions) {
      if (!map.has(s.dateISO)) map.set(s.dateISO, [])
      map.get(s.dateISO).push(s)
    }
    return map
  }, [upcomingSessions])

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
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">
              {isAdmin ? 'All classes · Admin view' : 'My classes · Tutor view'}
            </p>
            {currentTerm && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#325099]" />
                {formatTermLabel(currentTerm)}
              </span>
            )}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Your classes
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            What you're teaching this term, and what's coming up over the next week.
          </p>

          <div className="mt-8 max-w-xs">
            <StatTile label="This term" value={courses.length} suffix={`class${courses.length === 1 ? '' : 'es'}`} />
          </div>
        </div>
      </section>

      {/* SECTION 1 — Classes grouped by Year → Subject */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 pt-10">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
              This term
            </p>
            <h2 className="text-lg font-semibold text-[#2A2035] font-display">
              {isAdmin ? 'All classes' : 'Classes you teach'}
            </h2>
          </div>
          <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
            {classes.length} class{classes.length === 1 ? '' : 'es'}
          </span>
        </div>

        {classes.length === 0 ? (
          <EmptyState isAdmin={isAdmin} firstName={firstName} />
        ) : (
          <YearSubjectGrid classes={classes} rosters={rosters} showTeacher={isAdmin} />
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
              {termWeekLabel(weekStart, currentTerm) ?? `${fmtDateLabel(weekDays[0])} – ${fmtDateLabel(weekDays[6])}`}
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
            <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60 ml-2">
              {upcomingSessions.length} session{upcomingSessions.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {upcomingSessions.length === 0 ? (
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

// Flat 4-col grid, sorted by Year ascending then Subject A→Z.
// No section headers — the hierarchy is conveyed by the sort order plus the
// subject pill on each card. Year band sits on the card as a small chip.
function YearSubjectGrid({ classes, rosters, showTeacher }) {
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
function ClassTile({ cls, rosterCount, showTeacher }) {
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
            {cls.class_name}
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

function WeekCards({ weekDays, sessionsByDate, todayISO, showTeacher, rosters, currentTerm }) {
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
                  return (
                    <Link
                      key={s.key}
                      href={href}
                      className="block rounded-lg px-2.5 py-1.5 transition hover:shadow-[0_2px_10px_-4px_rgba(50,80,153,0.25)]"
                      style={{ background: col.bg + 'AA' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-[12px] font-bold truncate leading-tight"
                            style={{ color: col.fg }}
                          >
                            {s.cls.class_name}
                          </p>
                          <p className="text-[10px] mt-0.5 leading-tight truncate" style={{ color: col.fg + 'AA' }}>
                            {fmtTimeRange(s.cls.start_time, s.cls.end_time)}
                            {s.cls.room && <> · {s.cls.room}</>}
                          </p>
                          {showTeacher && s.cls.teacher && (
                            <p className="text-[10px] leading-tight truncate" style={{ color: col.fg + '88' }}>
                              {s.cls.teacher}
                            </p>
                          )}
                        </div>
                        {count > 0 && (
                          <span
                            className="text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-white/70 shrink-0"
                            style={{ color: col.fg }}
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
          {s.school || '—'} · Y{s.school_year || '?'}
        </p>
      </div>
    </div>
  )
}

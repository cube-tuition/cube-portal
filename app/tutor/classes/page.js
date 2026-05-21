'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import TutorNav from '../../../components/TutorNav'
import { normalizeDays } from '../../../lib/format'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../lib/terms'

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

export default function TutorClassesPage() {
  const [staff, setStaff] = useState(null)
  const [currentTerm, setCurrentTerm] = useState(null)
  const [classes, setClasses] = useState([])
  const [rosters, setRosters] = useState({}) // { [class_id]: [{ id, full_name, school, school_year }] }
  const [authErr, setAuthErr] = useState(null)
  const [expandedCourse, setExpandedCourse] = useState(null)   // course key (lowercased name)
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

      let q = supabase.from('classes').select('*')
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
          if (days.length === 0) {
            sections.push({ classId: row.id, day: '', time: row.start_time, end: row.end_time, room: row.room, teacher: row.teacher })
          } else {
            for (const d of days) {
              sections.push({ classId: row.id, day: d, time: row.start_time, end: row.end_time, room: row.room, teacher: row.teacher })
            }
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

  // ── Bottom section: explode classes into session occurrences in the next
  // 7 days (today inclusive). One entry per (class × matching weekday).
  const upcomingSessions = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const windowDays = Array.from({ length: 7 }, (_, i) => addDays(today, i))
    const out = []
    for (const d of windowDays) {
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
  }, [classes])

  // Bucket the upcoming sessions by date for the date-grouped layout
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

          <div className="grid grid-cols-3 gap-3 mt-8 max-w-2xl">
            <StatTile label="This term"   value={courses.length}          suffix={`class${courses.length === 1 ? '' : 'es'}`} />
            <StatTile label="Next 7 days" value={upcomingSessions.length} suffix={`session${upcomingSessions.length === 1 ? '' : 's'}`} />
            <StatTile label="Students"    value={totalStudents}           suffix="enrolled" />
          </div>
        </div>
      </section>

      {/* SECTION 1 — Classes you teach this term */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 pt-10">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
              This term
            </p>
            <h2 className="text-lg font-semibold text-[#2A2035] font-display">
              Classes you teach
            </h2>
          </div>
          <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
            {courses.length} course{courses.length === 1 ? '' : 's'}
          </span>
        </div>

        {courses.length === 0 ? (
          <EmptyState isAdmin={isAdmin} firstName={firstName} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {courses.map(course => (
              <CourseCard
                key={course.key}
                course={course}
                expanded={expandedCourse === course.key}
                onToggle={() => setExpandedCourse(expandedCourse === course.key ? null : course.key)}
                showTeacher={isAdmin}
              />
            ))}
          </div>
        )}
      </section>

      {/* SECTION 2 — Next 7 days */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
              Next 7 days
            </p>
            <h2 className="text-lg font-semibold text-[#2A2035] font-display">
              Upcoming classes
            </h2>
          </div>
          <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
            {upcomingSessions.length} session{upcomingSessions.length === 1 ? '' : 's'}
          </span>
        </div>

        {upcomingSessions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-4xl mb-3">🌤️</div>
            <p className="text-sm font-semibold text-[#2A2035] mb-1">Nothing on for the next week.</p>
            <p className="text-xs text-[#2A2035]/60 max-w-md mx-auto">
              Once your classes have a day_of_week set in Supabase, the next 7 days of sessions will land here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {[...sessionsByDate.entries()].map(([dateISO, sessions]) => {
              const d = sessions[0].date
              const isToday = dateISO === todayISO
              return (
                <div key={dateISO}>
                  <div className="flex items-baseline gap-2 mb-3">
                    <h3 className="text-base font-semibold text-[#2A2035] font-display">
                      {fmtDateLabel(d)}
                    </h3>
                    {isToday && (
                      <span className="text-[10px] font-bold tracking-widest uppercase text-[#065F46] bg-[#D1FAE5] px-2 py-0.5 rounded-full">
                        Today
                      </span>
                    )}
                    <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
                      {sessions.length} class{sessions.length === 1 ? '' : 'es'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {sessions.map(s => (
                      <SessionCard
                        key={s.key}
                        session={s}
                        roster={rosters[s.cls.id] || []}
                        isToday={isToday}
                        showTeacher={isAdmin}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
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

function CourseCard({ course, expanded, onToggle, showTeacher }) {
  const col = pickSubjectColor(course.displayName)
  const count = course.roster.length

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
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-1">
            <p className="text-sm font-semibold text-[#2A2035]">{course.displayName}</p>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: col.bg, color: col.fg }}
            >
              {course.sections.length} session{course.sections.length === 1 ? '' : 's'}/wk
            </span>
          </div>
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
            {expanded ? 'Hide ↑' : 'Roster ↓'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#DEE7FF] bg-[#FBFCFF] px-5 md:px-6 py-5">
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
      )}
    </div>
  )
}

function SessionCard({ session, roster, isToday, showTeacher }) {
  const c = session.cls
  const col = pickSubjectColor(c.class_name)
  const count = roster.length

  return (
    <Link
      href={`/tutor/classes/${c.id}/${session.dateISO}`}
      className={`group block rounded-2xl border bg-white overflow-hidden transition hover:border-[#BACBFF] hover:bg-[#F8FAFF] ${
        isToday ? 'border-[#A7F3D0]' : 'border-[#DEE7FF]'
      }`}
    >
      <div className="w-full px-5 md:px-6 py-4 flex items-center gap-4 text-left">
        <div className="w-1.5 h-10 rounded-full shrink-0" style={{ background: col.fg }} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#2A2035] mb-0.5">{c.class_name}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#2A2035]/60">
            <span>🕐 {fmtTime(c.start_time)}–{fmtTime(c.end_time)}</span>
            {c.room && <span>📍 {c.room}</span>}
            {showTeacher && c.teacher && <span>👤 {c.teacher}</span>}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-xs font-bold tabular-nums px-2.5 py-1 rounded-full ${
            count === 0 ? 'bg-[#F4F4F4] text-[#9CA3AF]' : 'bg-[#DEE7FF] text-[#062E63]'
          }`}>
            {count} student{count === 1 ? '' : 's'}
          </span>
          <span className="text-[#325099] transition-transform group-hover:translate-x-0.5">→</span>
        </div>
      </div>
    </Link>
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

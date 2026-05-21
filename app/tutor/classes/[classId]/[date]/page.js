'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import TutorNav from '../../../../../components/TutorNav'
import { normalizeDays } from '../../../../../lib/format'

/*
 * Session detail page (Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * /tutor/classes/[classId]/[date]
 *
 * Full page view for a single class occurrence (one class × one specific
 * date). Linked from the "Next 7 days" section on /tutor/classes.
 *
 * Currently shows: class metadata, the roster, and a back link. This is the
 * surface where attendance marking, lesson topic notes, etc. will live in a
 * later phase — sectioned placeholders are kept lightweight for now.
 *
 * Auth: same gate as the list view (tutor or admin only). Tutors can only
 * open sessions for their own classes; we soft-block if the class.teacher
 * first-name doesn't match.
 */

const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const DAY_SHORT = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat', Sunday:'Sun' }
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December']

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

function fmtTime(t) {
  if (!t) return ''
  const [hRaw, mRaw] = String(t).split(':')
  let h = parseInt(hRaw, 10)
  const m = (mRaw || '00').padStart(2, '0')
  if (Number.isNaN(h)) return t
  const ampm = (h >= 1 && h <= 7) ? 'pm' : (h >= 8 && h <= 11) ? 'am' : (h === 12 ? 'pm' : 'am')
  return `${h}:${m}${ampm}`
}

function isoToDate(iso) {
  // YYYY-MM-DD → local Date at midnight (no UTC drift)
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function dayNameOf(d) {
  return DAY_ORDER[(d.getDay() + 6) % 7]
}
function fmtDateFull(d) {
  return `${dayNameOf(d)} ${d.getDate()} ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`
}

export default function SessionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const classId = params?.classId
  const dateISO = params?.date

  const [staff, setStaff] = useState(null)
  const [cls, setCls] = useState(null)
  const [roster, setRoster] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  // Per-student marks for this session. Local-only for now — not persisted.
  // Shape: { [studentId]: { attendance, hw, rq, comment } }
  const [marks, setMarks] = useState({})
  // Session-level notes. Editability is gated by role at the textarea:
  //   notesFromCube → admin writes, tutor reads
  //   notesToCube   → tutor writes, admin reads
  const [notesFromCube, setNotesFromCube] = useState('')
  const [notesToCube,   setNotesToCube]   = useState('')

  // Parse + validate the date param up front so a malformed URL fails clean.
  const date = useMemo(() => isoToDate(String(dateISO || '')), [dateISO])
  const dateLooksValid = !!date && !Number.isNaN(date.getTime())

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile } = await supabase
        .from('students')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!profile) { setError('No profile found.'); setLoading(false); return }
      if (profile.role !== 'tutor' && profile.role !== 'admin') {
        router.push('/dashboard')
        return
      }
      setStaff(profile)

      if (!classId) { setError('Missing class id in URL.'); setLoading(false); return }
      if (!dateLooksValid) { setError('Invalid date in URL.'); setLoading(false); return }

      // Load the class row by id. Tutors can only see classes assigned to
      // them (by first-name match on classes.teacher); admins see everything.
      const { data: row, error: clsErr } = await supabase
        .from('classes')
        .select('*')
        .eq('id', classId)
        .single()

      if (clsErr || !row) {
        setError('Class not found.')
        setLoading(false)
        return
      }

      const isAdmin = profile.role === 'admin'
      const firstName = (profile.full_name || '').split(' ')[0].toLowerCase()
      const teacherFirst = (row.teacher || '').split(' ')[0].toLowerCase()
      if (!isAdmin && firstName && teacherFirst && firstName !== teacherFirst) {
        setError("This class isn't assigned to you.")
        setLoading(false)
        return
      }
      setCls(row)

      // Sanity check: does this class actually run on the requested weekday?
      // It's not fatal — a deep-link or schedule change could legitimately
      // land here — but we surface it as a soft warning in the meta strip.
      // (We just keep the class loaded; the warning is computed at render.)

      // Roster
      const { data: links } = await supabase
        .from('student_classes')
        .select('students (id, full_name, school, school_year)')
        .eq('class_id', classId)
      const students = (links || [])
        .map(l => l.students)
        .filter(Boolean)
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
      setRoster(students)
      setLoading(false)
    }
    load()
  }, [classId, dateISO, dateLooksValid])

  const isToday = dateLooksValid && isoDate(date) === isoDate(new Date())
  const dayMismatch = useMemo(() => {
    if (!cls || !dateLooksValid) return false
    const days = normalizeDays(cls.day_of_week)
    if (days.length === 0) return false
    return !days.includes(dayNameOf(date))
  }, [cls, date, dateLooksValid])

  // Loading / error frames
  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-20 text-center">
          <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">
            Loading session…
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white">
        <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />
        <div className="max-w-3xl mx-auto px-6 md:px-10 py-16">
          <Link
            href="/tutor/classes"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#325099] hover:text-[#062E63] mb-6"
          >
            ← Back to classes
          </Link>
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-4xl mb-3">🤔</div>
            <p className="text-sm font-semibold text-[#2A2035] mb-1">{error}</p>
            <p className="text-xs text-[#2A2035]/60">
              Head back to the classes list and try again.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const col = pickSubjectColor(cls.class_name || '')
  const isAdmin = staff?.role === 'admin'

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff?.full_name} isAdmin={isAdmin} />

      {/* HERO */}
      <section
        className="border-b border-[#DEE7FF]"
        style={{ background: `linear-gradient(135deg, ${col.bg} 0%, #EEF4FF 60%, #BFD1FF 100%)` }}
      >
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 md:py-14">
          <Link
            href="/tutor/classes"
            className="inline-flex items-center gap-1 text-[11px] tracking-[0.25em] uppercase font-semibold text-[#325099] hover:text-[#062E63] mb-5 transition"
          >
            ← Back to classes
          </Link>

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <p className="text-[11px] tracking-[0.35em] uppercase font-semibold font-display" style={{ color: col.fg }}>
              {fmtDateFull(date)}
            </p>
            {isToday && (
              <span className="text-[10px] font-bold tracking-widest uppercase text-[#065F46] bg-[#D1FAE5] px-2 py-0.5 rounded-full">
                Today
              </span>
            )}
            {dayMismatch && (
              <span
                className="text-[10px] font-bold tracking-widest uppercase text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 rounded-full"
                title={`This class normally runs on ${normalizeDays(cls.day_of_week).join(', ')}`}
              >
                Off-day
              </span>
            )}
          </div>

          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            {cls.class_name || 'Untitled class'}
          </h1>

          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            {fmtTime(cls.start_time)}–{fmtTime(cls.end_time)}
            {cls.room && <> · 📍 {cls.room}</>}
            {cls.teacher && <> · 👤 {cls.teacher}</>}
          </p>

          {/* Meta strip — Time gets double width so the range fits on one line */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8 max-w-3xl">
            <HeroTile label="Date" value={`${DAY_SHORT[dayNameOf(date)]} ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`} />
            <HeroTile
              label="Time"
              value={`${fmtTime(cls.start_time)}–${fmtTime(cls.end_time)}`}
              className="col-span-2 md:col-span-2"
            />
            <HeroTile label="Room" value={cls.room || '—'} />
          </div>
        </div>
      </section>

      {/* MARK THIS SESSION */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
              Mark this session
            </p>
            <h2 className="text-lg font-semibold text-[#2A2035] font-display">
              Students
            </h2>
          </div>
          <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
            {roster.length} student{roster.length === 1 ? '' : 's'}
          </span>
        </div>

        {roster.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-4xl mb-3">🪑</div>
            <p className="text-sm font-semibold text-[#2A2035] mb-1">No students linked to this class yet.</p>
            <p className="text-xs text-[#2A2035]/60 max-w-md mx-auto">
              Once students are enrolled in the classes table, they'll appear on this roster.
            </p>
          </div>
        ) : (
          <MarkTable
            roster={roster}
            marks={marks}
            onChange={(studentId, field, value) =>
              setMarks(prev => ({
                ...prev,
                [studentId]: { ...(prev[studentId] || {}), [field]: value },
              }))
            }
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

function HeroTile({ label, value, className = '' }) {
  return (
    <div className={`bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4 ${className}`}>
      <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">{label}</p>
      <p className="text-xl md:text-2xl font-bold text-[#2A2035] font-display tabular-nums whitespace-nowrap">
        {value}
      </p>
    </div>
  )
}

// ── Mark-this-session table ────────────────────────────────────────────────
// Local-only UI for now — values live in `marks` state on the parent, no
// Supabase writes. The look is intended to match the existing portal: the
// soft #F8FAFF table header, the #325099 uppercase column labels, and the
// A/B/C/D/E pill colors lifted straight from CourseDetail.js so the visual
// language stays consistent across student and tutor surfaces.

const ATTENDANCE_OPTIONS = [
  { value: '',         label: '—',       bg: '#ffffff', fg: '#9CA3AF' },
  { value: 'present',  label: 'Present', bg: '#D1FAE5', fg: '#065F46' },
  { value: 'late',     label: 'Late',    bg: '#FEF3C7', fg: '#92400E' },
  { value: 'absent',   label: 'Absent',  bg: '#FEE2E2', fg: '#991B1B' },
]
const GRADE_OPTIONS = [
  { value: '',  label: '—', bg: '#ffffff', fg: '#9CA3AF' },
  { value: 'A', label: 'A', bg: '#D1FAE5', fg: '#065F46' },
  { value: 'B', label: 'B', bg: '#DEE7FF', fg: '#062E63' },
  { value: 'C', label: 'C', bg: '#FEF3C7', fg: '#92400E' },
  { value: 'D', label: 'D', bg: '#FFEDD5', fg: '#9A3412' },
  { value: 'E', label: 'E', bg: '#FEE2E2', fg: '#991B1B' },
]

// Row tint follows the attendance status — quiet enough not to fight the
// rest of the table but loud enough that a glance tells you who's marked.
function rowTint(attendance) {
  if (attendance === 'present') return '#F0FDF4'
  if (attendance === 'late')    return '#FFFBEB'
  if (attendance === 'absent')  return '#FEF2F2'
  return ''
}

function MarkTable({ roster, marks, onChange }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
              <Th className="text-left pl-5 pr-3 w-[26%]">Student name</Th>
              <Th className="text-center px-3 w-[14%]">Attendance</Th>
              <Th className="text-center px-3 w-[14%]">HW completion</Th>
              <Th className="text-center px-3 w-[14%]">RQ mark %</Th>
              <Th className="text-left px-5 bg-[#EEF4FF] text-[#062E63]">Additional comments</Th>
            </tr>
          </thead>
          <tbody>
            {roster.map(s => {
              const m = marks[s.id] || {}
              const tint = rowTint(m.attendance)
              return (
                <tr
                  key={s.id}
                  className="border-b last:border-0 border-[#DEE7FF] transition-colors"
                  style={tint ? { background: tint } : undefined}
                >
                  <td className="pl-5 pr-3 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-full bg-[#062E63] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                        {(s.full_name || '?').slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#2A2035] truncate leading-tight">
                          {s.full_name || 'Unknown'}
                        </p>
                        <p className="text-[10px] text-[#2A2035]/50 truncate">
                          {s.school || '—'} · Y{s.school_year || '?'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <PillSelect
                      value={m.attendance || ''}
                      options={ATTENDANCE_OPTIONS}
                      onChange={v => onChange(s.id, 'attendance', v)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <PillSelect
                      value={m.hw || ''}
                      options={GRADE_OPTIONS}
                      onChange={v => onChange(s.id, 'hw', v)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <NumberPill
                      value={m.rq || ''}
                      min={1}
                      max={100}
                      onChange={v => onChange(s.id, 'rq', v)}
                    />
                  </td>
                  <td className="px-5 py-3 bg-[#F5F8FF]/60">
                    <input
                      type="text"
                      value={m.comment || ''}
                      onChange={e => onChange(s.id, 'comment', e.target.value)}
                      placeholder="Notes about this lesson…"
                      className="w-full bg-white border border-[#DEE7FF] rounded-lg px-3 py-1.5 text-xs text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer affordance — not wired up yet */}
      <div className="px-5 py-3 bg-[#F8FAFF] border-t border-[#DEE7FF] flex items-center justify-between">
        <p className="text-[11px] text-[#2A2035]/50">
          Changes live on this page only — saving isn't wired up yet.
        </p>
        <button
          type="button"
          disabled
          className="text-xs font-semibold bg-[#325099] text-white px-4 py-2 rounded-full opacity-50 cursor-not-allowed"
          title="Phase 4 — not wired up yet"
        >
          Save session
        </button>
      </div>
    </div>
  )
}

function Th({ children, className = '' }) {
  return (
    <th className={`py-3 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] ${className}`}>
      {children}
    </th>
  )
}

// Native <select> styled to look like a colored pill that reflects the
// chosen value. Native chevron is kept (cross-browser, accessible) — we just
// pad on the right to make room for it.
function PillSelect({ value, options, onChange }) {
  const opt = options.find(o => o.value === value) || options[0]
  const isEmpty = !value
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full text-xs font-semibold rounded-full border px-2.5 py-1.5 pr-6 cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-[#325099]/30 text-center"
      style={{
        background: opt.bg,
        color: opt.fg,
        borderColor: isEmpty ? '#DEE7FF' : opt.fg + '40',
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// Number input styled like PillSelect — pill shape, color-tiered by score
// so the visual language matches the A–E columns at a glance.
//   80–100 → green   (A band)
//   70–79  → blue    (B band)
//   60–69  → yellow  (C band)
//   50–59  → orange  (D band)
//   <50    → red     (E band)
// Empty = neutral white. Clamps to [min, max] on change so a stray 999 can't
// land in state.
function numberTier(n) {
  if (n >= 80) return { bg: '#D1FAE5', fg: '#065F46' }
  if (n >= 70) return { bg: '#DEE7FF', fg: '#062E63' }
  if (n >= 60) return { bg: '#FEF3C7', fg: '#92400E' }
  if (n >= 50) return { bg: '#FFEDD5', fg: '#9A3412' }
  return            { bg: '#FEE2E2', fg: '#991B1B' }
}
function NumberPill({ value, min = 1, max = 100, onChange }) {
  const isEmpty = value === '' || value === null || value === undefined
  const n = isEmpty ? null : Number(value)
  const valid = n !== null && !Number.isNaN(n)
  const tier = valid ? numberTier(n) : { bg: '#ffffff', fg: '#9CA3AF' }
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={isEmpty ? '' : String(value)}
      placeholder="—"
      onChange={e => {
        const raw = e.target.value
        if (raw === '') { onChange(''); return }
        const num = Number(raw)
        if (Number.isNaN(num)) return
        const clamped = Math.max(min, Math.min(max, Math.floor(num)))
        onChange(String(clamped))
      }}
      className="w-full text-xs font-semibold rounded-full border px-2 py-1.5 text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-[#325099]/30 transition"
      style={{
        background: tier.bg,
        color: tier.fg,
        borderColor: valid ? tier.fg + '40' : '#DEE7FF',
      }}
    />
  )
}

'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import SessionMarker from '../../../../../components/SessionMarker'
import WeekBooklet from '../../../../../components/WeekBooklet'
import { normalizeDays } from '../../../../../lib/format'
import { fetchAllTerms, getCurrentTerm } from '../../../../../lib/terms'
import { T_CLASSES, T_SUB_ASSIGNMENTS, T_TUTORS } from '../../../../../lib/tables'

/*
 * Single-session standalone page — /tutor/classes/[classId]/[date]
 *
 * Auth + class fetch happens here. The marking UI lives in
 * <SessionMarker> which is shared with /tutor/classes/[classId] (where it
 * gets rendered once per session date inside week tabs).
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
  const [y, m, d] = (iso || '').split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function dayNameOf(d) { return DAY_ORDER[(d.getDay() + 6) % 7] }
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
  const [term, setTerm] = useState(null)
  const [bookletWeek, setBookletWeek] = useState(null)
  const [subAssignment, setSubAssignment] = useState(null) // { sub_tutor_id, sub_name } | null
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const date = useMemo(() => isoToDate(String(dateISO || '')), [dateISO])
  const dateLooksValid = !!date && !Number.isNaN(date.getTime())

  useEffect(() => {
    (async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile) { setError('No profile found.'); setLoading(false); return }
      if (profile.role !== 'tutor' && profile.role !== 'admin') {
        router.push('/dashboard'); return
      }
      setStaff(profile)

      if (!classId) { setError('Missing class id in URL.'); setLoading(false); return }
      if (!dateLooksValid) { setError('Invalid date in URL.'); setLoading(false); return }

      const { data: row, error: clsErr } = await supabase
        .from(T_CLASSES).select('*').eq('id', classId).single()
      if (clsErr || !row) { setError('Class not found.'); setLoading(false); return }

      const isAdmin = profile.role === 'admin'
      const firstName = (profile.full_name || '').split(' ')[0].toLowerCase()
      const teacherFirst = (row.teacher || '').split(' ')[0].toLowerCase()
      const isRegularTeacher = isAdmin || (firstName && teacherFirst && firstName === teacherFirst)

      // Check for a sub assignment on this specific date
      const { data: subRow } = await supabase
        .from(T_SUB_ASSIGNMENTS)
        .select('id, sub_tutor_id')
        .eq('class_id', classId)
        .eq('session_date', dateISO)
        .maybeSingle()

      if (!isRegularTeacher) {
        // Must be the assigned sub to access this session
        if (!subRow || subRow.sub_tutor_id !== profile.id) {
          setError("This session isn't assigned to you.")
          setLoading(false); return
        }
      }

      if (subRow) {
        // Resolve sub's name for the banner
        const { data: subProfile } = await supabase
          .from(T_TUTORS).select('full_name').eq('id', subRow.sub_tutor_id).single()
        setSubAssignment({ sub_tutor_id: subRow.sub_tutor_id, sub_name: subProfile?.full_name || 'Sub teacher' })
      }

      setCls(row)

      // Resolve term + week so we can render the booklet above the marker
      const terms = await fetchAllTerms()
      const containing = (terms || []).find(t =>
        dateISO >= t.start_date && dateISO <= t.end_date
      ) || getCurrentTerm(terms)
      setTerm(containing)
      if (containing && date) {
        const start = isoToDate(containing.start_date)
        const end   = isoToDate(containing.end_date)
        if (start && end && date >= start && date <= end) {
          const ms = date.getTime() - start.getTime()
          setBookletWeek(Math.floor(ms / (1000 * 60 * 60 * 24 * 7)) + 1)
        } else {
          setBookletWeek(null)
        }
      }

      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, dateISO, dateLooksValid])

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

  if (error || !cls) {
    return (
      <div className="min-h-screen bg-white">
        <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />
        <div className="max-w-3xl mx-auto px-6 md:px-10 py-16">
          <Link href="/tutor/classes" className="inline-flex items-center gap-1 text-xs font-semibold text-[#325099] hover:text-[#062E63] mb-6">
            ← Back to classes
          </Link>
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-4xl mb-3">🤔</div>
            <p className="text-sm font-semibold text-[#2A2035] mb-1">{error || 'Class not found.'}</p>
            <p className="text-xs text-[#2A2035]/60">Head back to the classes list and try again.</p>
          </div>
        </div>
      </div>
    )
  }

  const col = pickSubjectColor(cls.class_name || '')
  const isAdmin = staff?.role === 'admin'
  const isToday = dateLooksValid && isoDate(date) === isoDate(new Date())
  const days = normalizeDays(cls.day_of_week)
  const dayMismatch = days.length > 0 && !days.includes(dayNameOf(date))

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
            href={`/tutor/classes/${cls.id}`}
            className="inline-flex items-center gap-1 text-[11px] tracking-[0.25em] uppercase font-semibold text-[#325099] hover:text-[#062E63] mb-5 transition"
          >
            ← Back to class
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
              <span className="text-[10px] font-bold tracking-widest uppercase text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 rounded-full">
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8 max-w-3xl">
            <HeroTile label="Date" value={`${DAY_SHORT[dayNameOf(date)]} ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`} />
            <HeroTile label="Time" value={`${fmtTime(cls.start_time)}–${fmtTime(cls.end_time)}`} className="col-span-2 md:col-span-2" />
            <HeroTile label="Room" value={cls.room || '—'} />
          </div>
        </div>
      </section>

      {/* Sub assignment banner */}
      {subAssignment && (
        <div className="max-w-7xl mx-auto px-6 md:px-10 pt-6">
          {subAssignment.sub_tutor_id === staff?.id ? (
            // This viewer IS the sub — full access, confirm banner
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE]">
              <span className="text-lg">🔄</span>
              <p className="text-sm font-semibold text-[#1E40AF]">
                You're covering this session as a substitute teacher. Your shift will be recorded for payroll.
              </p>
            </div>
          ) : (
            // Regular teacher viewing a subbed session — read-only notice
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A]">
              <span className="text-lg">🔄</span>
              <p className="text-sm font-semibold text-[#92400E]">
                {subAssignment.sub_name} is covering this session. You can view it but marking is handled by the sub.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Booklet for this week + SessionMarker below. */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10 space-y-8">
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                Workbook
              </p>
              <h2 className="text-lg font-semibold text-[#2A2035] font-display">
                {bookletWeek != null ? `Week ${bookletWeek}` : 'This Lesson'}
              </h2>
            </div>
            {term && (
              <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
                {term.name || `Term ${term.term_number}`}
              </span>
            )}
          </div>
          <WeekBooklet cls={cls} term={term} week={bookletWeek} isAdmin={isAdmin} />
        </div>
        <SessionMarker
          classId={classId}
          dateISO={dateISO}
          cls={cls}
          staff={staff}
          readOnly={!isAdmin && !!subAssignment && staff?.id !== subAssignment?.sub_tutor_id}
        />
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

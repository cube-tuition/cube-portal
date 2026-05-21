'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import TutorNav from '../../../components/TutorNav'

/*
 * Tutor drop-in view (Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Lists every drop-in session in a rolling window. Tutors click a session to
 * see the full roster — who's booked, what subjects they picked, and the
 * topics they want help with.
 *
 * We deliberately show ALL sessions (not just ones this tutor is rostered
 * onto) — staff often cover for each other and the small team means everyone
 * benefits from seeing the full picture.
 *
 * RLS: `dropin_signins` has a "Staff read all" policy, so the join with
 * `students` works for tutors/admins (students still only see their own row).
 *
 * Phase 4 will add presence tracking (mark with-tutor / done) on this same
 * page.
 */

const SUBJECT_STYLES = {
  Maths:          { bg: '#DEE7FF', fg: '#062E63' },
  Mathematics:    { bg: '#DEE7FF', fg: '#062E63' },
  English:        { bg: '#FCE7F3', fg: '#9D174D' },
  Science:        { bg: '#D1FAE5', fg: '#065F46' },
  Chemistry:      { bg: '#D1FAE5', fg: '#065F46' },
  Physics:        { bg: '#E0E7FF', fg: '#3730A3' },
  Biology:        { bg: '#D1FAE5', fg: '#065F46' },
  Economics:      { bg: '#FEF3C7', fg: '#92400E' },
  'All subjects': { bg: '#FEF3C7', fg: '#92400E' },
  Other:          { bg: '#E5E7EB', fg: '#374151' },
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

// ── Date helpers (kept local — these are dropin-specific) ──────────────────
function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fmtTime(t) { return t ? t.slice(0, 5) : '' }
function fmtDateLong(d) {
  return `${DOW_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0,3)}`
}
function sessionStart(s) {
  return new Date(`${s.session_date}T${s.start_time}`)
}

// Multi-subject topics come back as:
//   [Maths]
//   Q14 from the 2023 paper
//
//   [Chemistry]
//   Equilibrium
//
// Parse them into structured chunks so the tutor view can render each subject
// as its own block. Single-subject bookings (older rows) have no [Header] line
// and fall through to a single chunk using the booking's `subject` column.
function parseTopics(question, fallbackSubject) {
  const text = (question || '').trim()
  if (!text) return []
  const headers = [...text.matchAll(/\[([^\]]+)\]\n?/g)]
  if (headers.length === 0) {
    return [{ subject: fallbackSubject || 'Other', topics: text }]
  }
  const out = []
  for (let i = 0; i < headers.length; i++) {
    const subject = headers[i][1].trim()
    const start = headers[i].index + headers[i][0].length
    const end = i + 1 < headers.length ? headers[i + 1].index : text.length
    const topics = text.slice(start, end).trim()
    if (subject) out.push({ subject, topics })
  }
  return out
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function TutorDropinPage() {
  const [staff, setStaff] = useState(null)
  const [sessions, setSessions] = useState([])
  const [signins, setSignins] = useState([])   // joined with students
  const [filter, setFilter] = useState('upcoming') // 'upcoming' | 'today' | 'past'
  const [expandedId, setExpandedId] = useState(null)
  const [authErr, setAuthErr] = useState(null)
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

      // Pull a wide window — tutors want to look back at recent sessions too
      const today = new Date()
      const lookBack = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const lookAhead = new Date(today.getFullYear(), today.getMonth() + 3, 0)

      const { data: sess } = await supabase
        .from('dropin_sessions')
        .select('*')
        .gte('session_date', isoDate(lookBack))
        .lte('session_date', isoDate(lookAhead))
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true })
      setSessions(sess || [])

      // Roster across all those sessions — staff RLS lets us join students.
      const ids = (sess || []).map(s => s.id)
      if (ids.length > 0) {
        const { data: rs } = await supabase
          .from('dropin_signins')
          .select(`
            id, session_id, subject, question, status, signed_in_at,
            students (id, full_name, school, school_year, email)
          `)
          .in('session_id', ids)
          .order('signed_in_at', { ascending: true })
        setSignins(rs || [])
      }
    }
    load()
  }, [])

  const signinsBySession = useMemo(() => {
    const map = new Map()
    for (const r of signins) {
      if (!map.has(r.session_id)) map.set(r.session_id, [])
      map.get(r.session_id).push(r)
    }
    return map
  }, [signins])

  const filtered = useMemo(() => {
    const today = isoDate(new Date())
    if (filter === 'today')   return sessions.filter(s => s.session_date === today)
    if (filter === 'past')    return [...sessions].filter(s => s.session_date < today).reverse()
    /* upcoming */             return sessions.filter(s => s.session_date >= today)
  }, [sessions, filter])

  const todayCount    = sessions.filter(s => s.session_date === isoDate(new Date())).length
  const upcomingCount = sessions.filter(s => s.session_date >= isoDate(new Date())).length
  const totalBookings = useMemo(() => {
    const today = isoDate(new Date())
    return signins.filter(r => {
      const s = sessions.find(x => x.id === r.session_id)
      return s && s.session_date >= today
    }).length
  }, [signins, sessions])

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

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={staff.role === 'admin'} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-3 font-display">
            Drop-in roster · Staff view
          </p>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Who's coming in.
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            Every drop-in session in the next few weeks, with the students booked into each and the topics they need help with.
          </p>

          {/* Stat strip */}
          <div className="grid grid-cols-3 gap-3 mt-8 max-w-2xl">
            <StatTile label="Today" value={todayCount} suffix={`session${todayCount === 1 ? '' : 's'}`} />
            <StatTile label="Upcoming" value={upcomingCount} suffix={`session${upcomingCount === 1 ? '' : 's'}`} />
            <StatTile label="Bookings" value={totalBookings} suffix="ahead" />
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 mb-6">
          {[
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'today',    label: 'Today' },
            { id: 'past',     label: 'Past' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => { setFilter(t.id); setExpandedId(null) }}
              className={`text-sm px-3.5 py-2 rounded-full transition ${
                filter === t.id
                  ? 'bg-[#DEE7FF] text-[#062E63] font-semibold'
                  : 'text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div className="space-y-3">
            {filtered.map(s => {
              const roster = signinsBySession.get(s.id) || []
              const isExpanded = expandedId === s.id
              return (
                <SessionCard
                  key={s.id}
                  session={s}
                  roster={roster}
                  expanded={isExpanded}
                  onToggle={() => setExpandedId(isExpanded ? null : s.id)}
                />
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

function EmptyState({ filter }) {
  const copy = {
    upcoming: { emoji: '📭', title: 'No upcoming sessions',
                sub: 'When you add rows to dropin_sessions in Supabase they\'ll show up here.' },
    today:    { emoji: '☕', title: 'No drop-in today',
                sub: 'Enjoy the quiet. Tomorrow\'s roster is ready when you\'re back.' },
    past:     { emoji: '📚', title: 'No past sessions yet',
                sub: 'Once a drop-in has wrapped up, it\'ll archive here.' },
  }[filter]
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
      <div className="text-4xl mb-3">{copy.emoji}</div>
      <p className="text-sm font-semibold text-[#2A2035] mb-1">{copy.title}</p>
      <p className="text-xs text-[#2A2035]/60 max-w-md mx-auto">{copy.sub}</p>
    </div>
  )
}

function SessionCard({ session, roster, expanded, onToggle }) {
  const d = new Date(`${session.session_date}T00:00:00`)
  const cap = session.max_capacity || 5
  const count = roster.length
  const full = count >= cap
  const todayISO = (() => {
    const t = new Date()
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`
  })()
  const isToday = session.session_date === todayISO
  const isPast = sessionStart(session).getTime() < Date.now() && !isToday

  return (
    <div
      className={`rounded-2xl border bg-white overflow-hidden transition ${
        expanded ? 'border-[#BACBFF] shadow-[0_8px_30px_-12px_rgba(50,80,153,0.18)]' : 'border-[#DEE7FF]'
      }`}
    >
      {/* Header / clickable strip */}
      <button
        onClick={onToggle}
        className="w-full px-5 md:px-6 py-4 flex items-center gap-4 text-left hover:bg-[#F8FAFF] transition"
      >
        {/* Date tile */}
        <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0 border ${
          isToday ? 'border-[#10b981] bg-[#D1FAE5]' : 'border-[#DEE7FF] bg-[#F8FAFF]'
        }`}>
          <span className="text-[9px] tracking-widest uppercase font-semibold text-[#325099] leading-none">
            {DOW_SHORT[(d.getDay() + 6) % 7]}
          </span>
          <span className="text-sm font-bold text-[#2A2035] leading-tight mt-0.5 tabular-nums">
            {d.getDate()} {MONTH_NAMES[d.getMonth()].slice(0,3)}
          </span>
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#2A2035] tabular-nums">
              {fmtTime(session.start_time)} – {fmtTime(session.end_time)}
            </p>
            {isToday && (
              <span className="text-[10px] font-bold tracking-widest uppercase text-[#065F46] bg-[#D1FAE5] px-2 py-0.5 rounded-full">
                Today
              </span>
            )}
            {isPast && (
              <span className="text-[10px] font-bold tracking-widest uppercase text-[#374151] bg-[#E5E7EB] px-2 py-0.5 rounded-full">
                Past
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-[#2A2035]/60">
            <span>📍 {session.location || 'Chatswood centre'}</span>
            {session.tutors && session.tutors.length > 0 && (
              <span>👤 {session.tutors.join(', ')}</span>
            )}
          </div>
        </div>

        {/* Capacity pill */}
        <div className="flex flex-col items-end shrink-0">
          <span className={`text-xs font-bold tabular-nums px-2.5 py-1 rounded-full ${
            count === 0
              ? 'bg-[#F4F4F4] text-[#9CA3AF]'
              : full
              ? 'bg-[#FEE2E2] text-[#991B1B]'
              : 'bg-[#DEE7FF] text-[#062E63]'
          }`}>
            {count}/{cap} booked
          </span>
          <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60 mt-1">
            {expanded ? 'Hide ↑' : 'View ↓'}
          </span>
        </div>
      </button>

      {/* Roster */}
      {expanded && (
        <div className="border-t border-[#DEE7FF] bg-[#FBFCFF] px-5 md:px-6 py-5">
          {roster.length === 0 ? (
            <p className="text-sm text-[#2A2035]/60 text-center py-6">
              Nobody's booked into this one yet.
            </p>
          ) : (
            <div className="space-y-3">
              {roster.map((r, i) => (
                <RosterRow key={r.id} index={i + 1} signin={r} />
              ))}
            </div>
          )}

          {session.notes && (
            <div className="rounded-xl px-4 py-3 mt-4 bg-[#FEF3C7] border border-[#FDE68A]">
              <p className="text-[10px] tracking-[0.25em] uppercase font-semibold text-[#92400E] mb-1 font-display">
                Session notes
              </p>
              <p className="text-xs text-[#78350F] leading-relaxed whitespace-pre-line">{session.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RosterRow({ index, signin }) {
  const s = signin.students || {}
  const chunks = parseTopics(signin.question, signin.subject)
  const subjects = chunks.map(c => c.subject)
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-white p-4">
      <div className="flex items-start gap-3">
        {/* Index circle */}
        <div className="w-8 h-8 rounded-full bg-[#062E63] text-white flex items-center justify-center shrink-0 text-xs font-bold">
          {index}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-1.5">
            <p className="text-sm font-semibold text-[#2A2035]">{s.full_name || 'Unknown student'}</p>
            <p className="text-[11px] text-[#2A2035]/50">
              {s.school || 'School ?'} · Year {s.school_year || '—'}
            </p>
          </div>

          {/* Subject pills */}
          {subjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {subjects.map(sub => {
                const c = SUBJECT_STYLES[sub] || SUBJECT_STYLES.Other
                return (
                  <span
                    key={sub}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: c.bg, color: c.fg }}
                  >
                    {sub}
                  </span>
                )
              })}
            </div>
          )}

          {/* Per-subject topic chunks */}
          <div className="space-y-2">
            {chunks.map(({ subject, topics }, i) => {
              const c = SUBJECT_STYLES[subject] || SUBJECT_STYLES.Other
              return (
                <div
                  key={i}
                  className="rounded-lg border bg-[#F8FAFF] px-3 py-2"
                  style={{ borderColor: c.fg + '20' }}
                >
                  {chunks.length > 1 && (
                    <p
                      className="text-[10px] tracking-wider uppercase font-bold mb-1"
                      style={{ color: c.fg }}
                    >
                      {subject}
                    </p>
                  )}
                  <p className="text-xs text-[#2A2035]/80 whitespace-pre-line leading-relaxed">
                    {topics}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

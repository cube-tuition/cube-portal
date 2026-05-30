'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import { useRouter } from 'next/navigation'
import PortalNav from '../../components/PortalNav'
import { T_DROPIN_SESSIONS, T_DROPIN_SIGNINS, T_STUDENTS } from '../../lib/tables'

/*
 * Drop-in Booking
 * ─────────────────────────────────────────────────────────────────────────────
 * Students book a free exam/HW help session in advance. Sessions run
 * fortnightly (or whenever drop-in days are added to dropin_sessions).
 * Bookings close 24 hours before the session start time.
 *
 * Expected Supabase tables:
 *   dropin_sessions  (id, session_date, start_time, end_time, location,
 *                     subjects[], tutors[], notes)
 *   dropin_signins   (id, session_id, student_id, subject, question,
 *                     status, signed_in_at)
 */

const BOOKING_CUTOFF_MS = 24 * 60 * 60 * 1000 // 24 hours
const DEFAULT_CAPACITY = 5

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
const ALL_SUBJECTS = ['Maths', 'English', 'Science', 'Chemistry']

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

// ── Date helpers ───────────────────────────────────────────────────────────
function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
function buildMonthGrid(monthStart) {
  // Weeks start Monday. Returns array of {date, inMonth} length 42 (6 rows × 7 cols).
  const grid = []
  const firstDow = (monthStart.getDay() + 6) % 7 // 0 = Monday
  const start = new Date(monthStart)
  start.setDate(start.getDate() - firstDow)
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    grid.push({ date: d, inMonth: d.getMonth() === monthStart.getMonth() })
  }
  return grid
}
function sessionStart(session) {
  return new Date(`${session.session_date}T${session.start_time}`)
}
function bookingOpen(session, now = new Date()) {
  return sessionStart(session).getTime() - now.getTime() > BOOKING_CUTOFF_MS
}
function fmtTime(t) { return t ? t.slice(0, 5) : '' }
function fmtDateLong(d) {
  return `${DOW_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0,3)}`
}

// Demo session for preview — auto-generated 3 days in the future so it always
// shows as an "open to book" tile. Disappears once real sessions exist in the
// dropin_sessions table.
function buildExampleSession() {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  return {
    id: '__example_session__',
    __demo: true,
    session_date: isoDate(d),
    start_time: '16:00:00',
    end_time: '18:00:00',
    location: 'Chatswood centre',
    subjects: ['All subjects'],
    tutors: ['Demo Tutor'],
    notes: 'Example session — for preview only',
  }
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function DropinPage() {
  const [student, setStudent] = useState(null)
  const [sessions, setSessions] = useState([])
  const [myBookings, setMyBookings] = useState([])
  const [bookedCounts, setBookedCounts] = useState({}) // { [session_id]: count }
  const [viewMonth, setViewMonth] = useState(startOfMonth(new Date()))
  const [selectedSession, setSelectedSession] = useState(null) // session being booked
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()

  const sessionCapacity = (s) =>
    typeof s?.max_capacity === 'number' && s.max_capacity > 0 ? s.max_capacity : DEFAULT_CAPACITY
  const remainingFor = (s) =>
    Math.max(0, sessionCapacity(s) - (bookedCounts[s?.id] || 0))
  const isFull = (s) => remainingFor(s) <= 0

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!requireStudent(user, router)) return

      const { data: profile } = await supabase
        .from(T_STUDENTS)
        .select('*')
        .eq('id', user.id)
        .single()
      setStudent(profile)

      // Pull a wide window so navigation between months works smoothly
      const today = new Date()
      const lookBack = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const lookAhead = new Date(today.getFullYear(), today.getMonth() + 3, 0)
      const { data: sess } = await supabase
        .from(T_DROPIN_SESSIONS)
        .select('*')
        .gte('session_date', isoDate(lookBack))
        .lte('session_date', isoDate(lookAhead))
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true })

      // If no real sessions exist yet, drop in an example session so the
      // booking flow can be previewed. The example disappears as soon as you
      // add any real dropin_sessions rows in Supabase.
      const list = sess && sess.length > 0 ? sess : [buildExampleSession()]
      setSessions(list)

      const { data: mine } = await supabase
        .from(T_DROPIN_SIGNINS)
        .select('id, session_id, subject, question, status, signed_in_at')
        .eq('student_id', user.id)
        .order('signed_in_at', { ascending: false })
      setMyBookings(mine || [])

      // Booking counts per session (SECURITY DEFINER RPC — counts only,
      // doesn't reveal who's booked).
      const { data: caps } = await supabase.rpc('dropin_session_capacity')
      const counts = {}
      for (const row of caps || []) counts[row.session_id] = row.booked_count
      setBookedCounts(counts)
    }
    load()
  }, [])

  const grid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth])
  const sessionsByDate = useMemo(() => {
    const map = new Map()
    for (const s of sessions) {
      if (!map.has(s.session_date)) map.set(s.session_date, [])
      map.get(s.session_date).push(s)
    }
    return map
  }, [sessions])

  const upcomingBookings = useMemo(() => {
    const today = isoDate(new Date())
    const sessionMap = new Map(sessions.map(s => [s.id, s]))
    return myBookings
      .map(b => ({ ...b, session: sessionMap.get(b.session_id) }))
      .filter(b => b.session && b.session.session_date >= today)
      .sort((a, b) => a.session.session_date.localeCompare(b.session.session_date))
  }, [myBookings, sessions])

  const handleBook = async ({ subject, question, selectedSubjects, topicsBySubject }) => {
    setError('')
    if (!selectedSession) return
    const subs = selectedSubjects && selectedSubjects.length > 0
      ? selectedSubjects
      : (subject ? [subject] : [])
    if (subs.length === 0) {
      setError('Pick at least one subject so the tutor can match you.')
      return
    }
    // Every selected subject needs topics filled in
    const blanks = subs.filter(s => !((topicsBySubject?.[s] || '').trim()))
    if (blanks.length > 0) {
      setError(
        blanks.length === subs.length
          ? 'Tell the tutor what topics you need help with.'
          : `Add topics for: ${blanks.join(', ')}.`
      )
      return
    }
    if (!question.trim()) { setError('Tell the tutor what topics you need help with.'); return }
    if (!bookingOpen(selectedSession)) { setError('Bookings have closed for this session (24h cutoff).'); return }
    if (isFull(selectedSession)) {
      setError(`This session is full (${sessionCapacity(selectedSession)} of ${sessionCapacity(selectedSession)} booked). Try another date.`)
      return
    }

    // Demo session — don't hit Supabase, just mock the booking locally so
    // the rest of the UX can be previewed.
    if (selectedSession.__demo) {
      setSubmitting(true)
      await new Promise(r => setTimeout(r, 400))
      setMyBookings(prev => [{
        id: `__demo_booking__${Date.now()}`,
        session_id: selectedSession.id,
        subject,
        question: question.trim(),
        status: 'booked',
        signed_in_at: new Date().toISOString(),
        __demo: true,
      }, ...prev])
      setBookedCounts(prev => ({ ...prev, [selectedSession.id]: (prev[selectedSession.id] || 0) + 1 }))
      setSelectedSession(null)
      setSubmitting(false)
      return
    }

    setSubmitting(true)
    const { data, error: insErr } = await supabase
      .from(T_DROPIN_SIGNINS)
      .insert({
        session_id: selectedSession.id,
        student_id: student.id,
        subject,
        question: question.trim(),
        status: 'booked',
      })
      .select()
      .single()

    if (insErr) {
      // Friendly message for the capacity trigger
      const msg = /full/i.test(insErr.message)
        ? 'Sorry — someone just grabbed the last spot. This session is now full.'
        : insErr.message || 'Could not book — please try again.'
      setError(msg)
      // Refresh counts so the UI catches up to reality
      const { data: caps } = await supabase.rpc('dropin_session_capacity')
      if (caps) {
        const counts = {}
        for (const row of caps) counts[row.session_id] = row.booked_count
        setBookedCounts(counts)
      }
    } else {
      setMyBookings(prev => [data, ...prev])
      setBookedCounts(prev => ({ ...prev, [selectedSession.id]: (prev[selectedSession.id] || 0) + 1 }))
      setSelectedSession(null)
      // Fire-and-forget admin notification — booking confirmation isn't
      // blocked on email delivery, and any failure is logged server-side.
      fetch('/api/notify-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'booked', bookingId: data.id }),
      }).catch(e => console.warn('Booking notification failed (booking itself was successful):', e))
    }
    setSubmitting(false)
  }

  const handleCancelBooking = async (bookingId) => {
    const ok = window.confirm('Cancel this booking? You can re-book up to 24 hours before the session.')
    if (!ok) return
    const inMemory = myBookings.find(b => b.id === bookingId)

    // Demo booking — only lives in local state, no email
    if (String(bookingId).startsWith('__demo_booking__')) {
      setMyBookings(prev => prev.filter(b => b.id !== bookingId))
      if (inMemory?.session_id) {
        setBookedCounts(prev => ({ ...prev, [inMemory.session_id]: Math.max(0, (prev[inMemory.session_id] || 1) - 1) }))
      }
      return
    }

    // Snapshot the booking + student + session BEFORE deleting, so the
    // cancellation email has everything it needs (the row is about to be
    // gone from Supabase).
    const { data: snapshot } = await supabase
      .from(T_DROPIN_SIGNINS)
      .select(`
        id, subject, question, signed_in_at,
        students (full_name, school, year, email),
        dropin_sessions (session_date, start_time, end_time, location, tutors)
      `)
      .eq('id', bookingId)
      .single()

    const { error: delErr } = await supabase
      .from(T_DROPIN_SIGNINS)
      .delete()
      .eq('id', bookingId)
    if (delErr) return

    setMyBookings(prev => prev.filter(b => b.id !== bookingId))
    if (inMemory?.session_id) {
      setBookedCounts(prev => ({ ...prev, [inMemory.session_id]: Math.max(0, (prev[inMemory.session_id] || 1) - 1) }))
    }

    if (snapshot) {
      fetch('/api/notify-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancelled', snapshot }),
      }).catch(e => console.warn('Cancellation notification failed (cancel itself was successful):', e))
    }
  }

  if (!student) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">
        Loading…
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student.full_name} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-3 font-display">
            Exam & HW Help · Free for all students
          </p>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Book a drop-in session.
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            Pick a date, lock in your slot, walk in at the time. A tutor will work
            one-on-one with you on whatever you bring.
          </p>
          <div className="inline-flex items-center gap-2 mt-5 bg-white/80 border border-[#DEE7FF] rounded-full px-4 py-2">
            <span className="text-base">⏰</span>
            <span className="text-xs font-semibold text-[#062E63]">
              Bookings close 24 hours before the session starts.
            </span>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* MAIN COLUMN — Calendar */}
        <div className="lg:col-span-2 space-y-6">
          <Calendar
            viewMonth={viewMonth}
            setViewMonth={setViewMonth}
            grid={grid}
            sessionsByDate={sessionsByDate}
            myBookings={myBookings}
            bookedCounts={bookedCounts}
            onPickSession={(s) => setSelectedSession(s)}
          />

          {/* List view alongside calendar — upcoming sessions */}
          <UpcomingList
            sessions={sessions}
            myBookings={myBookings}
            bookedCounts={bookedCounts}
            onPick={(s) => setSelectedSession(s)}
          />
        </div>

        {/* SIDE COLUMN */}
        <div className="space-y-6">
          {/* Student info */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-2 font-display">
              Booking as
            </p>
            <p className="text-lg font-semibold text-[#2A2035] font-display">{student.full_name}</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">
              {student.school} · Year {student.year}
            </p>
          </div>

          {/* My upcoming bookings */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-4 font-display">
              Your upcoming bookings
            </p>
            {upcomingBookings.length === 0 ? (
              <p className="text-xs text-[#2A2035]/50">
                Nothing booked yet. Pick a date on the calendar to lock one in.
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingBookings.map(b => {
                  const d = new Date(`${b.session.session_date}T00:00:00`)
                  const cutoffPassed = !bookingOpen(b.session)
                  const subjects = (b.subject || '').split(/\s*,\s*/).filter(Boolean)
                  return (
                    <div key={b.id} className="rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] p-3">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div>
                          <p className="text-sm font-semibold text-[#2A2035]">{fmtDateLong(d)}</p>
                          <p className="text-[11px] text-[#2A2035]/60 tabular-nums">
                            {fmtTime(b.session.start_time)}–{fmtTime(b.session.end_time)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1 justify-end max-w-[55%]">
                          {subjects.map(s => {
                            const c = SUBJECT_STYLES[s] || SUBJECT_STYLES.Other
                            return (
                              <span
                                key={s}
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ background: c.bg, color: c.fg }}
                              >
                                {s}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                      <p className="text-[11px] text-[#2A2035]/70 whitespace-pre-line line-clamp-3 mb-2">{b.question}</p>
                      {cutoffPassed ? (
                        <span className="text-[10px] font-semibold text-[#92400E]">
                          🔒 Within 24h — can't cancel here
                        </span>
                      ) : (
                        <button
                          onClick={() => handleCancelBooking(b.id)}
                          className="text-[10px] font-semibold text-[#B23A3A] hover:text-[#7F1D1D]"
                        >
                          Cancel booking
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* How it works — booking flow */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-4 font-display">
              How a drop-in works
            </p>
            <div className="space-y-3">
              {[
                { n: 1, title: 'Pick a date',     sub: 'From the calendar' },
                { n: 2, title: 'Book your slot',  sub: 'Subject + topics you need' },
                { n: 3, title: 'Walk in on time', sub: 'No need to check in again' },
                { n: 4, title: 'Walk out',     sub: 'Clear of confusion!' },
              ].map(s => (
                <div key={s.n} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-[#062E63]">
                    <span className="text-white text-xs font-bold">{s.n}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#2A2035] leading-tight">{s.title}</p>
                    <p className="text-[11px] text-[#2A2035]/50">{s.sub}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-xl px-4 py-3 mt-5 bg-[#FEF3C7] border border-[#FDE68A]">
              <p className="text-[10px] tracking-[0.25em] uppercase font-semibold text-[#92400E] mb-1 font-display">
                ⏰ Heads up
              </p>
              <p className="text-xs text-[#78350F] leading-relaxed">
                Bookings close <strong>24 hours before</strong> the session starts.
                Plan ahead — once that window closes the slot can't be locked in.
                Maximum capacity per session - 5 students.
              </p>
            </div>
            <div className="rounded-xl px-4 py-3 mt-3 bg-[#F8FAFF] border border-[#DEE7FF]">
              <p className="text-[10px] tracking-[0.3em] uppercase font-semibold text-[#325099] mb-1 font-display">
                Bring with you
              </p>
              <p className="text-xs text-[#2A2035]/70 leading-relaxed">
                Any past paper, school assessment, or practice question — even from a different tutor or textbook.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* BOOKING MODAL */}
      {selectedSession && (
        <BookingModal
          session={selectedSession}
          student={student}
          existingBooking={myBookings.find(b => b.session_id === selectedSession.id) || null}
          capacity={sessionCapacity(selectedSession)}
          booked={bookedCounts[selectedSession.id] || 0}
          error={error}
          submitting={submitting}
          onClose={() => { setSelectedSession(null); setError('') }}
          onSubmit={handleBook}
        />
      )}

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

// ── Calendar ───────────────────────────────────────────────────────────────
function Calendar({ viewMonth, setViewMonth, grid, sessionsByDate, myBookings, bookedCounts, onPickSession }) {
  const todayISO = isoDate(new Date())
  const bookedSessionIds = new Set(myBookings.map(b => b.session_id))
  const capOf = (s) => (typeof s?.max_capacity === 'number' && s.max_capacity > 0 ? s.max_capacity : DEFAULT_CAPACITY)
  const fullOf = (s) => ((bookedCounts && bookedCounts[s.id]) || 0) >= capOf(s)

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      {/* Month header */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-[#DEE7FF]">
        <div>
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">
            Drop-in calendar
          </p>
          <h2 className="text-lg font-semibold text-[#2A2035] font-display mt-0.5">
            {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <CalNavBtn label="‹" onClick={() => setViewMonth(addMonths(viewMonth, -1))} />
          <button
            onClick={() => setViewMonth(startOfMonth(new Date()))}
            className="text-xs font-semibold text-[#325099] hover:text-[#062E63] px-3 py-1.5 rounded-full hover:bg-[#F8FAFF] transition"
          >
            Today
          </button>
          <CalNavBtn label="›" onClick={() => setViewMonth(addMonths(viewMonth, 1))} />
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 px-6 pt-4 pb-2">
        {DOW_SHORT.map(d => (
          <div key={d} className="text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/60 text-center">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1.5 px-6 pb-6">
        {grid.map(({ date, inMonth }, i) => {
          const iso = isoDate(date)
          const daySessions = sessionsByDate.get(iso) || []
          const hasSession = daySessions.length > 0
          const isToday = iso === todayISO
          const isPast  = iso < todayISO
          const myBooked = daySessions.some(s => bookedSessionIds.has(s.id))

          if (!hasSession) {
            return (
              <div
                key={i}
                className={`aspect-square rounded-xl flex flex-col items-center justify-center text-sm ${
                  inMonth ? 'text-[#2A2035]/60' : 'text-[#2A2035]/20'
                } ${isToday ? 'bg-[#F8FAFF] font-semibold text-[#062E63]' : ''}`}
              >
                <span className="tabular-nums">{date.getDate()}</span>
              </div>
            )
          }

          // Session day — render as button, one button per session if multiple
          const primary = daySessions[0]
          const open = bookingOpen(primary) && !isPast
          const full = fullOf(primary)
          const canClick = myBooked || (open && !full)
          return (
            <button
              key={i}
              onClick={() => onPickSession(primary)}
              disabled={!canClick}
              className={`aspect-square rounded-xl flex flex-col items-center justify-center px-1 text-center transition border relative ${
                myBooked
                  ? 'bg-[#D1FAE5] border-[#10b981] text-[#065F46] hover:bg-[#A7F3D0]'
                  : full && open
                  ? 'bg-[#FEE2E2] border-[#FCA5A5] text-[#991B1B] cursor-not-allowed'
                  : open
                  ? 'bg-[#DEE7FF] border-[#BACBFF] text-[#062E63] hover:bg-[#BACBFF]'
                  : 'bg-[#F4F4F4] border-[#E5E7EB] text-[#9CA3AF] cursor-not-allowed'
              }`}
              title={
                primary.__demo
                  ? 'Example session — click to preview the booking flow'
                  : myBooked
                  ? "You're booked in"
                  : full && open
                  ? `Session full (${capOf(primary)}/${capOf(primary)} booked)`
                  : open
                  ? `Click to book — ${capOf(primary) - ((bookedCounts && bookedCounts[primary.id]) || 0)} of ${capOf(primary)} spots left`
                  : 'Bookings closed (within 24h)'
              }
            >
              {primary.__demo && (
                <span className="absolute -top-1.5 -right-1.5 bg-[#FEF3C7] text-[#92400E] text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-[#FDE68A] shadow-sm">
                  Demo
                </span>
              )}
              <span className="text-sm font-bold tabular-nums leading-none">{date.getDate()}</span>
              <span className="text-[9px] font-semibold tabular-nums mt-1 leading-none">
                {fmtTime(primary.start_time)}
              </span>
              {myBooked ? (
                <span className="text-[8px] font-bold tracking-wider uppercase mt-0.5">Booked</span>
              ) : full && open ? (
                <span className="text-[8px] font-bold tracking-wider uppercase mt-0.5">Full</span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="px-6 pb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[#2A2035]/60 border-t border-[#DEE7FF] pt-4">
        <LegendDot color="#BACBFF" label="Open to book" />
        <LegendDot color="#10b981" label="You're booked" />
        <LegendDot color="#FCA5A5" label="Full" />
        <LegendDot color="#9CA3AF" label="Within 24h · closed" />
      </div>
    </div>
  )
}

function CalNavBtn({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 rounded-full text-[#325099] hover:bg-[#F8FAFF] hover:text-[#062E63] transition flex items-center justify-center text-lg"
      aria-label={label === '‹' ? 'Previous month' : 'Next month'}
    >
      {label}
    </button>
  )
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

// ── Upcoming sessions list ────────────────────────────────────────────────
function UpcomingList({ sessions, myBookings, bookedCounts, onPick }) {
  const today = isoDate(new Date())
  const upcoming = sessions.filter(s => s.session_date >= today).slice(0, 6)
  const bookedIds = new Set(myBookings.map(b => b.session_id))
  const capOf = (s) => (typeof s?.max_capacity === 'number' && s.max_capacity > 0 ? s.max_capacity : DEFAULT_CAPACITY)
  const countOf = (s) => (bookedCounts && bookedCounts[s.id]) || 0
  const fullOf = (s) => countOf(s) >= capOf(s)

  if (upcoming.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
      <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
        Or pick from the list
      </p>
      <h2 className="text-lg font-semibold text-[#2A2035] mb-4 font-display">
        Upcoming sessions
      </h2>
      <div className="space-y-2">
        {upcoming.map(s => {
          const d = new Date(`${s.session_date}T00:00:00`)
          const isBooked = bookedIds.has(s.id)
          const isOpen = bookingOpen(s)
          const cap = capOf(s)
          const count = countOf(s)
          const full = fullOf(s)
          const canClick = isBooked || (isOpen && !full)
          return (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              disabled={!canClick}
              className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 transition text-left ${
                isBooked
                  ? 'border-[#10b981] bg-[#D1FAE5]'
                  : full && isOpen
                  ? 'border-[#FCA5A5] bg-[#FEE2E2] cursor-not-allowed'
                  : isOpen
                  ? 'border-[#DEE7FF] bg-white hover:border-[#BACBFF] hover:bg-[#F8FAFF]'
                  : 'border-[#E5E7EB] bg-[#F4F4F4] cursor-not-allowed opacity-70'
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 border ${
                isBooked ? 'border-[#10b981] bg-white' : full && isOpen ? 'border-[#FCA5A5] bg-white' : 'border-[#DEE7FF] bg-white'
              }`}>
                <span className="text-[9px] tracking-widest uppercase font-semibold text-[#325099] leading-none">
                  {DOW_SHORT[(d.getDay() + 6) % 7]}
                </span>
                <span className="text-[11px] font-bold text-[#2A2035] leading-tight mt-0.5 tabular-nums">
                  {d.getDate()} {MONTH_NAMES[d.getMonth()].slice(0,3)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#2A2035] tabular-nums flex items-center gap-2">
                  {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
                  {s.__demo && (
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-[#FEF3C7] text-[#92400E] px-1.5 py-0.5 rounded-full border border-[#FDE68A]">
                      Demo
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-[#2A2035]/50">
                  {s.location || 'Chatswood centre'}
                  {isOpen && !isBooked && (
                    <span className={`ml-1 ${full ? 'text-[#991B1B] font-semibold' : 'text-[#325099]'}`}>
                      · {full ? 'Full' : `${cap - count} of ${cap} spots left`}
                    </span>
                  )}
                </p>
              </div>
              {isBooked ? (
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#065F46]">Booked</span>
              ) : full && isOpen ? (
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#991B1B]">Full</span>
              ) : isOpen ? (
                <span className="text-xs font-semibold text-[#325099]">Book →</span>
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF]">Closed</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Multi-subject helpers ─────────────────────────────────────────────────
// Composed format we store in dropin_signins.question when there are multiple
// subjects:
//
//   [Maths]
//   Q14 from the 2023 HSC paper — integration by parts
//
//   [Chemistry]
//   Equilibrium — Kc vs Kp
//
// Single-subject bookings just store the topics text directly (no header), so
// older single-subject rows keep displaying correctly.
function formatTopicsBySubject(subjects, topics) {
  if (subjects.length === 0) return ''
  if (subjects.length === 1) return (topics[subjects[0]] || '').trim()
  return subjects
    .map(s => `[${s}]\n${(topics[s] || '').trim()}`)
    .join('\n\n')
}
function parseTopicsBySubject(text, subjects) {
  const empty = Object.fromEntries(subjects.map(s => [s, '']))
  if (!text) return empty
  const matches = [...text.matchAll(/\[([^\]]+)\]\n?/g)]
  if (matches.length === 0) {
    return subjects.length > 0 ? { ...empty, [subjects[0]]: text.trim() } : empty
  }
  const out = { ...empty }
  for (let i = 0; i < matches.length; i++) {
    const header = matches[i][1]
    const start = matches[i].index + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    out[header] = text.slice(start, end).trim()
  }
  return out
}

// ── Booking modal ─────────────────────────────────────────────────────────
function BookingModal({ session, student, existingBooking, capacity = DEFAULT_CAPACITY, booked = 0, error, submitting, onClose, onSubmit }) {
  const spotsLeft = Math.max(0, capacity - booked)
  const isFullSession = spotsLeft <= 0 && !existingBooking
  // Selected subjects (array) + per-subject topics text
  const initialSubjects = (existingBooking?.subject || '')
    .split(/\s*,\s*/)
    .filter(Boolean)
  const [selectedSubjects, setSelectedSubjects] = useState(initialSubjects)
  const [topicsBySubject, setTopicsBySubject] = useState(
    parseTopicsBySubject(existingBooking?.question || '', initialSubjects)
  )

  const toggleSubject = (sub) => {
    setSelectedSubjects(prev => {
      if (prev.includes(sub)) {
        return prev.filter(s => s !== sub)
      }
      // Keep the order in which the user picked subjects
      return [...prev, sub]
    })
    setTopicsBySubject(prev => {
      if (prev[sub] !== undefined) return prev
      return { ...prev, [sub]: '' }
    })
  }

  const setTopicsFor = (sub, value) => {
    setTopicsBySubject(prev => ({ ...prev, [sub]: value }))
  }

  const d = new Date(`${session.session_date}T00:00:00`)
  const open = bookingOpen(session)
  const sessionSubjects = (session.subjects && session.subjects.length > 0)
    ? session.subjects.flatMap(s => s === 'All subjects' ? ALL_SUBJECTS : [s])
    : ALL_SUBJECTS

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#062E63]/40 backdrop-blur-sm px-3 md:px-6 py-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-[#DEE7FF] w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#DEE7FF] flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display flex items-center gap-2">
              {existingBooking ? 'Your booking' : 'Book this session'}
              {session.__demo && (
                <span className="text-[9px] font-bold uppercase tracking-wider bg-[#FEF3C7] text-[#92400E] px-1.5 py-0.5 rounded-full border border-[#FDE68A]">
                  Demo
                </span>
              )}
            </p>
            <h3 className="text-xl font-semibold text-[#2A2035] font-display">
              {fmtDateLong(d)}
            </h3>
            <p className="text-xs text-[#2A2035]/60 tabular-nums mt-0.5">
              {fmtTime(session.start_time)} – {fmtTime(session.end_time)}
              {' · '}
              {session.location || 'Chatswood centre'}
            </p>
            {!existingBooking && (
              <p className={`text-[11px] font-semibold mt-1 ${spotsLeft === 0 ? 'text-[#991B1B]' : spotsLeft <= 2 ? 'text-[#92400E]' : 'text-[#325099]'}`}>
                {spotsLeft === 0
                  ? `Full · ${capacity}/${capacity} booked`
                  : `${spotsLeft} of ${capacity} spots left`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#2A2035]/40 hover:text-[#2A2035] text-2xl leading-none shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {session.__demo && !existingBooking && (
            <div className="rounded-xl px-4 py-3 mb-5 bg-[#FEF3C7] border border-[#FDE68A]">
              <p className="text-[10px] tracking-[0.25em] uppercase font-semibold text-[#92400E] mb-1 font-display">
                Preview only
              </p>
              <p className="text-xs text-[#78350F] leading-relaxed">
                This is an example session so you can see the booking flow.
                Booking it won't write to Supabase — it'll just stub a card in "Your upcoming bookings". Add real rows to <code className="font-mono bg-white/60 px-1 rounded">dropin_sessions</code> when you're ready.
              </p>
            </div>
          )}
          {existingBooking ? (
            <div className="rounded-xl px-5 py-4 mb-5 flex items-center gap-3 bg-[#D1FAE5]">
              <div className="w-8 h-8 rounded-full bg-[#065F46] text-white flex items-center justify-center text-sm font-bold">✓</div>
              <div>
                <p className="font-semibold text-sm text-[#065F46]">You're already booked in.</p>
                <p className="text-xs text-[#065F46]/80">Walk in on the day — no need to check in again.</p>
              </div>
            </div>
          ) : !open ? (
            <div className="rounded-xl px-5 py-4 mb-5 bg-[#FEF3C7] border border-[#FDE68A]">
              <p className="font-semibold text-sm text-[#92400E]">Bookings closed for this session.</p>
              <p className="text-xs text-[#78350F] mt-1">We close bookings 24 hours before each session starts.</p>
            </div>
          ) : isFullSession ? (
            <div className="rounded-xl px-5 py-4 mb-5 bg-[#FEE2E2] border border-[#FCA5A5]">
              <p className="font-semibold text-sm text-[#991B1B]">This session is full.</p>
              <p className="text-xs text-[#7F1D1D] mt-1">We cap each drop-in at {capacity} students so the tutors can give one-on-one help. Try another date.</p>
            </div>
          ) : null}

          {/* Read-only student info */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <ReadOnlyField label="Name" value={student.full_name} />
            <ReadOnlyField label="Year" value={`Year ${student.year || '—'}`} />
          </div>

          {/* Subjects — multi-select */}
          <div className="flex items-baseline justify-between mb-2">
            <label className="block text-xs font-semibold text-[#2A2035]/70">
              What subjects? <span className="text-[#2A2035]/40 font-normal">(pick one or more)</span>
            </label>
            {selectedSubjects.length > 0 && (
              <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]">
                {selectedSubjects.length} selected
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-5">
            {sessionSubjects.map(sub => {
              const c = SUBJECT_STYLES[sub] || SUBJECT_STYLES.Other
              const active = selectedSubjects.includes(sub)
              const disabled = !!existingBooking || !open || isFullSession
              return (
                <button
                  key={sub}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleSubject(sub)}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition border ${
                    disabled ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                  style={{
                    background: active ? c.bg : '#ffffff',
                    color: active ? c.fg : '#2A2035',
                    borderColor: active ? c.fg : '#DEE7FF',
                  }}
                >
                  {active && <span className="text-[11px] leading-none">✓</span>}
                  {sub}
                </button>
              )
            })}
          </div>

          {/* Per-subject topic textareas */}
          {selectedSubjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#DEE7FF] bg-[#F8FAFF] px-4 py-6 text-center mb-4">
              <p className="text-xs text-[#2A2035]/60">
                Pick a subject above and a topics box will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4 mb-2">
              {selectedSubjects.map(sub => {
                const c = SUBJECT_STYLES[sub] || SUBJECT_STYLES.Other
                const value = topicsBySubject[sub] || ''
                const disabled = !!existingBooking || !open || isFullSession
                return (
                  <div
                    key={sub}
                    className="rounded-xl border bg-white overflow-hidden"
                    style={{ borderColor: c.fg + '40' }}
                  >
                    <div
                      className="px-4 py-2 flex items-center justify-between border-b"
                      style={{ background: c.bg, borderColor: c.fg + '20' }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.fg }} />
                        <span className="text-xs font-bold tracking-wide" style={{ color: c.fg }}>
                          {sub}
                        </span>
                      </div>
                      {!disabled && (
                        <button
                          type="button"
                          onClick={() => toggleSubject(sub)}
                          className="text-[10px] font-semibold opacity-60 hover:opacity-100 transition"
                          style={{ color: c.fg }}
                          aria-label={`Remove ${sub}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={3}
                      value={value}
                      onChange={e => setTopicsFor(sub, e.target.value)}
                      placeholder={`What ${sub} topics do you need help with? e.g. specific questions, concepts, or past papers.`}
                      disabled={disabled}
                      className="w-full bg-white text-[#2A2035] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/20 transition resize-none disabled:opacity-60"
                    />
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-[11px] text-[#2A2035]/50 mb-4">
            The more specific you are for each subject, the faster a tutor can jump in.
          </p>

          {error && (
            <div className="rounded-xl px-4 py-3 mb-4 text-sm bg-[#FDECEC] text-[#B23A3A]">
              {error}
            </div>
          )}

          {!existingBooking && open && !isFullSession && (
            <button
              onClick={() =>
                onSubmit({
                  subject: selectedSubjects.join(', '),
                  question: formatTopicsBySubject(selectedSubjects, topicsBySubject),
                  selectedSubjects,
                  topicsBySubject,
                })
              }
              disabled={submitting}
              className="w-full bg-[#325099] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#062E63] disabled:opacity-60 transition"
            >
              {submitting ? 'Booking your slot…' : 'Book my slot'}
            </button>
          )}

          {!existingBooking && (
            <p className="text-[11px] text-center text-[#2A2035]/50 mt-3">
              ⏰ Bookings close 24 hours before the session starts.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function ReadOnlyField({ label, value }) {
  return (
    <div className="rounded-xl bg-[#F8FAFF] border border-[#DEE7FF] px-3 py-2.5">
      <p className="text-[9px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-[#2A2035] truncate">{value}</p>
    </div>
  )
}

'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import TutorNav from '../../components/TutorNav'
import { normalizeDays } from '../../lib/format'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../lib/terms'

/*
 * Tutor portal — landing page (Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero stays the same; below it three quick-action cards now carry live
 * counts and link to the detail pages. Underneath, a "Today" panel pulls
 * together everything happening on the current day — classes this tutor is
 * running plus drop-ins anyone on staff is on duty for.
 *
 * Mark-attendance still routes to a Phase-4 placeholder.
 */

const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

function greeting() {
  const h = new Date().getHours()
  if (h < 5)  return 'Burning the midnight oil'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Late one tonight'
}

function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Treat 1–7 as PM (centre runs 9am–9pm; AM lessons start at 9, 10, 11).
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
function fmtSessionTime(t) { return t ? t.slice(0, 5) : '' }

export default function TutorHome() {
  const [staff, setStaff] = useState(null)
  const [currentTerm, setCurrentTerm] = useState(null)
  const [classes, setClasses] = useState([])
  const [enrollmentCounts, setEnrollmentCounts] = useState({})
  const [todayDropins, setTodayDropins] = useState([])
  const [dropinCounts, setDropinCounts] = useState({}) // { [session_id]: n }
  const [authErr, setAuthErr] = useState(null)
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile, error } = await supabase
        .from('students')
        .select('*')
        .eq('id', user.id)
        .single()

      if (error || !profile) { setAuthErr(error?.message || 'No profile'); return }
      if (profile.role !== 'tutor' && profile.role !== 'admin') {
        router.push('/dashboard')
        return
      }
      setStaff(profile)

      const terms = await fetchAllTerms()
      setCurrentTerm(getCurrentTerm(terms))

      // Classes — admin sees all, tutor sees their own (matched by first name).
      const isAdmin = profile.role === 'admin'
      const firstName = (profile.full_name || '').split(' ')[0]
      let cq = supabase.from('classes').select('*')
      if (!isAdmin && firstName) cq = cq.ilike('teacher', firstName)
      const { data: cls } = await cq
      setClasses(cls || [])

      // Enrollment counts — single round trip via `student_classes`.
      const ids = (cls || []).map(c => c.id)
      if (ids.length > 0) {
        const { data: links } = await supabase
          .from('student_classes')
          .select('class_id')
          .in('class_id', ids)
        const counts = {}
        for (const l of links || []) counts[l.class_id] = (counts[l.class_id] || 0) + 1
        setEnrollmentCounts(counts)
      }

      // Today's drop-ins (visible to all staff — small team, everyone helps).
      const today = isoDate(new Date())
      const { data: sess } = await supabase
        .from('dropin_sessions')
        .select('*')
        .eq('session_date', today)
        .order('start_time', { ascending: true })
      setTodayDropins(sess || [])

      // Booking counts via the security-definer RPC the student page already uses.
      const { data: caps } = await supabase.rpc('dropin_session_capacity')
      const counts = {}
      for (const row of caps || []) counts[row.session_id] = row.booked_count
      setDropinCounts(counts)
    }
    load()
  }, [])

  // Expand multi-day classes (e.g. Tue+Thu) into one row per day, sort & filter.
  const weekRows = useMemo(() => {
    const rows = []
    for (const c of classes) {
      const days = normalizeDays(c.day_of_week)
      if (days.length === 0) rows.push({ ...c, _day: '' })
      else for (const d of days) rows.push({ ...c, _day: d })
    }
    rows.sort((a, b) => {
      const di = DAY_ORDER.indexOf(a._day) - DAY_ORDER.indexOf(b._day)
      if (di !== 0) return di
      return startMinutes(a.start_time) - startMinutes(b.start_time)
    })
    return rows
  }, [classes])

  const todayName = DAY_ORDER[(new Date().getDay() + 6) % 7]
  const todayClasses = useMemo(
    () => weekRows.filter(r => r._day === todayName),
    [weekRows, todayName]
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

  const firstName = (staff.full_name || '').split(' ')[0] || 'there'
  const isAdmin   = staff.role === 'admin'

  const todayDropinBookings = todayDropins.reduce(
    (sum, s) => sum + (dropinCounts[s.id] || 0),
    0
  )

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={isAdmin} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">
              {greeting()}, {firstName}
            </p>
            {currentTerm && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#325099]" />
                {formatTermLabel(currentTerm)}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white bg-[#062E63] px-2.5 py-1 rounded-full uppercase tracking-widest">
              {isAdmin ? 'Admin' : 'Tutor'}
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Teacher portal
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            Your home for today's drop-ins, class queues, and student progress.
          </p>

          {/* Stat strip */}
          <div className="grid grid-cols-3 gap-3 mt-8 max-w-2xl">
            <StatTile label="Today" value={todayClasses.length} suffix={`class${todayClasses.length === 1 ? '' : 'es'}`} />
            <StatTile label="Drop-ins today" value={todayDropins.length} suffix={`session${todayDropins.length === 1 ? '' : 's'}`} />
            <StatTile label="This week" value={weekRows.length} suffix={`class${weekRows.length === 1 ? '' : 'es'}`} />
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {/* Quick-action cards — now with live counts + links */}
        <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-4 font-display">
          Jump in
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          <ActionCard
            href="/tutor/dropin"
            emoji="📋"
            accent="#DEE7FF"
            label="Today's drop-ins"
            desc={
              todayDropins.length === 0
                ? 'No sessions today'
                : `${todayDropins.length} session${todayDropins.length === 1 ? '' : 's'} · ${todayDropinBookings} student${todayDropinBookings === 1 ? '' : 's'} booked`
            }
          />
          <ActionCard
            href="/tutor/classes"
            emoji="🎓"
            accent="#FEF3C7"
            label="My classes"
            desc={
              weekRows.length === 0
                ? 'No classes assigned yet'
                : `${weekRows.length} this week · ${Object.values(enrollmentCounts).reduce((a, b) => a + b, 0)} student spots`
            }
          />
          <ActionCard
            href="#"
            emoji="✅"
            accent="#D1FAE5"
            label="Mark attendance"
            desc="Tick present/late/absent per class · Phase 4"
            comingSoon
          />
        </div>

        {/* MAIN ROW — today */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          {/* Today's classes */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                  Today
                </p>
                <h2 className="text-lg font-semibold text-[#2A2035] font-display">
                  {todayName}'s classes
                </h2>
              </div>
              <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
                {todayClasses.length} scheduled
              </span>
            </div>
            {todayClasses.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-2">🎉</div>
                <p className="text-sm font-semibold text-[#2A2035]">No classes today.</p>
                <p className="text-xs text-[#2A2035]/50 mt-1">Day off — make it count.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayClasses.map((c, i) => (
                  <Link
                    key={`${c.id}-${i}`}
                    href="/tutor/classes"
                    className="flex items-center gap-3 rounded-xl px-4 py-3 border border-[#DEE7FF] bg-[#F8FAFF] hover:border-[#BACBFF] hover:bg-white transition group"
                  >
                    <div className="w-1 h-10 rounded-full shrink-0 bg-[#062E63]" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-[#2A2035]">
                        {(c.class_name && c.class_name.trim()) || 'Untitled class'}
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-[#2A2035]/60">
                        <span>🕐 {fmtTime(c.start_time)}–{fmtTime(c.end_time)}</span>
                        {c.room && <span>📍 {c.room}</span>}
                        <span>👥 {enrollmentCounts[c.id] || 0} student{enrollmentCounts[c.id] === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <span className="text-[#325099] transition-transform group-hover:translate-x-0.5">→</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Today's drop-ins */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                  Today
                </p>
                <h2 className="text-lg font-semibold text-[#2A2035] font-display">
                  Drop-in sessions
                </h2>
              </div>
              <Link
                href="/tutor/dropin"
                className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63] tracking-wide"
              >
                See all →
              </Link>
            </div>
            {todayDropins.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-2">☕</div>
                <p className="text-sm font-semibold text-[#2A2035]">No drop-in today.</p>
                <p className="text-xs text-[#2A2035]/50 mt-1">Enjoy the quiet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayDropins.map(s => {
                  const cap = s.max_capacity || 5
                  const count = dropinCounts[s.id] || 0
                  const full = count >= cap
                  return (
                    <Link
                      key={s.id}
                      href="/tutor/dropin"
                      className="flex items-center gap-3 rounded-xl px-4 py-3 border border-[#DEE7FF] bg-[#F8FAFF] hover:border-[#BACBFF] hover:bg-white transition group"
                    >
                      <div className="w-1 h-10 rounded-full shrink-0 bg-[#10b981]" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-[#2A2035] tabular-nums">
                          {fmtSessionTime(s.start_time)}–{fmtSessionTime(s.end_time)}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-[#2A2035]/60">
                          <span>📍 {s.location || 'Chatswood centre'}</span>
                          {s.tutors && s.tutors.length > 0 && <span>👤 {s.tutors.join(', ')}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span className={`text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full ${
                          count === 0
                            ? 'bg-[#F4F4F4] text-[#9CA3AF]'
                            : full
                            ? 'bg-[#FEE2E2] text-[#991B1B]'
                            : 'bg-[#DEE7FF] text-[#062E63]'
                        }`}>
                          {count}/{cap}
                        </span>
                        <span className="text-[#325099] transition-transform group-hover:translate-x-0.5 mt-0.5">→</span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
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

// ── Small components ───────────────────────────────────────────────────────

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

function ActionCard({ href, emoji, accent, label, desc, comingSoon }) {
  const inner = (
    <>
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
        style={{ background: accent }}
      >
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[#2A2035] font-display flex items-center gap-2">
          {label}
          {comingSoon && (
            <span className="text-[9px] font-bold tracking-widest uppercase bg-[#FEF3C7] text-[#92400E] px-1.5 py-0.5 rounded-full border border-[#FDE68A]">
              Soon
            </span>
          )}
        </p>
        <p className="text-xs text-[#2A2035]/50 mt-0.5">{desc}</p>
      </div>
      {!comingSoon && (
        <span className="text-[#325099] transition-transform group-hover:translate-x-0.5">→</span>
      )}
    </>
  )

  if (comingSoon) {
    return (
      <div className="group bg-white rounded-2xl border border-[#DEE7FF] p-5 flex items-center gap-4 opacity-80">
        {inner}
      </div>
    )
  }
  return (
    <Link
      href={href}
      className="group bg-white rounded-2xl border border-[#DEE7FF] p-5 flex items-center gap-4 hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition"
    >
      {inner}
    </Link>
  )
}

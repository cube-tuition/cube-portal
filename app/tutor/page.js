'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getAuthProfile } from '../../lib/getProfile'
import TutorNav from '../../components/TutorNav'
import { normalizeDays, fmtTime, isoDate } from '../../lib/format'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../lib/terms'
import { T_ATTENDANCE, T_CLASSES, T_ENROLMENTS, T_LESSONS } from '../../lib/tables'
import { buildClassLabelMap } from '../../lib/classLabels'
import ActionCentre from '../../components/ActionCentre'
import TrialFunnel from '../../components/home/TrialFunnel'
import CapacityBoard from '../../components/home/CapacityBoard'
import AtRiskWatchlist from '../../components/home/AtRiskWatchlist'
import CommandPalette from '../../components/home/CommandPalette'

/*
 * Tutor portal — landing page
 * ─────────────────────────────────────────────────────────────────────────────
 * Hero with today/this-week/this-fortnight stats. Two quick-action cards
 * (My classes + My pay / Payroll). Lower panel: today's classes alongside
 * this fortnight's pay summary.
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

// start_time / end_time are stored as PostgreSQL time (HH:MM:SS), 24-hour.
function startMinutes(t) {
  if (!t) return 99999
  const [hRaw, mRaw] = String(t).split(':')
  const h = parseInt(hRaw, 10)
  const m = parseInt(mRaw || '0', 10) || 0
  if (Number.isNaN(h)) return 99999
  return h * 60 + m
}
export default function TutorHome() {
  const [staff, setStaff] = useState(null)
  const [currentTerm, setCurrentTerm] = useState(null)
  const [classes, setClasses] = useState([])
  const [enrollmentCounts, setEnrollmentCounts] = useState({})
  const [unsavedSessions, setUnsavedSessions] = useState([])
  // (Admin unsaved-session tracking moved to /tutor/unsaved-sessions)
  const [authErr, setAuthErr] = useState(null)
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile) { setAuthErr('No profile found'); return }
      if (profile.role !== 'tutor' && profile.role !== 'admin') {
        router.push('/dashboard')
        return
      }
      setStaff(profile)

      const terms = await fetchAllTerms()
      setCurrentTerm(getCurrentTerm(terms))

      // Classes — admin sees all, tutor sees their own:
      //   1. Classes where they are the main teacher (matched by first name)
      //   2. Classes where they are scheduled_teacher_id on any lesson this term
      const isAdmin = profile.role === 'admin'
      const firstName = (profile.full_name || '').split(' ')[0]
      let primaryClasses = []
      if (isAdmin) {
        const { data } = await supabase.from(T_CLASSES).select('*')
        primaryClasses = data || []
      } else {
        // Fetch by main teacher name
        const { data: ownCls } = await supabase
          .from(T_CLASSES).select('*').ilike('teacher', firstName + '%')
        primaryClasses = ownCls || []

        // Also fetch classes where this tutor is a scheduled_teacher this term
        const term = getCurrentTerm(terms)
        if (term) {
          const { data: subLessons } = await supabase
            .from(T_LESSONS)
            .select('class_id')
            .eq('scheduled_teacher_id', user.id)
            .gte('lesson_date', term.start_date)
            .lte('lesson_date', term.end_date)
          const subClassIds = [...new Set((subLessons || []).map(l => l.class_id))]
          // Exclude class IDs already in primaryClasses
          const existingIds = new Set(primaryClasses.map(c => c.id))
          const extraIds = subClassIds.filter(id => !existingIds.has(id))
          if (extraIds.length > 0) {
            const { data: extraCls } = await supabase
              .from(T_CLASSES).select('*').in('id', extraIds)
            primaryClasses = [...primaryClasses, ...(extraCls || [])]
          }
        }
      }
      setClasses(primaryClasses)

      // Enrollment counts — single round trip via `enrolments`.
      const ids = primaryClasses.map(c => c.id)
      if (ids.length > 0) {
        const { data: links } = await supabase
          .from(T_ENROLMENTS)
          .select('class_id')
          .in('class_id', ids)
        const counts = {}
        for (const l of links || []) counts[l.class_id] = (counts[l.class_id] || 0) + 1
        setEnrollmentCounts(counts)
      }

      // Unsaved-session checks moved to /tutor/unsaved-sessions (linked from
      // the Action Centre's attendance row).
      const term = getCurrentTerm(terms)

      // Unsaved sessions — tutors only (not admin)
      if (!isAdmin && term && primaryClasses.length > 0) {
        const now = new Date()
        const todayIso = isoDate(now)
        const nowMinutes = now.getHours() * 60 + now.getMinutes()

        // Build list of expected past session dates per class
        const candidates = [] // { classId, dateIso, class_name, start_time, end_time }
        for (const c of primaryClasses) {
          const days = normalizeDays(c.day_of_week)
          if (days.length === 0) continue
          const termStart = new Date(term.start_date + 'T00:00:00')
          const termEnd   = new Date(term.end_date   + 'T00:00:00')
          const cursor    = new Date(termStart)
          while (cursor <= termEnd) {
            const curIso = isoDate(cursor)
            if (curIso > todayIso) break
            const curDay = DAY_ORDER[(cursor.getDay() + 6) % 7]
            if (days.includes(curDay)) {
              // For today, only flag if current time is past end_time
              if (curIso === todayIso) {
                const endMins = startMinutes(c.end_time) // reuses existing helper
                if (nowMinutes <= endMins) { cursor.setDate(cursor.getDate() + 1); continue }
              }
              candidates.push({ classId: c.id, dateIso: curIso, class_name: c.class_name, start_time: c.start_time, end_time: c.end_time })
            }
            cursor.setDate(cursor.getDate() + 1)
          }
        }

        if (candidates.length > 0) {
          // Fetch all attendance rows for these class+date combos in one query
          // by fetching all attendance within term range for these classes.
          const classIds = [...new Set(candidates.map(c => c.classId))]
          const { data: attRows } = await supabase
            .from(T_ATTENDANCE)
            .select('class_id, session_date')
            .in('class_id', classIds)
            .gte('session_date', term.start_date)
            .lte('session_date', todayIso)
          const savedSet = new Set((attRows || []).map(r => `${r.class_id}|${r.session_date}`))
          const missing = candidates.filter(c => !savedSet.has(`${c.classId}|${c.dateIso}`))
          setUnsavedSessions(missing)
        }
      }
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

  const classLabelMap = useMemo(() => buildClassLabelMap(classes), [classes])

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

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={isAdmin} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <div className="flex flex-col lg:flex-row lg:items-center gap-10">
            <div className="flex-1 min-w-0">
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
                  {isAdmin ? 'Director' : 'Tutor'}
                </span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
                {isAdmin ? 'Director Portal' : 'Tutor portal'}
              </h1>
              <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
                Your home for class queues, attendance, and pay.
              </p>

              {isAdmin && (
                <button
                  onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
                  className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-[#325099] bg-white/70 hover:bg-white border border-[#DEE7FF] rounded-full pl-3 pr-2 py-1.5 transition"
                  title="Search students, classes and invoices"
                >
                  🔍 Quick search
                  <kbd className="text-[10px] font-semibold bg-[#EEF4FF] border border-[#DEE7FF] rounded px-1.5 py-0.5">⌘K</kbd>
                </button>
              )}

              {/* Stat strip */}
              <div className="grid grid-cols-2 gap-3 mt-8 max-w-sm">
                <StatTile label="Today" value={todayClasses.length} suffix={`class${todayClasses.length === 1 ? '' : 'es'}`} />
                <StatTile label="This week" value={weekRows.length} suffix={`class${weekRows.length === 1 ? '' : 'es'}`} />
              </div>
            </div>

            {/* Today's classes — in-banner panel (directors) */}
            {isAdmin && (
              <div className="w-full lg:w-[400px] shrink-0">
                <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#DEE7FF]/60">
                    <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">
                      Today · {todayName}
                    </p>
                    <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
                      {todayClasses.length} class{todayClasses.length === 1 ? '' : 'es'}
                    </span>
                  </div>
                  {todayClasses.length === 0 ? (
                    <p className="px-5 py-6 text-xs text-[#2A2035]/50 text-center">🎉 No classes today.</p>
                  ) : (
                    <div className="divide-y divide-[#DEE7FF]/50 max-h-64 overflow-y-auto">
                      {todayClasses.map((c, i) => (
                        <Link key={`${c.id}-${i}`} href={`/tutor/classes/${c.id}`}
                          className="flex items-center gap-3 px-5 py-2.5 hover:bg-white transition group">
                          <span className="text-[11px] font-bold text-[#062E63] tabular-nums w-28 shrink-0 whitespace-nowrap">
                            {fmtTime(c.start_time)}–{fmtTime(c.end_time)}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs font-semibold text-[#2A2035] truncate">
                              {(classLabelMap.get(c.id) || c.class_name || 'Untitled class')}
                            </span>
                            <span className="block text-[10px] text-[#2A2035]/50">
                              {c.room ? `📍 ${c.room} · ` : ''}👥 {enrollmentCounts[c.id] || 0}
                            </span>
                          </span>
                          <span className="text-[#325099] text-xs transition-transform group-hover:translate-x-0.5">→</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {/* Action Centre — directors only (gated here too, so the tutor page
            doesn't even mount it or run its checks) */}
        {isAdmin && <ActionCentre authorized />}

        {/* Director insight widgets — pipeline, capacity, retention */}
        {isAdmin && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
            <TrialFunnel />
            <CapacityBoard classes={classes} currentTermId={currentTerm?.id} classLabelMap={classLabelMap} />
            <AtRiskWatchlist currentTerm={currentTerm} />
          </div>
        )}

        {/* MAIN ROW — tutors only: today's classes + to-do.
            (Directors see today's classes in the banner and tasks in the Action Centre.) */}
        {!isAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          {/* Today's classes */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                  Today
                </p>
                <h2 className="text-lg font-semibold text-[#2A2035] font-display">
                  {todayName}&rsquo;s classes
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
                    href={`/tutor/classes/${c.id}`}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 border border-[#DEE7FF] bg-[#F8FAFF] hover:border-[#BACBFF] hover:bg-white transition group"
                  >
                    <div className="w-1 h-10 rounded-full shrink-0 bg-[#062E63]" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-[#2A2035]">
                        {(classLabelMap.get(c.id) || c.class_name || 'Untitled class')}
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

          {/* To-do list — tutors only. Admin actionables live in the Action
              Centre; unsaved sessions have their own page. */}
          {!isAdmin && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            {(
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                      Tasks
                    </p>
                    <h2 className="text-lg font-semibold text-[#2A2035] font-display">
                      To-do
                    </h2>
                  </div>
                  {unsavedSessions.length > 0 && (
                    <span className="text-[10px] tracking-widest uppercase font-semibold text-[#B23A3A]">
                      {unsavedSessions.length} unsaved
                    </span>
                  )}
                </div>
                {unsavedSessions.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-4xl mb-2">✅</div>
                    <p className="text-sm font-semibold text-[#2A2035]">All caught up.</p>
                    <p className="text-xs text-[#2A2035]/50 mt-1">No outstanding tasks.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {unsavedSessions.map((s, i) => (
                      <UnsavedSessionCard key={`${s.classId}-${s.dateIso}-${i}`} s={s} fmtTime={fmtTime} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          )}

        </div>
        )}
      </section>

      {isAdmin && <CommandPalette />}

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

function UnsavedSessionCard({ s, fmtTime }) {
  const d = new Date(s.dateIso + 'T00:00:00')
  const dateLabel = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <Link
      href={`/tutor/classes/${s.classId}/${s.dateIso}`}
      className="flex items-start gap-3 rounded-xl px-4 py-3 border border-[#FDE8E8] bg-[#FFF5F5] hover:border-[#F4A0A0] hover:bg-white transition group"
    >
      <div className="w-1 h-10 rounded-full shrink-0 bg-[#B23A3A] mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-[#2A2035]">Save session</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-[#2A2035]/60">
          <span>{s.class_name || 'Untitled class'}</span>
          <span>📅 {dateLabel}</span>
          <span>🕐 {fmtTime(s.start_time)}–{fmtTime(s.end_time)}</span>
        </div>
      </div>
      <span className="text-[#B23A3A] transition-transform group-hover:translate-x-0.5 mt-0.5">→</span>
    </Link>
  )
}


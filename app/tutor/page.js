'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getAuthProfile } from '../../lib/getProfile'
import TutorNav from '../../components/TutorNav'
import { normalizeDays } from '../../lib/format'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../lib/terms'
import { T_ATTENDANCE, T_CLASSES, T_ENROLMENTS, T_LESSONS, T_SHIFTS } from '../../lib/tables'
import { buildClassLabelMap } from '../../lib/classLabels'

/*
 * Tutor portal — landing page
 * ─────────────────────────────────────────────────────────────────────────────
 * Hero with today/this-week/this-fortnight stats. Two quick-action cards
 * (My classes + My pay / Payroll). Lower panel: today's classes alongside
 * this fortnight's pay summary.
 */

const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const PAY_ANCHOR = '2026-05-18'  // must match SQL pay_period_for() and /tutor/pay

// Pay period containing the given ISO date — mirrors SQL pay_period_for().
function payPeriod(dateIso) {
  const a = new Date(PAY_ANCHOR + 'T00:00:00')
  const d = new Date(dateIso + 'T00:00:00')
  const diffDays = Math.floor((d - a) / 86400000)
  const n = Math.floor(diffDays / 14)
  const start = new Date(a); start.setDate(a.getDate() + n * 14)
  const end   = new Date(start); end.setDate(start.getDate() + 13)
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`
  return { start: iso(start), end: iso(end) }
}
const fmtPeriodLabel = (p) => {
  const d = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  return `${d(p.start)} – ${d(p.end)}`
}
const fmtMoney = (n) => '$' + (Number(n) || 0).toFixed(2)

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

// start_time / end_time are stored as PostgreSQL time (HH:MM:SS), 24-hour.
function startMinutes(t) {
  if (!t) return 99999
  const [hRaw, mRaw] = String(t).split(':')
  const h = parseInt(hRaw, 10)
  const m = parseInt(mRaw || '0', 10) || 0
  if (Number.isNaN(h)) return 99999
  return h * 60 + m
}
function fmtTime(t) {
  if (!t) return ''
  const [hRaw, mRaw] = String(t).split(':')
  let h = parseInt(hRaw, 10)
  const m = (mRaw || '00').padStart(2, '0')
  if (Number.isNaN(h)) return t
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h === 0 ? 12 : (h > 12 ? h - 12 : h)
  return `${hr}:${m}${ampm}`
}
export default function TutorHome() {
  const [staff, setStaff] = useState(null)
  const [currentTerm, setCurrentTerm] = useState(null)
  const [classes, setClasses] = useState([])
  const [enrollmentCounts, setEnrollmentCounts] = useState({})
  const [period, setPeriod] = useState(() => payPeriod(isoDate(new Date())))
  // Shifts in the current pay period — scope depends on role:
  //   tutor: own shifts only (RLS enforces)
  //   admin: all shifts in the period
  const [shifts, setShifts] = useState([])
  const [unsavedSessions, setUnsavedSessions] = useState([])
  // Admin to-do: unsaved sessions grouped by tutor first name
  const [adminUnsaved, setAdminUnsaved] = useState({}) // { 'Amber': [...], 'Daniel': [...] }
  const [selectedTutor, setSelectedTutor] = useState('All')
  const [completedTrials, setCompletedTrials] = useState([]) // [{ studentName, className, classId, enrolmentId, trialStartDate, lessonDates, parentEmail }]
  const [emailModal, setEmailModal] = useState(null) // trial object when open
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

      // This fortnight's shifts. Tutor sees only own (RLS); admin sees all.
      const currentPeriod = payPeriod(isoDate(new Date()))
      setPeriod(currentPeriod)
      let sq = supabase
        .from(T_SHIFTS)
        .select('id, tutor_id, work_date, start_time, end_time, hours, rate_snapshot, kind, status, notes')
        .gte('work_date', currentPeriod.start)
        .lte('work_date', currentPeriod.end)
        .order('work_date')
      if (!isAdmin) sq = sq.eq('tutor_id', user.id)
      const { data: sh } = await sq
      setShifts(sh || [])

      // Admin to-do: unsaved sessions for all tutors (excluding Aiden & Ryan)
      const term = getCurrentTerm(terms)
      if (isAdmin && term && primaryClasses.length > 0) {
        const EXCLUDED = ['aiden', 'ryan']
        const now = new Date()
        const todayIso = isoDate(now)
        const nowMinutes = now.getHours() * 60 + now.getMinutes()

        // Group classes by teacher first name (exclude Aiden/Ryan)
        const byTeacher = {}
        for (const c of primaryClasses) {
          const teacher = (c.teacher || '').trim()
          if (!teacher) continue
          const first = teacher.split(' ')[0]
          if (EXCLUDED.includes(first.toLowerCase())) continue
          if (!byTeacher[first]) byTeacher[first] = []
          byTeacher[first].push(c)
        }

        // Generate all expected past session dates per teacher
        const candidates = [] // { teacher, classId, dateIso, class_name, start_time, end_time }
        for (const [teacher, tClasses] of Object.entries(byTeacher)) {
          for (const c of tClasses) {
            const days = normalizeDays(c.day_of_week)
            if (days.length === 0) continue
            const cursor = new Date(term.start_date + 'T00:00:00')
            const termEnd = new Date(term.end_date + 'T00:00:00')
            while (cursor <= termEnd) {
              const curIso = isoDate(cursor)
              if (curIso > todayIso) break
              const curDay = DAY_ORDER[(cursor.getDay() + 6) % 7]
              if (days.includes(curDay)) {
                if (curIso === todayIso) {
                  const endMins = startMinutes(c.end_time)
                  if (nowMinutes <= endMins) { cursor.setDate(cursor.getDate() + 1); continue }
                }
                candidates.push({ teacher, classId: c.id, dateIso: curIso, class_name: c.class_name, start_time: c.start_time, end_time: c.end_time })
              }
              cursor.setDate(cursor.getDate() + 1)
            }
          }
        }

        if (candidates.length > 0) {
          const classIds = [...new Set(candidates.map(c => c.classId))]
          const { data: attRows } = await supabase
            .from(T_ATTENDANCE)
            .select('class_id, session_date')
            .in('class_id', classIds)
            .gte('session_date', term.start_date)
            .lte('session_date', todayIso)
          const savedSet = new Set((attRows || []).map(r => `${r.class_id}|${r.session_date}`))
          const missing = candidates.filter(c => !savedSet.has(`${c.classId}|${c.dateIso}`))

          // Group by teacher
          const grouped = {}
          for (const s of missing) {
            if (!grouped[s.teacher]) grouped[s.teacher] = []
            grouped[s.teacher].push(s)
          }
          setAdminUnsaved(grouped)
        }

        // Completed trials — enrolments with status='trial', trial_start_date set,
        // and 2+ attended (present/late) sessions since trial_start_date.
        const { data: trialEnrolments } = await supabase
          .from(T_ENROLMENTS)
          .select('id, class_id, trial_start_date, students(id, full_name, email), classes(class_name)')
          .eq('status', 'trial')
          .not('trial_start_date', 'is', null)
        if (trialEnrolments && trialEnrolments.length > 0) {
          const todayIso = isoDate(new Date())
          const finished = []
          for (const enr of trialEnrolments) {
            const studentId = enr.students?.id
            if (!studentId) continue
            const { data: attRows } = await supabase
              .from(T_ATTENDANCE)
              .select('session_date')
              .eq('class_id', enr.class_id)
              .eq('student_id', studentId)
              .in('status', ['present', 'late'])
              .gte('session_date', enr.trial_start_date)
              .lte('session_date', todayIso)
              .order('session_date')
            if ((attRows || []).length >= 2) {
              finished.push({
                enrolmentId: enr.id,
                classId: enr.class_id,
                studentId: enr.students?.id,
                className: enr.classes?.class_name || 'Class',
                studentName: enr.students?.full_name || 'Student',
                trialStartDate: enr.trial_start_date,
                lessonDates: attRows.slice(0, 2).map(r => r.session_date),
                parentEmail: enr.students?.email || '',
              })
            }
          }
          setCompletedTrials(finished)
        }
      }

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

  // Pay-period totals (own for tutor, everyone for admin)
  const periodHours = shifts.reduce((sum, s) => sum + Number(s.hours || 0), 0)
  const periodAmount = shifts.reduce(
    (sum, s) => sum + Number(s.hours || 0) * Number(s.rate_snapshot || 0),
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
            Tutor portal
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            Your home for class queues, attendance, and pay.
          </p>

          {/* Stat strip */}
          <div className="grid grid-cols-2 gap-3 mt-8 max-w-sm">
            <StatTile label="Today" value={todayClasses.length} suffix={`class${todayClasses.length === 1 ? '' : 'es'}`} />
            <StatTile label="This week" value={weekRows.length} suffix={`class${weekRows.length === 1 ? '' : 'es'}`} />
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {/* MAIN ROW — today's classes + to-do */}
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

          {/* To-do list */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            {isAdmin ? (
              <AdminTodoPanel
                adminUnsaved={adminUnsaved}
                selectedTutor={selectedTutor}
                setSelectedTutor={setSelectedTutor}
                fmtTime={fmtTime}
                completedTrials={completedTrials}
                onEmailClick={(trial) => setEmailModal(trial)}
              />
            ) : (
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

        </div>
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">
            © CUBE Tuition · Chatswood
          </p>
        </div>
      </footer>

      {/* Trial completion email modal */}
      {emailModal && (
        <TrialEmailModal trial={emailModal} onClose={() => setEmailModal(null)} />
      )}
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

// Compact tile used inside the "This fortnight" panel.
function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-white px-3 py-2">
      <p className="text-[9px] tracking-[0.2em] uppercase text-[#325099]/80 font-semibold">{label}</p>
      <p className="text-base font-bold text-[#2A2035] font-display tabular-nums">{value}</p>
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

function AdminTodoPanel({ adminUnsaved, selectedTutor, setSelectedTutor, fmtTime, completedTrials = [], onEmailClick }) {
  const tutors = Object.keys(adminUnsaved).sort()
  const totalUnsaved = Object.values(adminUnsaved).reduce((a, b) => a + b.length, 0)

  const visibleSessions = selectedTutor === 'All'
    ? Object.entries(adminUnsaved).flatMap(([teacher, sessions]) => sessions.map(s => ({ ...s, teacher })))
    : (adminUnsaved[selectedTutor] || []).map(s => ({ ...s, teacher: selectedTutor }))

  visibleSessions.sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.class_name.localeCompare(b.class_name))

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
            Tutor tasks
          </p>
          <h2 className="text-lg font-semibold text-[#2A2035] font-display">Unsaved sessions</h2>
        </div>
        <div className="flex items-center gap-3">
          {totalUnsaved > 0 && (
            <span className="text-[10px] tracking-widest uppercase font-semibold text-[#B23A3A]">
              {totalUnsaved} unsaved
            </span>
          )}
          {tutors.length > 0 && (
            <select
              value={selectedTutor}
              onChange={e => setSelectedTutor(e.target.value)}
              className="text-xs font-semibold text-[#2A2035] bg-[#F8FAFF] border border-[#DEE7FF] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#325099]"
            >
              <option value="All">All tutors</option>
              {tutors.map(t => (
                <option key={t} value={t}>{t} ({(adminUnsaved[t] || []).length})</option>
              ))}
            </select>
          )}
        </div>
      </div>
      {completedTrials.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-2 font-display">
            Trial completions — {completedTrials.length}
          </p>
          <div className="space-y-2">
            {completedTrials.map((t, i) => {
              const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
              return (
                <div key={`${t.enrolmentId}-${i}`} className="flex items-start gap-3 rounded-xl px-4 py-3 border border-[#BFDBFE] bg-[#EFF6FF]">
                  <div className="w-1 h-10 rounded-full shrink-0 bg-[#2563EB] mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-[#2A2035]">{t.studentName}</p>
                      <span className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[#DBEAFE] text-[#1D4ED8]">trial complete</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-[#2A2035]/60">
                      <span>{t.className}</span>
                      <span>📅 {fmt(t.lessonDates[0])} &amp; {fmt(t.lessonDates[1])}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onEmailClick(t)}
                    className="shrink-0 text-[10px] font-bold tracking-wide uppercase px-2.5 py-1.5 rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition"
                  >
                    Email ✉
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {visibleSessions.length === 0 && completedTrials.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">✅</div>
          <p className="text-sm font-semibold text-[#2A2035]">All caught up.</p>
          <p className="text-xs text-[#2A2035]/50 mt-1">No unsaved sessions.</p>
        </div>
      ) : visibleSessions.length > 0 ? (
        <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
          {visibleSessions.map((s, i) => (
            <div key={`${s.classId}-${s.dateIso}-${i}`} className="flex items-start gap-3 rounded-xl px-4 py-3 border border-[#FDE8E8] bg-[#FFF5F5]">
              <div className="w-1 h-10 rounded-full shrink-0 bg-[#B23A3A] mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-[#2A2035]">{s.teacher}</p>
                  <span className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[#FEE2E2] text-[#B23A3A]">unsaved</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-[#2A2035]/60">
                  <span>{s.class_name || 'Untitled class'}</span>
                  <span>📅 {new Date(s.dateIso + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span>🕐 {fmtTime(s.start_time)}–{fmtTime(s.end_time)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

function TrialEmailModal({ trial, onClose }) {
  const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  const subject = `CUBE Tuition — ${trial.studentName}'s Trial Has Concluded`

  const [rawFeedbacks, setRawFeedbacks] = useState([]) // [{ date, text }]
  const [copied, setCopied] = useState(false)

  // Fetch trial_feedback from attendance on mount
  useEffect(() => {
    if (!trial.classId || !trial.studentId || !trial.lessonDates?.length) return
    supabase
      .from('attendance')
      .select('session_date, trial_feedback')
      .eq('class_id', trial.classId)
      .eq('student_id', trial.studentId)
      .in('session_date', trial.lessonDates)
      .then(({ data }) => {
        if (!data) return
        // Sort to match lessonDates order
        const sorted = trial.lessonDates.map(d => {
          const row = data.find(r => r.session_date === d)
          return { date: d, text: row?.trial_feedback || '' }
        })
        setRawFeedbacks(sorted)
      })
  }, [trial.classId, trial.studentId, trial.lessonDates])

  const hasFeedback = rawFeedbacks.some(f => f.text.trim())

  const feedbackSection = hasFeedback
    ? `\n\nHere is some feedback from your child's tutor:\n\n${rawFeedbacks.filter(f => f.text).map((f, i) => `Session ${i + 1} (${fmt(f.date)}): ${f.text}`).join('\n')}`
    : ''

  const body = `Dear Parent/Guardian,

We hope this message finds you well.

We're writing to let you know that ${trial.studentName}'s two-lesson trial for ${trial.className} at CUBE Tuition has now been completed (lessons on ${fmt(trial.lessonDates[0])} and ${fmt(trial.lessonDates[1])}).${feedbackSection}

We hope ${trial.studentName} enjoyed the sessions and found them beneficial. We would love to have them continue as a regular student!

If you'd like to officially enrol ${trial.studentName}, please don't hesitate to get in touch with us. We're happy to answer any questions about the program, schedule, or pricing.

Warm regards,
The CUBE Tuition Team
📍 Chatswood
📧 admin@cubetuition.com.au`

  const copy = () => {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DEE7FF]">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">Trial complete</p>
            <h2 className="text-base font-semibold text-[#2A2035] font-display">{trial.studentName} — {trial.className}</h2>
          </div>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-xl transition">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">To</p>
            <p className="text-sm text-[#2A2035] bg-[#F8FAFF] border border-[#DEE7FF] rounded-lg px-3 py-2">{trial.parentEmail || '— no email on file —'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Subject</p>
            <p className="text-sm text-[#2A2035] bg-[#F8FAFF] border border-[#DEE7FF] rounded-lg px-3 py-2">{subject}</p>
          </div>

          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Body</p>
            <pre className="text-sm text-[#2A2035] bg-[#F8FAFF] border border-[#DEE7FF] rounded-lg px-4 py-3 whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-[#DEE7FF] flex justify-end gap-3">
          <button onClick={onClose} className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035] px-4 py-2 transition">Close</button>
          <button onClick={copy} className="text-xs font-bold px-5 py-2 rounded-xl bg-[#062E63] text-white hover:bg-[#325099] transition">
            {copied ? '✓ Copied!' : 'Copy to clipboard'}
          </button>
        </div>
      </div>
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

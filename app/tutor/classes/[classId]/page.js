'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import SessionMarker from '../../../../components/SessionMarker'
import WeekBooklet from '../../../../components/WeekBooklet'
import { normalizeDays } from '../../../../lib/format'
import { fetchAllTerms, getCurrentTerm } from '../../../../lib/terms'
import { inferSubject, subjectColor, subjectsMatch } from '../../../../components/CourseDetail'
import PrePostSection from '../../../../components/PrePostSection'
import { T_ATTENDANCE, T_CLASSES, T_ENROLMENTS, T_QUIZ_RESULTS, T_SHIFTS, T_SUB_ASSIGNMENTS } from '../../../../lib/tables'

/*
 * Per-class overview — /tutor/classes/[classId]
 * ─────────────────────────────────────────────────────────────────────────────
 * Top: class meta (name, time, room, teacher).
 * Tabs: Wk 1–10 of the current term. Each tab shows a summary view of that
 * week's session: attendance breakdown, RQ average, HW completion, and a
 * "Mark this session →" button that opens the full marking page.
 */

const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const DAY_SHORT = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat', Sunday:'Sun' }
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtTime(t) {
  if (!t) return ''
  const [hRaw, mRaw] = String(t).split(':')
  let h = parseInt(hRaw, 10)
  const m = (mRaw || '00').padStart(2, '0')
  if (Number.isNaN(h)) return t
  const ampm = (h >= 1 && h <= 7) ? 'pm' : (h >= 8 && h <= 11) ? 'am' : (h === 12 ? 'pm' : 'am')
  return `${h}:${m}${ampm}`
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function isoToDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number)
  if (!y) return null
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}
function fmtDate(iso) {
  const d = isoToDate(iso)
  if (!d) return '—'
  return `${DAY_SHORT[DAY_ORDER[(d.getDay()+6)%7]]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
}

// Given the term and the class's day_of_week list, compute the session date
// for each of the 10 weeks. Each week's date = first matching weekday at or
// after (term.start_date + (week-1)*7).
function weeklySessionDates(term, daysList) {
  if (!term || !daysList || daysList.length === 0) return []
  const out = []
  for (let w = 1; w <= 10; w++) {
    const weekStart = isoToDate(term.start_date)
    weekStart.setDate(weekStart.getDate() + (w - 1) * 7)
    // For each weekday this class runs, find the matching date in this week
    const matches = []
    for (let off = 0; off < 7; off++) {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + off)
      const dn = DAY_ORDER[(d.getDay() + 6) % 7]
      if (daysList.includes(dn)) matches.push(isoDate(d))
    }
    out.push({ week: w, dates: matches })
  }
  return out
}

export default function ClassOverviewPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const classId = params?.classId

  // Allow ?week=N to pre-select a tab (e.g. when linking from the weekly calendar)
  const weekParam = parseInt(searchParams?.get('week') || '', 10)
  const initialTab = weekParam >= 1 && weekParam <= 10 ? weekParam
    : searchParams?.get('tab') === 'prepost' ? 'prepost'
    : 1

  const [staff, setStaff] = useState(null)
  const [cls, setCls] = useState(null)
  const [term, setTerm] = useState(null)
  const [roster, setRoster] = useState([])
  const [attendance, setAttendance] = useState([])     // all rows for this class, this term
  const [quizzes, setQuizzes] = useState([])           // all rows for roster+subject, this term
  const [allStaff, setAllStaff] = useState([])         // all tutors/admins for sub dropdown
  const [subAssignments, setSubAssignments] = useState({}) // { [dateISO]: { id, sub_tutor_id } }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState(initialTab)           // 1..10

  useEffect(() => {
    (async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile) { setError('No profile found.'); setLoading(false); return }
      if (profile.role !== 'tutor' && profile.role !== 'admin') {
        router.push('/dashboard'); return
      }
      setStaff(profile)

      if (!classId) { setError('Missing class id.'); setLoading(false); return }

      const { data: row, error: clsErr } = await supabase
        .from(T_CLASSES).select('*').eq('id', classId).single()
      if (clsErr || !row) { setError('Class not found.'); setLoading(false); return }

      // Access check: admin → always OK; regular teacher → OK;
      // sub teacher → OK if they have a sub_assignment for this class.
      const isAdmin = profile.role === 'admin'
      const firstName = (profile.full_name || '').split(' ')[0].toLowerCase()
      const teacherFirst = (row.teacher || '').split(' ')[0].toLowerCase()
      const isRegularTeacher = isAdmin || (firstName && teacherFirst && firstName === teacherFirst)
      if (!isRegularTeacher) {
        const { data: subCheck } = await supabase
          .from(T_SUB_ASSIGNMENTS)
          .select('id')
          .eq('class_id', classId)
          .eq('sub_tutor_id', profile.id)
          .limit(1)
        if (!subCheck?.length) {
          setError("This class isn't assigned to you.")
          setLoading(false); return
        }
      }
      setCls(row)

      // Use the class's own term; fall back to the current term if unset
      const terms = await fetchAllTerms()
      const activeTerm = (row.term_id && terms.find(t => t.id === row.term_id)) || getCurrentTerm(terms)
      setTerm(activeTerm)

      // Roster
      const { data: links } = await supabase
        .from(T_ENROLMENTS)
        .select('students (id, full_name, school, year)')
        .eq('class_id', classId)
      const students = (links || [])
        .map(l => l.students).filter(Boolean)
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
      setRoster(students)

      if (!activeTerm) { setLoading(false); return }

      // Attendance for this class within the term window
      const { data: attRows } = await supabase
        .from(T_ATTENDANCE)
        .select('student_id, session_date, status, notes')
        .eq('class_id', classId)
        .gte('session_date', activeTerm.start_date)
        .lte('session_date', activeTerm.end_date)
      setAttendance(attRows || [])

      // Quizzes for the roster, this term, subject-filtered client-side
      const studentIds = students.map(s => s.id)
      if (studentIds.length > 0) {
        const { data: qzRows } = await supabase
          .from(T_QUIZ_RESULTS)
          .select('student_id, subject, week, score, max_score, homework_grade, quiz_date')
          .in('student_id', studentIds)
          .gte('quiz_date', activeTerm.start_date)
          .lte('quiz_date', activeTerm.end_date)
        const subj = inferSubject(row)
        setQuizzes((qzRows || []).filter(q => subjectsMatch(q.subject, subj)))
      }

      // All staff for sub assignment dropdown — query tutors and admins separately
      const [{ data: tutorRows }, { data: adminRows }] = await Promise.all([
        supabase.from(T_TUTORS).select('id, full_name').order('full_name'),
        supabase.from(T_ADMINS).select('id, full_name').order('full_name'),
      ])
      const staffRows = [
        ...(tutorRows || []).map(t => ({ ...t, role: 'tutor' })),
        ...(adminRows || []).map(a => ({ ...a, role: 'admin' })),
      ].sort((a, b) => a.full_name.localeCompare(b.full_name))
      setAllStaff(staffRows)

      // Sub assignments for this class (all dates, so we can show badges on tabs)
      const { data: subs } = await supabase
        .from(T_SUB_ASSIGNMENTS)
        .select('id, session_date, sub_tutor_id')
        .eq('class_id', classId)
      const subMap = {}
      for (const s of subs || []) subMap[s.session_date] = s
      setSubAssignments(subMap)

      // Pick the default tab: prefer ?week param, otherwise use current week
      if (!(weekParam >= 1 && weekParam <= 10)) {
        const today = isoDate(new Date())
        if (today >= activeTerm.start_date && today <= activeTerm.end_date) {
          const days = Math.floor(
            (new Date(today + 'T00:00:00') - new Date(activeTerm.start_date + 'T00:00:00')) / 86400000
          )
          setTab(Math.min(10, Math.max(1, Math.floor(days / 7) + 1)))
        }
      }

      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId])

  const days = useMemo(() => normalizeDays(cls?.day_of_week || ''), [cls])
  const weekDates = useMemo(() => weeklySessionDates(term, days), [term, days])

  // Lightweight lookup used by the tab nav to dot weeks that have any attendance.
  const attByDate = useMemo(() => {
    const m = new Map()
    for (const a of attendance) {
      if (!m.has(a.session_date)) m.set(a.session_date, [])
      m.get(a.session_date).push(a)
    }
    return m
  }, [attendance])

  if (loading) return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />
      <div className="max-w-7xl mx-auto px-6 md:px-10 py-20 text-center">
        <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">Loading…</div>
      </div>
    </div>
  )

  if (error || !cls) return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16">
        <Link href="/tutor/classes" className="inline-flex items-center gap-1 text-xs font-semibold text-[#325099] hover:text-[#062E63] mb-6">
          ← Back to classes
        </Link>
        <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
          <div className="text-4xl mb-3">🤔</div>
          <p className="text-sm font-semibold text-[#2A2035]">{error || 'Class not found.'}</p>
        </div>
      </div>
    </div>
  )

  const isAdmin = staff?.role === 'admin'
  const col = subjectColor(inferSubject(cls))
  const currentWeek = weekDates[tab - 1] || { week: tab, dates: [] }

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

          <p className="text-[11px] tracking-[0.35em] uppercase font-semibold font-display mb-2" style={{ color: col.fg }}>
            {inferSubject(cls)}
          </p>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            {cls.class_name || 'Untitled class'}
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70">
            {days.length > 0 && days.map(d => DAY_SHORT[d]).join(', ')} {fmtTime(cls.start_time)}–{fmtTime(cls.end_time)}
            {cls.room && <> · 📍 {cls.room}</>}
            {cls.teacher && <> · 👤 {cls.teacher}</>}
            {term && <> · {term.name || `Term ${term.term_number} ${term.year}`}</>}
          </p>

          {/* Stat strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8 max-w-3xl">
            <StatTile label="Students"  value={roster.length} suffix="enrolled" />
            <StatTile
              label="Quiz avg"
              value={(() => {
                const scored = quizzes.filter(q => q.score != null && q.max_score)
                if (scored.length === 0) return '—'
                const avg = scored.reduce((a, q) => a + (q.score / q.max_score) * 100, 0) / scored.length
                return `${Math.round(avg)}%`
              })()}
              suffix="this term"
            />
          </div>
        </div>
      </section>

      {/* WEEK TABS */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        <div className="flex items-center gap-1 mb-6 overflow-x-auto -mx-1 px-1">
          {weekDates.length === 0 ? (
            <p className="text-sm text-[#2A2035]/50">Class day_of_week missing &mdash; can&rsquo;t compute weekly sessions.</p>
          ) : (
            <>
              {weekDates.map(({ week, dates }) => {
                const active = tab === week
                const primaryDate = dates[0]
                const hasData = dates.some(d => attByDate.has(d))
                const hasSub = dates.some(d => subAssignments[d])
                return (
                  <button
                    key={week}
                    onClick={() => setTab(week)}
                    className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                      active
                        ? 'bg-[#062E63] text-white border-[#062E63]'
                        : 'bg-white text-[#062E63] border-[#DEE7FF] hover:bg-[#F8FAFF]'
                    }`}
                  >
                    Wk {week}
                    {hasSub && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[#F59E0B]" title="Sub assigned" />}
                    {hasData && !active && !hasSub && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[#10b981]" />}
                    {primaryDate && (
                      <span className={`ml-2 text-[10px] font-medium ${active ? 'text-white/70' : 'text-[#2A2035]/40'}`}>
                        {fmtDate(primaryDate)}
                      </span>
                    )}
                  </button>
                )
              })}
              {/* Pre/Post test tab */}
              <button
                onClick={() => setTab('prepost')}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition ml-2 ${
                  tab === 'prepost'
                    ? 'bg-[#325099] text-white border-[#325099]'
                    : 'bg-white text-[#325099] border-[#DEE7FF] hover:bg-[#F8FAFF]'
                }`}
              >
                📊 Pre/Post
              </button>
            </>
          )}
        </div>

        {/* PRE/POST TAB */}
        {tab === 'prepost' && term && (
          <PrePostSection
            classId={cls.id}
            termId={term.id}
            roster={roster}
            canEdit={isAdmin || (cls.teacher || '').split(' ')[0].toLowerCase() === (staff?.full_name || '').split(' ')[0].toLowerCase()}
          />
        )}
        {tab === 'prepost' && !term && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-4xl mb-2">📅</div>
            <p className="text-sm font-semibold text-[#2A2035]">No active term found.</p>
            <p className="text-xs text-[#2A2035]/60 mt-1">Pre/Post test data is linked to a term.</p>
          </div>
        )}

        {/* TAB CONTENT — teacher/sub section first, then booklet, then SessionMarker(s) */}
        {tab !== 'prepost' && weekDates.length > 0 && (
          <div className="space-y-8">
            {currentWeek.dates.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
                <div className="text-4xl mb-2">📅</div>
                <p className="text-sm font-semibold text-[#2A2035] mb-1">
                  Week {currentWeek.week} has no matching session date.
                </p>
                <p className="text-xs text-[#2A2035]/60 max-w-md mx-auto">
                  Check the class&rsquo;s day_of_week / term boundaries.
                </p>
              </div>
            ) : (
              <>
                {currentWeek.dates.map((d, i) => (
                <div key={d} className="space-y-8">
                  {currentWeek.dates.length > 1 && (
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-base font-semibold text-[#2A2035] font-display">
                        {fmtDate(d)}
                      </h3>
                      <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
                        Session {i + 1} of {currentWeek.dates.length}
                      </span>
                    </div>
                  )}
                  {/* Teacher / sub assignment — shown above the workbook */}
                  <SubPicker
                    classId={cls.id}
                    dateISO={d}
                    cls={cls}
                    allStaff={allStaff}
                    subAssignments={subAssignments}
                    setSubAssignments={setSubAssignments}
                    isAdmin={isAdmin}
                  />
                  {/* Booklet for this week */}
                  {i === 0 && (
                    <div>
                      <div className="flex items-baseline justify-between mb-3">
                        <div>
                          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                            Workbook
                          </p>
                          <h3 className="text-lg font-semibold text-[#2A2035] font-display">Week {currentWeek.week}</h3>
                        </div>
                        <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
                          {term ? (term.name || `Term ${term.term_number}`) : ''}
                        </span>
                      </div>
                      <WeekBooklet cls={cls} term={term} week={currentWeek.week} isAdmin={isAdmin} />
                    </div>
                  )}
                  <SessionMarker
                    key={`${cls.id}-${d}`}
                    classId={cls.id}
                    dateISO={d}
                    cls={cls}
                    staff={staff}
                    readOnly={!isAdmin && !!subAssignments[d] && staff?.id !== subAssignments[d]?.sub_tutor_id}
                  />
                </div>
              ))}
              {/* Term reports editors — surfaced on Wk 9 (term wrap-up). */}
              {tab === 9 && term && (
                <TermReportsSection
                  classId={cls.id}
                  termId={term.id}
                  roster={roster}
                  canEdit={isAdmin || (cls.teacher || '').split(' ')[0].toLowerCase() === (staff?.full_name || '').split(' ')[0].toLowerCase()}
                />
              )}
              </>
            )}

            {/* Booklet shown even when there's no session date for this week */}
            {currentWeek.dates.length === 0 && (
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <div>
                    <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                      Workbook
                    </p>
                    <h3 className="text-lg font-semibold text-[#2A2035] font-display">Week {currentWeek.week}</h3>
                  </div>
                  <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
                    {term ? (term.name || `Term ${term.term_number}`) : ''}
                  </span>
                </div>
                <WeekBooklet cls={cls} term={term} week={currentWeek.week} isAdmin={isAdmin} />
              </div>
            )}
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

// ── Sub-components ─────────────────────────────────────────────────────────

// ── SubPicker ────────────────────────────────────────────────────────────────
// Admin: dropdown to assign/change/remove a sub for a specific session date.
// Non-admin: read-only banner if a sub is assigned.
function SubPicker({ classId, dateISO, cls, allStaff, subAssignments, setSubAssignments, isAdmin }) {
  const existing = subAssignments[dateISO] || null
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  // Resolve sub's display name from allStaff
  const subStaff = existing ? allStaff.find(s => s.id === existing.sub_tutor_id) : null
  const subName = subStaff?.full_name || (existing ? 'Unknown sub' : null)

  const handleAssign = async (staffId) => {
    setSaving(true)
    if (!staffId) {
      // Remove sub assignment
      if (existing) {
        await supabase.from(T_SUB_ASSIGNMENTS).delete().eq('id', existing.id)
        setSubAssignments(prev => { const n = { ...prev }; delete n[dateISO]; return n })
      }
    } else {
      // Upsert sub assignment
      const payload = {
        class_id: Number(classId),
        session_date: dateISO,
        sub_tutor_id: staffId,
      }
      const { data: row } = await supabase
        .from(T_SUB_ASSIGNMENTS)
        .upsert(payload, { onConflict: 'class_id,session_date' })
        .select()
        .single()
      if (row) {
        setSubAssignments(prev => ({ ...prev, [dateISO]: row }))
        // Re-attribute any existing draft shift to the sub
        await supabase
          .from(T_SHIFTS)
          .update({ tutor_id: staffId, notes: `Auto: ${cls.class_name} (sub)` })
          .eq('source_table', 'class_session')
          .eq('source_id', `${classId}_${dateISO}`)
          .eq('status', 'draft')
      }
    }
    setSaving(false)
    setOpen(false)
  }

  if (!isAdmin) {
    // Non-admin (regular teacher): just show a read-only banner if a sub is assigned
    if (!existing) return null
    return (
      <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl bg-[#FEF3C7] border border-[#FDE68A]">
        <span className="text-base">🔄</span>
        <p className="text-xs font-semibold text-[#92400E]">
          {subName} is covering this session — session marked by sub.
        </p>
      </div>
    )
  }

  // Admin UI
  const regularTeacher = cls.teacher || 'Regular teacher'
  const isRegularSelected = !existing

  return (
    <div className="flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl border border-[#DEE7FF] bg-[#F8FAFF]">
      <span className="text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099] shrink-0">
        Session teacher
      </span>

      {!open ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {existing ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] px-2.5 py-1 rounded-full">
              🔄 Sub: {subName}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#065F46] bg-[#D1FAE5] px-2.5 py-1 rounded-full">
              👤 {regularTeacher}
            </span>
          )}
          <button
            onClick={() => setOpen(true)}
            className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63] px-2.5 py-1 rounded-full hover:bg-[#DEE7FF] transition shrink-0"
          >
            Change →
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <select
            defaultValue={existing?.sub_tutor_id || ''}
            onChange={e => handleAssign(e.target.value || null)}
            disabled={saving}
            className="text-xs border border-[#DEE7FF] rounded-lg px-3 py-1.5 bg-white text-[#2A2035] focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] disabled:opacity-50"
          >
            <option value="">{regularTeacher} (regular)</option>
            {allStaff
              .filter(s => {
                // Exclude whoever the regular teacher is by first-name match
                const staffFirst = (s.full_name || '').split(' ')[0].toLowerCase()
                const clsFirst = (cls.teacher || '').split(' ')[0].toLowerCase()
                return staffFirst !== clsFirst
              })
              .map(s => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
          </select>
          {saving && <span className="text-[11px] text-[#325099]/60">Saving…</span>}
          <button
            onClick={() => setOpen(false)}
            className="text-[11px] font-semibold text-[#2A2035]/50 hover:text-[#2A2035] px-2 py-1 rounded-full hover:bg-[#F0F0F4] transition"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, suffix }) {
  return (
    <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
      <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">{label}</p>
      <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display tabular-nums">
        {value}
        <span className="text-sm font-medium text-[#2A2035]/50 ml-1">{suffix}</span>
      </p>
    </div>
  )
}

// ── Term reports section (Wk 9) ──────────────────────────────────────────
// Unified per-student rows: criteria grid (left) + term comment (right).
// Loads both tables once, so students always align horizontally.

const CRITERIA = [
  { key: 'subject_knowledge',   label: 'Subject Knowledge & Understanding' },
  { key: 'class_participation', label: 'Class Participation & Engagement' },
  { key: 'class_behaviour',     label: 'Class Behaviour' },
  { key: 'homework_effort',     label: 'Homework Effort & Completion' },
]
const GRADES = ['A', 'B', 'C', 'D']
const GRADE_STYLE = {
  A: { bg: '#D1FAE5', fg: '#065F46' },
  B: { bg: '#DEE7FF', fg: '#062E63' },
  C: { bg: '#FEF3C7', fg: '#92400E' },
  D: { bg: '#FEE2E2', fg: '#991B1B' },
}

function TermReportsSection({ classId, termId, roster, canEdit }) {
  const [criteriaMap, setCriteriaMap] = useState({})   // { [studentId]: { id, subject_knowledge, ... } }
  const [commentsMap, setCommentsMap] = useState({})   // { [studentId]: { id, comment } }
  const [savingId,    setSavingId]    = useState(null) // studentId currently saving
  const [savedId,     setSavedId]     = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null)
      try {
        const [{ data: cr, error: e1 }, { data: cm, error: e2 }] = await Promise.all([
          supabase.from(T_TERM_CRITERIA)
            .select('id, student_id, subject_knowledge, class_participation, class_behaviour, homework_effort')
            .eq('class_id', classId).eq('term_id', termId),
          supabase.from(T_TERM_COMMENTS)
            .select('id, student_id, comment')
            .eq('class_id', classId).eq('term_id', termId),
        ])
        if (e1) throw e1
        if (e2) throw e2
        const crMap = {}; for (const r of cr || []) crMap[r.student_id] = r
        const cmMap = {}; for (const r of cm || []) cmMap[r.student_id] = { id: r.id, comment: r.comment || '' }
        setCriteriaMap(crMap)
        setCommentsMap(cmMap)
      } catch (e) {
        setError(e.message || String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [classId, termId])

  const flashSaved = (studentId) => {
    setSavedId(studentId)
    setTimeout(() => setSavedId(p => (p === studentId ? null : p)), 2000)
  }

  const setGrade = async (studentId, criterionKey, grade) => {
    if (!canEdit) return
    const prev = criteriaMap[studentId]
    setSavingId(studentId)
    try {
      if (prev?.id) {
        const { error: e } = await supabase.from(T_TERM_CRITERIA)
          .update({ [criterionKey]: grade }).eq('id', prev.id)
        if (e) throw e
        setCriteriaMap(m => ({ ...m, [studentId]: { ...prev, [criterionKey]: grade } }))
      } else {
        const { data, error: e } = await supabase.from(T_TERM_CRITERIA)
          .insert({ student_id: studentId, class_id: classId, term_id: termId, [criterionKey]: grade })
          .select('id').single()
        if (e) throw e
        setCriteriaMap(m => ({ ...m, [studentId]: { id: data.id, [criterionKey]: grade } }))
      }
      flashSaved(studentId)
    } catch (e) { alert('Save failed: ' + (e.message || String(e))) }
    finally { setSavingId(null) }
  }

  const commitComment = async (studentId, raw) => {
    if (!canEdit) return
    const trimmed = (raw || '').trim()
    const prev = commentsMap[studentId]
    if (prev && (prev.comment || '') === trimmed) return
    setSavingId(studentId)
    try {
      if (prev?.id) {
        const { error: e } = await supabase.from(T_TERM_COMMENTS)
          .update({ comment: trimmed }).eq('id', prev.id)
        if (e) throw e
        setCommentsMap(m => ({ ...m, [studentId]: { ...prev, comment: trimmed } }))
      } else {
        const { data, error: e } = await supabase.from(T_TERM_COMMENTS)
          .insert({ student_id: studentId, class_id: classId, term_id: termId, comment: trimmed })
          .select('id').single()
        if (e) throw e
        setCommentsMap(m => ({ ...m, [studentId]: { id: data.id, comment: trimmed } }))
      }
      flashSaved(studentId)
    } catch (e) { alert('Save failed: ' + (e.message || String(e))) }
    finally { setSavingId(null) }
  }

  // Section header shared between both columns
  const SectionHeader = ({ title, subtitle }) => (
    <div className="px-5 py-4 border-b border-[#DEE7FF] bg-[#F0FDF4]">
      <p className="text-[10px] tracking-[0.3em] uppercase text-[#065F46] font-semibold font-display">Term Reports</p>
      <h3 className="text-lg font-semibold text-[#2A2035] font-display">{title}</h3>
      <p className="text-xs text-[#2A2035]/60 mt-1">{subtitle}</p>
    </div>
  )

  if (loading) return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 text-sm text-[#2A2035]/60">Loading…</div>
  )
  if (error) return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF]">
      <div className="bg-[#FEE2E2] p-4 text-sm text-[#991B1B] rounded-2xl">{error}</div>
    </div>
  )
  if (roster.length === 0) return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 text-sm text-[#2A2035]/60">No students enrolled yet.</div>
  )

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      {/* LEFT: criteria column */}
      <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
        <SectionHeader title="Student criteria" subtitle="Grade each student A–D per criterion. Surfaces on the term report PDF." />
        <ul className="divide-y divide-[#DEE7FF]">
          {roster.map(s => {
            const row = criteriaMap[s.id] || {}
            return (
              <li key={s.id} className="p-5">
                <StudentMeta student={s} savingId={savingId} savedId={savedId} />
                {/* Criteria grid */}
                <div className="rounded-xl border border-[#DEE7FF] overflow-hidden mt-3">
                  <div className="grid grid-cols-[1fr_repeat(4,2.25rem)] px-3 py-1.5 bg-[#F8FAFF] border-b border-[#DEE7FF]">
                    <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#325099]">Student Criteria</span>
                    {GRADES.map(g => (
                      <span key={g} className="text-[10px] font-bold tracking-widest uppercase text-[#325099] text-center">{g}</span>
                    ))}
                  </div>
                  {CRITERIA.map((c, ci) => {
                    const selected = row[c.key] || null
                    return (
                      <div key={c.key} className={`grid grid-cols-[1fr_repeat(4,2.25rem)] items-center px-3 py-2 ${ci % 2 === 1 ? 'bg-[#FAFBFF]' : 'bg-white'}`}>
                        <span className="text-xs text-[#2A2035] leading-tight pr-2">{c.label}</span>
                        {GRADES.map(g => {
                          const active = selected === g
                          const st = GRADE_STYLE[g]
                          return (
                            <button
                              key={g}
                              type="button"
                              disabled={!canEdit}
                              onClick={() => setGrade(s.id, c.key, active ? null : g)}
                              title={`${c.label}: ${g}`}
                              className={`w-7 h-7 mx-auto rounded-md text-sm font-bold transition-all flex items-center justify-center
                                ${active ? 'ring-2 ring-offset-1' : 'bg-[#F1F1F3] text-[#9CA3AF] hover:bg-[#E4E7F0]'}
                                ${!canEdit ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
                              `}
                              style={active ? { background: st.bg, color: st.fg, outlineColor: st.fg } : {}}
                            >
                              {active ? '✓' : ''}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {/* RIGHT: comments column */}
      <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
        <SectionHeader title="Teacher term comments" subtitle="One per student. Surfaces on the end-of-term report PDF sent to parents." />
        <ul className="divide-y divide-[#DEE7FF]">
          {roster.map(s => {
            const row = commentsMap[s.id] || { comment: '' }
            return (
              <li key={s.id} className="p-5">
                <StudentMeta student={s} savingId={savingId} savedId={savedId} />
                <textarea
                  key={`${s.id}-${row.id || 'new'}`}
                  defaultValue={row.comment}
                  onBlur={canEdit ? e => commitComment(s.id, e.target.value) : undefined}
                  readOnly={!canEdit}
                  placeholder={canEdit ? 'How did this student go this term? Please comment on each of the student criteria and elaborate on strengths, areas to work on, parent guidance…' : 'No comment yet.'}
                  rows={5}
                  className={`w-full mt-3 rounded-xl border px-4 py-3 text-sm leading-relaxed resize-y focus:outline-none ${
                    canEdit
                      ? 'bg-[#F8FAFF] border-[#DEE7FF] text-[#2A2035] placeholder:text-[#2A2035]/30 focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099]'
                      : 'bg-[#F4F4F4] border-[#E5E7EB] text-[#2A2035]/70 cursor-not-allowed'
                  }`}
                />
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function StudentMeta({ student: s, savingId, savedId }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-8 h-8 rounded-full bg-[#062E63] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          {(s.full_name || '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#2A2035] truncate">{s.full_name || 'Unknown'}</p>
          <p className="text-[10px] text-[#2A2035]/50">{s.school || '—'} · Y{s.year || '?'}</p>
        </div>
      </div>
      <span className="text-[10px] font-semibold tracking-widest uppercase shrink-0">
        {savingId === s.id && <span className="text-[#325099]/60">Saving…</span>}
        {savedId  === s.id && <span className="text-[#065F46]">✓ Saved</span>}
      </span>
    </div>
  )
}


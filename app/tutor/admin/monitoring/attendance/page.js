'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../../../lib/terms'
import { classesForTerm } from '../../../../../lib/classes'
import { T_ATTENDANCE, T_STUDENTS } from '../../../../../lib/tables'

/*
 * Attendance — /tutor/admin/monitoring/attendance (admin only)
 *
 * One of the pages under Monitoring. Tutors mark attendance from their lesson
 * page; this reads all of it back for a term and answers the question you
 * cannot answer from a single class: WHICH STUDENTS ARE QUIETLY SLIPPING?
 *
 * What counts as attending:
 *   present, late      → attended (arriving late is still arriving)
 *   absent, makeup     → missed this session (a booked makeup does not undo it)
 *   cancelled          → the session never ran, so it is left out of the rate
 *                        entirely rather than counted against anyone.
 */
const ATTENDED = new Set(['present', 'late'])
const MISSED   = new Set(['absent', 'makeup'])
const COUNTED  = new Set([...ATTENDED, ...MISSED])

// Below this, a student is surfaced for attention.
const CONCERN = 0.85

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null)
const fmtDate = (d) => {
  if (!d) return ''
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) }
  catch { return String(d) }
}
const rateColour = (r) =>
  r == null ? '#2A2035' : r < 75 ? '#B91C1C' : r < CONCERN * 100 ? '#B45309' : '#15803D'

function Kpi({ label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-[#F0F4FF] px-5 py-4">
      <p className="text-[11px] font-semibold tracking-wide uppercase text-[#325099]/60">{label}</p>
      <p className="text-2xl font-bold text-[#062E63] mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-[#2A2035]/45 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function AttendancePage() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState('')
  const [rows, setRows] = useState([])          // attendance rows for the term
  const [students, setStudents] = useState({})  // id -> { full_name, year }
  const [classes, setClasses] = useState({})    // id -> class_name
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setStaff(profile)
      const all = await fetchAllTerms()
      setTerms(all)
      setTermId(getCurrentTerm(all)?.id || all[0]?.id || '')
    })()
  }, [router])

  const load = useCallback(async (tid) => {
    if (!tid) return
    setLoading(true); setError(null)
    try {
      const term = terms.find(t => t.id === tid)
      if (!term) { setRows([]); setLoading(false); return }
      // Classes are per-term rows, so the class list must be term-scoped.
      const { data: cls } = await classesForTerm(tid, 'id, class_name')
      const byClass = {}; for (const c of cls || []) byClass[c.id] = c.class_name
      setClasses(byClass)

      const [{ data: att, error: aErr }, { data: studs }] = await Promise.all([
        supabase.from(T_ATTENDANCE)
          .select('student_id, class_id, session_date, status, notes')
          .gte('session_date', term.start_date).lte('session_date', term.end_date),
        supabase.from(T_STUDENTS).select('id, full_name, year'),
      ])
      if (aErr) throw aErr
      const byStudent = {}; for (const s of studs || []) byStudent[s.id] = s
      setStudents(byStudent)
      // Only sessions belonging to a class in this term.
      setRows((att || []).filter(r => byClass[r.class_id]))
    } catch (e) {
      setError(e.message || 'Could not load attendance.')
    } finally { setLoading(false) }
  }, [terms])

  useEffect(() => { load(termId) }, [termId, load])

  const stats = useMemo(() => {
    const counted = rows.filter(r => COUNTED.has(r.status))
    const attended = counted.filter(r => ATTENDED.has(r.status)).length
    const perStudent = {}, perClass = {}
    for (const r of counted) {
      const s = (perStudent[r.student_id] ||= { present: 0, late: 0, absent: 0, makeup: 0, total: 0 })
      s[r.status] = (s[r.status] || 0) + 1; s.total++
      const c = (perClass[r.class_id] ||= { attended: 0, total: 0 })
      c.total++; if (ATTENDED.has(r.status)) c.attended++
    }
    const concern = Object.entries(perStudent)
      .map(([id, s]) => ({ id, ...s, rate: pct(s.present + s.late, s.total) }))
      // A student with only a session or two has too little history to judge.
      .filter(s => s.total >= 3 && s.rate != null && s.rate < CONCERN * 100)
      .sort((a, b) => a.rate - b.rate)
    const classRows = Object.entries(perClass)
      .map(([id, c]) => ({ id, ...c, rate: pct(c.attended, c.total) }))
      .sort((a, b) => a.rate - b.rate)
    const recent = rows.filter(r => r.status === 'absent' || r.status === 'late')
      .sort((a, b) => b.session_date.localeCompare(a.session_date)).slice(0, 12)
    return {
      rate: pct(attended, counted.length), counted: counted.length,
      absent: rows.filter(r => r.status === 'absent').length,
      late: rows.filter(r => r.status === 'late').length,
      cancelled: rows.filter(r => r.status === 'cancelled').length,
      concern, classRows, recent,
    }
  }, [rows])

  if (!staff) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff?.full_name} isAdmin={true} />
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-16">
        <Link href="/tutor/admin/monitoring" className="text-xs font-semibold text-[#325099]/60 hover:text-[#325099] transition">← Monitoring</Link>
        <div className="flex items-end justify-between gap-4 mt-1 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Attendance</h1>
            <p className="text-xs text-[#2A2035]/55 mt-0.5">
              Every session marked this term. Cancelled sessions are left out of the rates.
            </p>
          </div>
          <select value={termId} onChange={(e) => setTermId(e.target.value)}
            className="border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            {terms.map(t => <option key={t.id} value={t.id}>{formatTermLabel(t)}</option>)}
          </select>
        </div>

        {error && <p className="text-xs font-semibold text-[#B91C1C] mb-4">{error}</p>}
        {loading ? (
          <p className="text-sm text-[#2A2035]/40 animate-pulse py-10 text-center">Loading attendance…</p>
        ) : stats.counted === 0 ? (
          <p className="text-sm text-[#2A2035]/40 italic py-10 text-center">No attendance has been marked for this term yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              <Kpi label="Attendance rate" value={`${stats.rate}%`} sub={`${stats.counted} sessions counted`} />
              <Kpi label="Absences" value={stats.absent} sub="marked absent or moved to a makeup" />
              <Kpi label="Late arrivals" value={stats.late} sub="counted as attending" />
              <Kpi label="Cancelled" value={stats.cancelled} sub="excluded from the rate" />
            </div>

            <div className="bg-white rounded-2xl border border-[#F0F4FF] overflow-hidden mb-8">
              <div className="px-5 py-3 border-b border-[#F0F4FF] flex items-baseline justify-between gap-3">
                <p className="text-sm font-bold text-[#062E63]">Students to look at</p>
                <p className="text-[11px] text-[#2A2035]/45">below {Math.round(CONCERN * 100)}%, with at least 3 sessions marked</p>
              </div>
              {stats.concern.length === 0 ? (
                <p className="px-5 py-6 text-xs text-[#2A2035]/40 italic">No student is below {Math.round(CONCERN * 100)}% this term.</p>
              ) : (
                <div className="divide-y divide-[#F4F7FF]">
                  {stats.concern.map(s => (
                    <div key={s.id} className="px-5 py-2.5 flex items-center gap-3 text-xs">
                      <span className="font-semibold text-[#062E63] flex-1 min-w-0 truncate">
                        {students[s.id]?.full_name || 'Unknown student'}
                        {students[s.id]?.year != null && <span className="text-[#2A2035]/40 font-normal"> · Year {students[s.id].year}</span>}
                      </span>
                      <span className="text-[#2A2035]/50 tabular-nums shrink-0">
                        {s.present + s.late}/{s.total} attended
                        {s.absent ? ` · ${s.absent} absent` : ''}{s.makeup ? ` · ${s.makeup} makeup` : ''}
                      </span>
                      <span className="font-bold tabular-nums shrink-0 w-14 text-right" style={{ color: rateColour(s.rate) }}>{s.rate}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-[#F0F4FF] overflow-hidden">
                <p className="px-5 py-3 border-b border-[#F0F4FF] text-sm font-bold text-[#062E63]">By class</p>
                <div className="divide-y divide-[#F4F7FF] max-h-[420px] overflow-y-auto">
                  {stats.classRows.map(c => (
                    <div key={c.id} className="px-5 py-2.5 flex items-center gap-3 text-xs">
                      <span className="font-semibold text-[#062E63] flex-1 min-w-0 truncate">{classes[c.id] || `Class ${c.id}`}</span>
                      <span className="text-[#2A2035]/45 tabular-nums shrink-0">{c.attended}/{c.total}</span>
                      <span className="font-bold tabular-nums shrink-0 w-14 text-right" style={{ color: rateColour(c.rate) }}>{c.rate}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#F0F4FF] overflow-hidden">
                <p className="px-5 py-3 border-b border-[#F0F4FF] text-sm font-bold text-[#062E63]">Most recent absences and lates</p>
                {stats.recent.length === 0 ? (
                  <p className="px-5 py-6 text-xs text-[#2A2035]/40 italic">Nothing recorded.</p>
                ) : (
                  <div className="divide-y divide-[#F4F7FF] max-h-[420px] overflow-y-auto">
                    {stats.recent.map((r, i) => (
                      <div key={i} className="px-5 py-2.5 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${
                            r.status === 'absent' ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#FEF3C7] text-[#92400E]'}`}>{r.status}</span>
                          <span className="font-semibold text-[#062E63]">{students[r.student_id]?.full_name || 'Unknown student'}</span>
                          <span className="text-[#2A2035]/45">{classes[r.class_id] || ''}</span>
                          <span className="text-[#2A2035]/35 ml-auto shrink-0">{fmtDate(r.session_date)}</span>
                        </div>
                        {r.notes && <p className="text-[11px] text-[#2A2035]/50 mt-1">{r.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

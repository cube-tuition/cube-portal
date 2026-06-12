'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { normalizeDays, fmtTime, isoDate } from '../../../lib/format'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../lib/terms'
import { T_ATTENDANCE, T_CLASSES } from '../../../lib/tables'

/*
 * Unsaved sessions — /tutor/unsaved-sessions
 * Every past session this term where attendance hasn't been saved, grouped by
 * tutor. Moved here from the home dashboard "Tutor tasks" panel; the Action
 * Centre's attendance row links straight here. Click a session to open the
 * class roll for that date.
 */

const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const EXCLUDED = ['aiden', 'ryan']   // directors — same exclusion as the old home panel

function startMinutes(t) {
  if (!t) return 99999
  const [h, m] = String(t).split(':').map(x => parseInt(x, 10))
  return Number.isNaN(h) ? 99999 : h * 60 + (m || 0)
}

export default function UnsavedSessionsPage() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)
  const [term, setTerm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState([])     // { teacher, classId, dateIso, class_name, start_time, end_time }
  const [selectedTutor, setSelectedTutor] = useState('All')

  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setStaff(profile)

      const terms = await fetchAllTerms()
      const t = getCurrentTerm(terms)
      setTerm(t)
      if (!t) { setLoading(false); return }

      const { data: classes } = await supabase
        .from(T_CLASSES)
        .select('id, class_name, day_of_week, start_time, end_time, teacher')
        .eq('term_id', t.id)

      const now = new Date()
      const todayIso = isoDate(now)
      const nowMinutes = now.getHours() * 60 + now.getMinutes()

      // Expected past sessions per class (skip today's classes still in progress)
      const candidates = []
      for (const c of classes || []) {
        const teacher = (c.teacher || '').trim()
        if (!teacher) continue
        const first = teacher.split(' ')[0]
        if (EXCLUDED.includes(first.toLowerCase())) continue
        const days = normalizeDays(c.day_of_week)
        if (days.length === 0) continue
        const cursor = new Date(t.start_date + 'T00:00:00')
        const termEnd = new Date(t.end_date + 'T00:00:00')
        while (cursor <= termEnd) {
          const curIso = isoDate(cursor)
          if (curIso > todayIso) break
          const curDay = DAY_ORDER[(cursor.getDay() + 6) % 7]
          if (days.includes(curDay)) {
            if (curIso === todayIso && nowMinutes <= startMinutes(c.end_time)) { cursor.setDate(cursor.getDate() + 1); continue }
            candidates.push({ teacher: first, classId: c.id, dateIso: curIso, class_name: c.class_name, start_time: c.start_time, end_time: c.end_time })
          }
          cursor.setDate(cursor.getDate() + 1)
        }
      }

      if (candidates.length) {
        const classIds = [...new Set(candidates.map(c => c.classId))]
        const { data: attRows } = await supabase
          .from(T_ATTENDANCE)
          .select('class_id, session_date')
          .in('class_id', classIds)
          .gte('session_date', t.start_date)
          .lte('session_date', todayIso)
        const saved = new Set((attRows || []).map(r => `${r.class_id}|${r.session_date}`))
        setSessions(candidates.filter(c => !saved.has(`${c.classId}|${c.dateIso}`))
          .sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.class_name.localeCompare(b.class_name)))
      }
      setLoading(false)
    })()
  }, [router])

  const tutors = useMemo(() => [...new Set(sessions.map(s => s.teacher))].sort(), [sessions])
  const visible = selectedTutor === 'All' ? sessions : sessions.filter(s => s.teacher === selectedTutor)
  const countByTutor = useMemo(() => sessions.reduce((m, s) => ({ ...m, [s.teacher]: (m[s.teacher] || 0) + 1 }), {}), [sessions])

  if (!staff) return <div className="min-h-screen bg-[#F8FAFF]" />

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin />
      <div className="max-w-3xl mx-auto px-6 pt-8 pb-20">
        <Link href="/tutor" className="text-xs text-[#325099] hover:underline">← Home</Link>
        <div className="flex items-end justify-between gap-4 mt-1 mb-6 flex-wrap">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">Tutor tasks</p>
            <h1 className="text-2xl font-bold text-[#062E63]">Unsaved sessions</h1>
            <p className="text-sm text-[#325099]/60 mt-1">
              Past sessions {term ? `in ${formatTermLabel(term)}` : ''} with no attendance saved. Click one to open the roll.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {sessions.length > 0 && (
              <span className="text-[10px] tracking-widest uppercase font-semibold text-[#B23A3A]">{sessions.length} unsaved</span>
            )}
            {tutors.length > 0 && (
              <select value={selectedTutor} onChange={e => setSelectedTutor(e.target.value)}
                className="text-xs font-semibold text-[#2A2035] bg-white border border-[#DEE7FF] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#325099]">
                <option value="All">All tutors</option>
                {tutors.map(t => <option key={t} value={t}>{t} ({countByTutor[t]})</option>)}
              </select>
            )}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-[#2A2035]/50 animate-pulse py-10 text-center">Checking sessions…</p>
        ) : visible.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-12 text-center">
            <div className="text-4xl mb-2">✅</div>
            <p className="text-sm font-semibold text-[#2A2035]">All caught up.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">Every past session this term has attendance saved.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((s, i) => (
              <Link key={`${s.classId}-${s.dateIso}-${i}`} href={`/tutor/classes/${s.classId}/${s.dateIso}`}
                className="flex items-start gap-3 rounded-xl px-4 py-3 border border-[#FDE8E8] bg-[#FFF5F5] hover:border-[#F4A0A0] hover:bg-white transition group">
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
                <span className="text-[#B23A3A] transition-transform group-hover:translate-x-0.5 mt-0.5">→</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

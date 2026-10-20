'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { fmtTime, isoDate } from '../../../lib/format'
import { unmarkedLessons } from '../../../lib/rollNudges'
import { fetchAllTerms, getRunningTerm, formatTermLabel } from '../../../lib/terms'
import { T_ATTENDANCE, T_CLASSES } from '../../../lib/tables'

/*
 * Unsaved sessions — /tutor/unsaved-sessions
 * Every past lesson this term (the real lesson rows — a lesson moved to
 * another day counts on the day it ran) where attendance hasn't been saved,
 * grouped by tutor. Moved here from the home dashboard "Tutor tasks" panel; the Action
 * Centre's attendance row links straight here. Click a session to open the
 * class roll for that date.
 */

const EXCLUDED = ['aiden', 'ryan']   // directors — same exclusion as the old home panel
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || ''

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
      // Sessions that have already happened — the term running today, a
      // holiday course included, not the upcoming one pages default to.
      const t = getRunningTerm(terms)
      setTerm(t)
      if (!t) { setLoading(false); return }

      // The term's real lessons — a lesson moved to another day is expected on
      // the day it ran, never on the class's usual weekday (lib/rollNudges).
      const todayIso = isoDate(new Date())
      const [{ data: classes }, { data: lessons }, { data: att }, { data: enrols }, { data: tutors }, { data: directors }] = await Promise.all([
        supabase.from(T_CLASSES).select('id, class_name, teacher, end_time').eq('term_id', t.id),
        supabase.from('lessons')
          .select('id, class_id, lesson_date, start_time, end_time, status, is_makeup, lesson_type, main_teacher, scheduled_teacher_id, classes!inner(term_id)')
          .eq('classes.term_id', t.id).gte('lesson_date', t.start_date).lte('lesson_date', todayIso),
        supabase.from(T_ATTENDANCE).select('class_id, session_date').gte('session_date', t.start_date).lte('session_date', todayIso),
        supabase.from('enrolments').select('class_id').in('status', ['active', 'trial']),
        supabase.from('tutors').select('id, full_name'),
        supabase.from('directors').select('id, full_name'),
      ])
      const directorIds = new Set((directors || []).map(d => d.id))
      const unmarked = unmarkedLessons({
        lessons: lessons || [], classes: classes || [],
        marked: new Set((att || []).map(a => `${a.class_id}|${a.session_date}`)),
        enrolled: new Set((enrols || []).map(e => e.class_id)),
        staff: [...(tutors || []), ...(directors || [])], from: t.start_date,
      })
      // Directors' own lessons are left out, as before.
      setSessions(unmarked
        .filter(l => !(l.teacher.id && directorIds.has(l.teacher.id)) && !EXCLUDED.includes(firstName(l.teacher.name).toLowerCase()))
        .map(l => ({ teacher: firstName(l.teacher.name) || 'Unassigned', classId: l.class_id, dateIso: l.lesson_date, class_name: l.class_name, start_time: l.start_time, end_time: l.end_time })))
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

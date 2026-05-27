'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import TutorNav from '../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../lib/terms'
import { inferSubject, subjectColor } from '../../../components/CourseDetail'

/*
 * Admin term reports — /tutor/reports
 *
 * Pick a class + term → open /tutor/reports/[classId]/[termId] which renders
 * a printable HTML page with one report per enrolled student. Admin uses the
 * browser's "Save as PDF" to bundle them into one file.
 */

const parseYear = (name) => {
  const m = String(name || '').match(/^[Yy](\d{1,2})/)
  return m ? parseInt(m[1], 10) : null
}

export default function ReportsLandingPage() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState(null)
  const [classes, setClasses] = useState([])
  const [rosters, setRosters] = useState({})
  const [commentsCount, setCommentsCount] = useState({})  // class_id → # comments written for selected term
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: profile } = await supabase
        .from('students').select('*').eq('id', user.id).single()
      if (!profile || profile.role !== 'admin') {
        router.push('/tutor'); return
      }
      setStaff(profile)

      const t = await fetchAllTerms()
      setTerms(t)
      setTermId(getCurrentTerm(t)?.id || t?.[0]?.id || null)

      const { data: cls } = await supabase
        .from('classes')
        .select('id, class_name, day_of_week, start_time, end_time, teacher, room')
        .is('archived_at', null)
      setClasses(cls || [])

      const ids = (cls || []).map(c => c.id)
      if (ids.length > 0) {
        const { data: links } = await supabase
          .from('student_classes')
          .select('class_id, students (id, full_name, school, school_year)')
          .in('class_id', ids)
        const map = {}
        for (const l of links || []) {
          if (!l.students) continue
          if (!map[l.class_id]) map[l.class_id] = []
          map[l.class_id].push(l.students)
        }
        setRosters(map)
      }

      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When term changes, fetch how many comments have been written for each class
  useEffect(() => {
    if (!termId) return
    (async () => {
      const { data } = await supabase
        .from('term_comments')
        .select('class_id')
        .eq('term_id', termId)
      const tally = {}
      for (const r of data || []) tally[r.class_id] = (tally[r.class_id] || 0) + 1
      setCommentsCount(tally)
    })()
  }, [termId])

  // Sort + group classes: Year ascending, then Subject A→Z
  const ordered = useMemo(() => {
    return [...classes].sort((a, b) => {
      const ya = parseYear(a.class_name) ?? 9999
      const yb = parseYear(b.class_name) ?? 9999
      if (ya !== yb) return ya - yb
      const sa = inferSubject(a) || 'Other'
      const sb = inferSubject(b) || 'Other'
      const ds = sa.localeCompare(sb)
      if (ds !== 0) return ds
      return (a.class_name || '').localeCompare(b.class_name || '')
    })
  }, [classes])

  if (!staff) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">Loading…</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 md:py-12">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display mb-2">
            Term reports · Admin
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#2A2035] font-display">
            End-of-term PDFs
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 mt-2 max-w-2xl">
            Pick a class to open its bundle. Each bundle prints one page per enrolled student with their RQ chart, attendance &amp; HW, and the teacher&rsquo;s term comment.
          </p>

          {/* Term selector */}
          <div className="mt-6 inline-flex items-center gap-2 bg-white border border-[#DEE7FF] rounded-full px-3 py-1.5">
            <label className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/80 font-semibold">Term:</label>
            <select
              value={termId || ''}
              onChange={e => setTermId(e.target.value)}
              className="text-sm font-semibold text-[#062E63] bg-transparent focus:outline-none cursor-pointer"
            >
              {terms.map(t => (
                <option key={t.id} value={t.id}>{formatTermLabel(t)}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {loading ? (
          <p className="text-sm text-[#2A2035]/60">Loading classes…</p>
        ) : ordered.length === 0 ? (
          <p className="text-sm text-[#2A2035]/60">No active classes.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {ordered.map(c => {
              const col = subjectColor(inferSubject(c))
              const count = (rosters[c.id] || []).length
              const written = commentsCount[c.id] || 0
              const allWritten = count > 0 && written >= count
              return (
                <Link
                  key={c.id}
                  href={`/tutor/reports/${c.id}/${termId}`}
                  className="group block rounded-2xl border border-[#DEE7FF] bg-white p-4 hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition relative overflow-hidden"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: col.fg }} />
                  <div className="pl-2">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-base font-bold text-[#2A2035] font-display leading-tight truncate flex-1 min-w-0">
                        {c.class_name}
                      </p>
                      <span className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full bg-[#DEE7FF] text-[#062E63] shrink-0">
                        {count}
                      </span>
                    </div>
                    {c.teacher && (
                      <p className="text-[11px] text-[#2A2035]/60 mb-2 truncate">👤 {c.teacher}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          allWritten ? 'bg-[#D1FAE5] text-[#065F46]'
                          : written > 0 ? 'bg-[#FEF3C7] text-[#92400E]'
                          : 'bg-[#F4F4F4] text-[#9CA3AF]'
                        }`}
                      >
                        {written}/{count} comments
                      </span>
                      <span className="text-[#325099] ml-auto transition-transform group-hover:translate-x-0.5">→</span>
                    </div>
                  </div>
                </Link>
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

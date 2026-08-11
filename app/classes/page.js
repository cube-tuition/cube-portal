'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import PortalNav from '../../components/PortalNav'
import { inferSubject, subjectColor } from '../../components/CourseDetail'
import { fetchAllTerms, getEnrolmentTerm, formatTermLabel, formatTermRange } from '../../lib/terms'
import { enrolledClassesForTerm } from '../../lib/classes'
import { T_STUDENTS } from '../../lib/tables'

/*
 * Classes — /classes (student portal)
 *
 * The student's classes for the current term. Each opens its own page: the
 * week-by-week workbooks and resources for that class, and the results and
 * analytics that used to live on /results.
 */

const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' }
const time = (t) => (t ? String(t).slice(0, 5) : '')

export default function ClassesPage() {
  const router = useRouter()
  const [student, setStudent] = useState(null)
  const [classes, setClasses] = useState([])
  const [term, setTerm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      if (!requireStudent(user, router)) return
      const { data: profile } = await supabase.from(T_STUDENTS).select('*').eq('id', user.id).single()
      setStudent(profile)

      const terms = await fetchAllTerms()
      const t = getEnrolmentTerm(terms)
      setTerm(t)

      // No `subject` column on classes — inferSubject reads it off the class
      // name. Asking for one that doesn't exist fails the whole query, and the
      // page then looks like the student has no classes at all.
      const { data, error } = await enrolledClassesForTerm(
        user.id, t?.id, 'id, class_name, day_of_week, start_time, end_time, teacher, room')
      if (error) setErr(error.message)
      setClasses((data?.map(d => d.classes) || []).filter(Boolean))
      setLoading(false)
    })()
  }, [router])

  return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student?.full_name} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">Your classes</p>
            {term && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#325099]" />
                {formatTermLabel(term)}
              </span>
            )}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">Classes</h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            Open a class for its weekly workbooks and resources, and to see how you’re tracking.
            {term ? ` ${formatTermRange(term)}.` : ''}{' '}
            <Link href="/archive" className="text-[#325099] font-semibold hover:text-[#062E63]">Past terms →</Link>
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {loading ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center text-sm text-[#2A2035]/50">Loading your classes…</div>
        ) : err ? (
          <div className="rounded-2xl border border-[#F3CFCF] bg-[#FFF7F7] p-12 text-center">
            <p className="text-sm font-semibold text-[#B23A3A]">Your classes couldn’t be loaded.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">{err}</p>
          </div>
        ) : classes.length === 0 ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center">
            <div className="text-4xl mb-2">📚</div>
            <p className="text-sm font-semibold text-[#2A2035]">You’re not enrolled in any classes yet.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">Once you’re enrolled, your classes will show up here.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map(c => {
              const sc = subjectColor(inferSubject(c))
              return (
                <Link
                  key={c.id}
                  href={`/classes/${c.id}`}
                  className="group rounded-2xl border border-[#DEE7FF] bg-white overflow-hidden hover:border-[#BACBFF] hover:shadow-md transition"
                >
                  <div className="h-1.5 w-full" style={{ background: sc.line }} />
                  <div className="p-5">
                    <p className="text-base font-bold text-[#062E63] group-hover:text-[#325099] transition">{c.class_name}</p>
                    <p className="text-xs text-[#2A2035]/55 mt-1">
                      {[DAY_SHORT[c.day_of_week] || c.day_of_week, time(c.start_time) && `${time(c.start_time)}–${time(c.end_time)}`]
                        .filter(Boolean).join(' · ') || 'Timetable to be confirmed'}
                    </p>
                    {c.teacher && <p className="text-xs text-[#2A2035]/45 mt-0.5">{c.teacher}</p>}
                    <p className="mt-4 text-[11px] font-bold" style={{ color: sc.fg }}>Open class →</p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">© CUBE Tuition · Chatswood</p>
        </div>
      </footer>
    </div>
  )
}

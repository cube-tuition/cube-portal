'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import {
  fetchAllTerms,
  formatTermLabel,
  formatTermRange,
  filterByTerm,
} from '../../../lib/terms'
import PortalNav from '../../../components/PortalNav'
import CourseDetail, {
  inferSubject,
  subjectColor,
  subjectsMatch,
} from '../../../components/CourseDetail'

export default function ArchiveTermPage() {
  const params = useParams()
  const router = useRouter()
  const termId = params?.termId

  const [student, setStudent] = useState(null)
  const [term, setTerm] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [courses, setCourses] = useState([])
  const [activeCourseId, setActiveCourseId] = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [results, setResults] = useState([])
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile } = await supabase
        .from('students').select('*').eq('id', user.id).single()
      setStudent(profile)

      // Find this archived term
      const all = await fetchAllTerms()
      const t = all.find(x => x.id === termId)
      if (!t) { setNotFound(true); setLoading(false); return }
      setTerm(t)

      // Enrolled courses (current enrolments — we don't track historical enrolment).
      let classData
      const r1 = await supabase
        .from('student_classes')
        .select('classes(id, class_name, day_of_week, start_time, end_time, teacher, room, subject)')
        .eq('student_id', user.id)
      if (r1.error) {
        const r2 = await supabase
          .from('student_classes')
          .select('classes(id, class_name, day_of_week, start_time, end_time, teacher, room)')
          .eq('student_id', user.id)
        classData = r2.data
      } else {
        classData = r1.data
      }
      const list = (classData?.map(d => d.classes) || []).filter(Boolean)
      setCourses(list)
      setActiveCourseId(list[0]?.id || null)

      const [{ data: qz }, { data: ex }, { data: at }] = await Promise.all([
        supabase.from('quiz_results')
          .select('subject, week, score, max_score, quiz_date, homework_grade')
          .eq('student_id', user.id)
          .order('quiz_date', { ascending: true }),
        supabase.from('results')
          .select('score, created_at, exams(name, max_score, exam_date, subjects(name))')
          .eq('student_id', user.id)
          .order('created_at', { ascending: false }),
        supabase.from('attendance')
          .select('class_id, session_date, status, notes')
          .eq('student_id', user.id)
          .order('session_date', { ascending: false }),
      ])
      setQuizzes(qz || [])
      setResults(ex || [])
      setAttendance(at || [])
      setLoading(false)
    }
    load()
  }, [termId])

  const activeCourse = useMemo(
    () => courses.find(c => c.id === activeCourseId) || null,
    [courses, activeCourseId]
  )
  const activeSubject = activeCourse ? inferSubject(activeCourse) : null
  const col = subjectColor(activeSubject)

  const termQuizzes    = useMemo(() => filterByTerm(quizzes,    'quiz_date',          term), [quizzes, term])
  const termResults    = useMemo(() => filterByTerm(results,    'exams.exam_date',    term), [results, term])
  const termAttendance = useMemo(() => filterByTerm(attendance, 'session_date',       term), [attendance, term])

  const courseQuizzes    = useMemo(() => termQuizzes.filter(q => subjectsMatch(q.subject, activeSubject)),                                  [termQuizzes, activeSubject])
  const courseExams      = useMemo(() => termResults.filter(r => subjectsMatch(r.exams?.subjects?.name, activeSubject)),                    [termResults, activeSubject])
  const courseAttendance = useMemo(() => termAttendance.filter(a => a.class_id === activeCourse?.id),                                       [termAttendance, activeCourse?.id])

  if (notFound) {
    return (
      <div className="min-h-screen bg-white">
        <PortalNav studentName={student?.full_name} />
        <div className="max-w-3xl mx-auto px-6 md:px-10 py-20 text-center">
          <div className="text-5xl mb-3">🔍</div>
          <h1 className="text-2xl font-bold text-[#2A2035] font-display mb-2">Term not found</h1>
          <p className="text-sm text-[#2A2035]/60 mb-6">
            That term isn't in your archive — it may have been removed or the link is wrong.
          </p>
          <Link href="/archive" className="inline-block bg-[#325099] text-white text-sm font-semibold px-4 py-2 rounded-full hover:bg-[#062E63] transition">
            Back to archive
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student?.full_name} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 md:py-14">
          <Link
            href="/archive"
            className="inline-flex items-center gap-2 text-xs tracking-[0.25em] uppercase text-[#325099] font-semibold mb-5 hover:text-[#062E63] transition"
          >
            <span>←</span> Archive
          </Link>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">
              Archived term
            </p>
            {term && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#325099]" />
                {formatTermLabel(term)}
              </span>
            )}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight text-[#2A2035] mb-2 font-display">
            {term ? formatTermLabel(term) : 'Term'}
          </h1>
          {term && (
            <p className="text-sm text-[#2A2035]/70">{formatTermRange(term)}</p>
          )}
        </div>
      </section>

      {/* COURSE TAB BAR */}
      {courses.length > 0 && (
        <div className="border-b border-[#DEE7FF] bg-white sticky top-[57px] md:top-[64px] z-30">
          <div className="max-w-7xl mx-auto px-6 md:px-10">
            <div className="flex gap-1 overflow-x-auto -mx-2 px-2 py-2 no-scrollbar">
              {courses.map(c => {
                const subj = inferSubject(c)
                const sc = subjectColor(subj)
                const active = c.id === activeCourseId
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveCourseId(c.id)}
                    className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition border"
                    style={{
                      background: active ? sc.bg : '#ffffff',
                      borderColor: active ? sc.fg : '#DEE7FF',
                      color: active ? sc.fg : '#2A2035',
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.line }} />
                    {c.class_name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {loading ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center text-sm text-[#2A2035]/50">
            Loading the archive…
          </div>
        ) : !activeCourse ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center">
            <div className="text-4xl mb-2">📭</div>
            <p className="text-sm font-semibold text-[#2A2035]">Nothing recorded for this term.</p>
          </div>
        ) : (
          <CourseDetail
            course={activeCourse}
            subject={activeSubject}
            col={col}
            quizzes={courseQuizzes}
            exams={courseExams}
            attendance={courseAttendance}
          />
        )}
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">
            © CUBE Tuition · Chatswood
          </p>
        </div>
      </footer>

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  )
}

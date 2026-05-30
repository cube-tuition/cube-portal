'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import {
  fetchAllTerms,
  getCurrentTerm,
  formatTermLabel,
  formatTermRange,
  filterByTerm,
} from '../../lib/terms'
import PortalNav from '../../components/PortalNav'
import CourseDetail, {
  inferSubject,
  subjectColor,
  subjectsMatch,
} from '../../components/CourseDetail'
import { T_ATTENDANCE, T_ENROLMENTS, T_QUIZ_RESULTS, T_RESULTS, T_STUDENTS } from '../../lib/tables'

export default function Results() {
  const [student, setStudent] = useState(null)
  const [courses, setCourses] = useState([])
  const [activeCourseId, setActiveCourseId] = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [results, setResults] = useState([])
  const [attendance, setAttendance] = useState([])
  const [currentTerm, setCurrentTerm] = useState(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!requireStudent(user, router)) return

      const { data: profile } = await supabase
        .from(T_STUDENTS).select('*').eq('id', user.id).single()
      setStudent(profile)

      // ── Current term ────────────────────────────────────────────────────
      const terms = await fetchAllTerms()
      const term = getCurrentTerm(terms)
      setCurrentTerm(term)

      // ── Enrolled classes (try with `subject`, fall back without) ────────
      let classData
      const r1 = await supabase
        .from(T_ENROLMENTS)
        .select('classes(id, class_name, day_of_week, start_time, end_time, teacher, room, subject)')
        .eq('student_id', user.id)
      if (r1.error) {
        const r2 = await supabase
          .from(T_ENROLMENTS)
          .select('classes(id, class_name, day_of_week, start_time, end_time, teacher, room)')
          .eq('student_id', user.id)
        classData = r2.data
      } else {
        classData = r1.data
      }
      const list = (classData?.map(d => d.classes) || []).filter(Boolean)
      setCourses(list)
      setActiveCourseId(list[0]?.id || null)

      // ── Pull broad data; we'll filter by term in-memory ─────────────────
      const { data: quizData } = await supabase
        .from(T_QUIZ_RESULTS)
        .select('subject, week, score, max_score, quiz_date, homework_grade')
        .eq('student_id', user.id)
        .order('quiz_date', { ascending: true })
      setQuizzes(quizData || [])

      const { data: examData } = await supabase
        .from(T_RESULTS)
        .select('score, created_at, exams(name, max_score, exam_date, subjects(name))')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false })
      setResults(examData || [])

      const { data: attData } = await supabase
        .from(T_ATTENDANCE)
        .select('class_id, session_date, status, notes')
        .eq('student_id', user.id)
        .order('session_date', { ascending: false })
      setAttendance(attData || [])

      setLoading(false)
    }
    load()
  }, [])

  const activeCourse = useMemo(
    () => courses.find(c => c.id === activeCourseId) || null,
    [courses, activeCourseId]
  )
  const activeSubject = activeCourse ? inferSubject(activeCourse) : null
  const col = subjectColor(activeSubject)

  // Term-scoped filters
  const termQuizzes = useMemo(
    () => filterByTerm(quizzes, 'quiz_date', currentTerm),
    [quizzes, currentTerm]
  )
  const termResults = useMemo(
    () => filterByTerm(results, 'exams.exam_date', currentTerm),
    [results, currentTerm]
  )
  const termAttendance = useMemo(
    () => filterByTerm(attendance, 'session_date', currentTerm),
    [attendance, currentTerm]
  )

  // Then per-course filters
  const courseQuizzes = useMemo(
    () => termQuizzes.filter(q => subjectsMatch(q.subject, activeSubject)),
    [termQuizzes, activeSubject]
  )
  const courseExams = useMemo(
    () => termResults.filter(r => subjectsMatch(r.exams?.subjects?.name, activeSubject)),
    [termResults, activeSubject]
  )
  const courseAttendance = useMemo(
    () => termAttendance.filter(a => a.class_id === activeCourse?.id),
    [termAttendance, activeCourse?.id]
  )

  return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student?.full_name} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">
              How you're tracking
            </p>
            {currentTerm && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#325099]" />
                {formatTermLabel(currentTerm)}
              </span>
            )}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Results & Analytics
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            {currentTerm
              ? `Showing this term's quizzes, homework, exams and attendance. ${formatTermRange(currentTerm)}.`
              : "Pick a course — see your quizzes, homework, exams and attendance."}
            {' '}
            <Link href="/archive" className="text-[#325099] font-semibold hover:text-[#062E63]">
              Past terms →
            </Link>
          </p>
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
            Loading your data…
          </div>
        ) : courses.length === 0 ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center">
            <div className="text-4xl mb-2">📚</div>
            <p className="text-sm font-semibold text-[#2A2035]">You're not enrolled in any classes yet.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">Once you're enrolled, your courses will show up here as tabs.</p>
          </div>
        ) : !activeCourse ? null : (
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

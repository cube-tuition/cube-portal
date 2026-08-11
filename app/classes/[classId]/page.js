'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { requireStudent } from '../../../lib/requireStudent'
import PortalNav from '../../../components/PortalNav'
import CourseDetail, { inferSubject, subjectColor, subjectsMatch } from '../../../components/CourseDetail'
import { fetchAllTerms, getEnrolmentTerm, getCurrentTerm, weekOfTerm, solutionsUnlockAt, formatTermLabel, filterByTerm } from '../../../lib/terms'
import { T_ATTENDANCE, T_QUIZ_RESULTS, T_RESULTS, T_STUDENTS } from '../../../lib/tables'

/*
 * One class — /classes/<id> (student portal)
 *
 * Week tabs across the top open whatever has been set for that week: an online
 * workbook the student types into, or the PDFs for a printed one. Below that
 * sits the results and analytics that used to be the whole of /results, scoped
 * to this class.
 */

const WEEKS = Array.from({ length: 10 }, (_, i) => i + 1)

export default function ClassPage() {
  const router = useRouter()
  const { classId } = useParams()
  const [student, setStudent] = useState(null)
  const [cls, setCls] = useState(null)
  const [term, setTerm] = useState(null)
  const [clsTerm, setClsTerm] = useState(null)   // the term THIS class runs in — drives the solutions unlock
  const [assignments, setAssignments] = useState([])
  const [week, setWeek] = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [results, setResults] = useState([])
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  // Captured once at mount: the unlock check must be pure during render.
  const [now] = useState(() => Date.now())

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      if (!requireStudent(user, router)) return
      const { data: profile } = await supabase.from(T_STUDENTS).select('*').eq('id', user.id).single()
      setStudent(profile)

      // Enrolment is the gate: this page only ever shows a class the student is in.
      const { data: enrol } = await supabase.from('enrolments')
        .select('id').eq('class_id', classId).eq('student_id', user.id).eq('status', 'active').maybeSingle()
      if (!enrol) { setErr('That isn’t one of your classes.'); setLoading(false); return }

      // No `subject` column on classes — the subject is read off the class name.
      const { data: c, error: cErr } = await supabase.from('classes')
        .select('id, class_name, day_of_week, start_time, end_time, teacher, room, term_id')
        .eq('id', classId).maybeSingle()
      if (cErr) { setErr('This class couldn’t be loaded: ' + cErr.message); setLoading(false); return }
      setCls(c || null)

      const terms = await fetchAllTerms()
      const t = getEnrolmentTerm(terms)
      setTerm(t)
      setClsTerm(terms.find(x => x.id === c?.term_id) || t)

      const { data: asg } = await supabase.from('class_booklet_assignments')
        .select('id, term_number, week, booklets(id, booklet_name, year, subject, topic, file_path, file_paths, pdf_filenames, is_exam, delivery)')
        .eq('class_id', classId)
      const rows = (asg || []).filter(a => a.booklets)
      setAssignments(rows)
      // Land on TODAY's week of the running term, so the page opens where the
      // class actually is. (It used to open on the latest week with content,
      // which jumps ahead when future weeks are pre-loaded.) Outside term time
      // there is no "current week", so fall back to the latest week with work.
      const nowWeek = weekOfTerm(getCurrentTerm(terms))
      const withWork = rows.map(a => a.week).filter(w => w >= 1 && w <= 10).sort((a, b) => a - b)
      setWeek(nowWeek ? Math.min(nowWeek, 10)
                      : (withWork.length ? withWork[withWork.length - 1] : null))

      const [{ data: q }, { data: ex }, { data: att }] = await Promise.all([
        supabase.from(T_QUIZ_RESULTS)
          .select('subject, week, score, max_score, quiz_date, homework_grade')
          .eq('student_id', user.id).order('quiz_date', { ascending: true }),
        supabase.from(T_RESULTS)
          .select('score, created_at, exams(name, max_score, exam_date, subjects(name))')
          .eq('student_id', user.id).order('created_at', { ascending: false }),
        supabase.from(T_ATTENDANCE)
          .select('class_id, session_date, status, notes')
          .eq('student_id', user.id).order('session_date', { ascending: false }),
      ])
      setQuizzes(q || []); setResults(ex || []); setAttendance(att || [])
      setLoading(false)
    })()
  }, [classId, router])

  const subject = cls ? inferSubject(cls) : null
  const col = subjectColor(subject)

  const courseQuizzes = useMemo(
    () => filterByTerm(quizzes, 'quiz_date', term).filter(q => subjectsMatch(q.subject, subject)),
    [quizzes, term, subject])
  const courseExams = useMemo(
    () => filterByTerm(results, 'exams.exam_date', term).filter(r => subjectsMatch(r.exams?.subjects?.name, subject)),
    [results, term, subject])
  const courseAttendance = useMemo(
    () => filterByTerm(attendance, 'session_date', term).filter(a => String(a.class_id) === String(classId)),
    [attendance, term, classId])

  const byWeek = useMemo(() => {
    const m = {}
    for (const a of assignments) (m[a.week] ||= []).push(a.booklets)
    return m
  }, [assignments])

  const weekItems = week != null ? (byWeek[week] || []) : []

  // A printed workbook opens in a read-only viewer rather than as a file link,
  // so it can be read in class without handing the PDF over — and the solutions
  // copy is filtered out however the files happen to be ordered.
  const studentPdfs = (b) => {
    const paths = b.file_paths?.length ? b.file_paths : (b.file_path ? [b.file_path] : [])
    return paths.filter(p => !/_solutions|_teacher|\.mt\./i.test(p || ''))
  }
  const hasSolutionsPdf = (b) => {
    const paths = b.file_paths?.length ? b.file_paths : (b.file_path ? [b.file_path] : [])
    return paths.some(p => /_solutions|_teacher|\.mt\./i.test(p || ''))
  }
  // The solutions copy for week w unlocks once the NEXT lesson has finished —
  // one week after the week-w lesson, at lesson end time — so the homework due
  // in between can't be copied from the answers.
  const solutionsUnlocked = (w) => {
    const at = solutionsUnlockAt(clsTerm, cls?.day_of_week, cls?.end_time, w)
    return at ? now >= at.getTime() : false
  }

  if (err) return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student?.full_name} />
      <p className="text-center text-sm text-[#B23A3A] mt-20">{err}</p>
      <p className="text-center mt-3"><Link href="/classes" className="text-xs text-[#325099] hover:underline">← Your classes</Link></p>
    </div>
  )

  return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student?.full_name} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 md:py-12">
          <Link href="/classes" className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63]">← Your classes</Link>
          <div className="flex items-center gap-2 mt-3 mb-2">
            {term && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.line }} />
                {formatTermLabel(term)}
              </span>
            )}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#2A2035] font-display">{cls?.class_name || 'Class'}</h1>
          {cls && (
            <p className="text-sm text-[#2A2035]/65 mt-2">
              {[cls.day_of_week, cls.start_time && `${String(cls.start_time).slice(0, 5)}–${String(cls.end_time).slice(0, 5)}`, cls.teacher]
                .filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </section>

      {/* WEEK TABS */}
      <div className="border-b border-[#DEE7FF] bg-white sticky top-[57px] md:top-[64px] z-30">
        <div className="max-w-7xl mx-auto px-6 md:px-10">
          {/* justify-between spreads the ten tabs across the full row on
              desktop; when the row is narrower than the tabs (mobile) the
              overflow-x scroll takes over and the spread is a no-op. */}
          <div className="flex items-center justify-between gap-1 overflow-x-auto -mx-2 px-2 py-2 no-scrollbar">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#2A2035]/35 pr-1">Week</span>
            {WEEKS.map(w => {
              const has = (byWeek[w] || []).length > 0
              const active = w === week
              return (
                <button
                  key={w}
                  onClick={() => setWeek(w)}
                  title={has ? `${byWeek[w].length} item${byWeek[w].length === 1 ? '' : 's'} for week ${w}` : `Nothing set for week ${w} yet`}
                  className="shrink-0 w-9 h-9 rounded-full text-sm font-semibold transition border relative"
                  style={{
                    background: active ? col.bg : '#fff',
                    borderColor: active ? col.fg : '#DEE7FF',
                    color: active ? col.fg : has ? '#2A2035' : '#B9C2D6',
                  }}
                >
                  {w}
                  {has && !active && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: col.line }} />}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-8">
        {/* WEEK RESOURCES */}
        <div className="rounded-2xl border border-[#DEE7FF] bg-white overflow-hidden mb-8">
          <div className="px-5 md:px-6 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF] flex items-center gap-2">
            <p className="text-xs font-bold text-[#325099]">
              {week != null ? `Week ${week}` : 'Weekly work'}
            </p>
            <span className="text-[11px] text-[#2A2035]/40">workbooks & resources</span>
          </div>
          {loading ? (
            <p className="px-6 py-6 text-sm text-[#2A2035]/40">Loading…</p>
          ) : weekItems.length === 0 ? (
            <p className="px-6 py-6 text-sm text-[#2A2035]/45 italic">
              {week == null ? 'Nothing has been set for this class yet.' : `Nothing set for week ${week} yet.`}
            </p>
          ) : (
            <div className="divide-y divide-[#F0F4FF]">
              {weekItems.map(b => {
                const online = b.delivery === 'online'
                const pdfs = studentPdfs(b)
                return (
                  <div key={b.id} className="px-5 md:px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#2A2035]">{b.booklet_name}</p>
                      <p className="text-[11px] text-[#2A2035]/45 mt-0.5">
                        {online ? 'Online workbook — type your answers in the portal' : pdfs.length ? 'Workbook — read it in the portal' : 'No file attached yet'}
                        {b.topic ? ` · ${b.topic}` : ''}
                      </p>
                    </div>
                    {online ? (
                      <a
                        href={`/workbook/${b.id}?class=${classId}`}
                        target="_blank" rel="noopener noreferrer"
                        className="shrink-0 px-4 py-2 rounded-xl bg-[#0E7A5F] text-white text-xs font-bold hover:bg-[#0B5F4A] transition"
                      >🌐 Open workbook ↗</a>
                    ) : pdfs.length ? (
                      <a
                        href={`/workbook/view/${b.id}?class=${classId}`}
                        target="_blank" rel="noopener noreferrer"
                        className="shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition"
                        style={{ background: col.bg, color: col.fg }}
                      >📄 Open workbook ↗</a>
                    ) : null}
                    {/* Solutions unlock a week after this week's lesson ends —
                        i.e. once the next lesson has finished — so the homework
                        due in between can't be copied from the answers. */}
                    {!online && hasSolutionsPdf(b) && (
                      solutionsUnlocked(week) ? (
                        <a
                          href={`/workbook/view/${b.id}?class=${classId}&copy=solutions`}
                          target="_blank" rel="noopener noreferrer"
                          className="shrink-0 px-4 py-2 rounded-xl text-xs font-bold border transition text-[#0E7A5F] border-[#BFE3D4] bg-[#F0FAF6] hover:bg-[#E2F5EC]"
                        >✅ Solutions ↗</a>
                      ) : (
                        <span
                          title={(() => {
                            const at = solutionsUnlockAt(clsTerm, cls?.day_of_week, cls?.end_time, week)
                            return at ? `Solutions unlock ${at.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Solutions unlock after your next lesson'
                          })()}
                          className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold border border-[#E3E8F4] bg-[#F8FAFF] text-[#2A2035]/40 cursor-default"
                        >🔒 Solutions after next lesson</span>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* RESULTS & ANALYTICS */}
        {loading ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center text-sm text-[#2A2035]/50">Loading your data…</div>
        ) : cls ? (
          <CourseDetail
            course={cls}
            subject={subject}
            col={col}
            quizzes={courseQuizzes}
            exams={courseExams}
            attendance={courseAttendance}
          />
        ) : null}
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">© CUBE Tuition · Chatswood</p>
        </div>
      </footer>

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  )
}

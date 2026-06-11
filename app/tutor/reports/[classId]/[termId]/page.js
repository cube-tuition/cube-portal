'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Bar, ComposedChart, Cell, BarChart, Legend,
} from 'recharts'
import { supabase } from '../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../lib/getProfile'
import { fetchAllTerms, formatTermLabel } from '../../../../../lib/terms'
import { inferSubject, subjectColor, subjectsMatch } from '../../../../../components/CourseDetail'
import { T_ATTENDANCE, T_CLASSES, T_ENROLMENTS, T_PREPOST_SCORES, T_PREPOST_TESTS, T_QUIZ_RESULTS, T_TERM_COMMENTS, T_TERM_CRITERIA } from '../../../../../lib/tables'

/*
 * Printable end-of-term report bundle — one page per student.
 *
 * URL: /tutor/reports/[classId]/[termId]
 * Admin opens, clicks the "Print / Save as PDF" button, browser produces a
 * single PDF with all enrolled students. CSS page-break ensures clean splits.
 */

const ATT_COLOR = {
  present: '#10b981',
  late:    '#f59e0b',
  absent:  '#ef4444',
  makeup:  '#8b5cf6',
  excused: '#6366f1',
  none:    '#D1D5DB',
}
const HW_NUMERIC = { A: 5, B: 4, C: 3, D: 2, E: 1 }
const HW_LABEL   = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E' }

function isoToDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number)
  if (!y) return null
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}
function weekNumber(date, term) {
  if (!date || !term) return null
  const start = isoToDate(term.start_date)
  if (!start) return null
  const ms = date.getTime() - start.getTime()
  if (ms < 0) return null
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 7)) + 1
}

export default function ReportPage() {
  const params = useParams()
  const router = useRouter()
  const classId = params?.classId
  const termId  = params?.termId

  const [staff, setStaff] = useState(null)
  const [cls, setCls] = useState(null)
  const [term, setTerm] = useState(null)
  const [roster, setRoster] = useState([])
  const [attendance, setAttendance] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [comments, setComments] = useState({})        // studentId → comment
  const [savingPDFs, setSavingPDFs] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [saveComplete, setSaveComplete] = useState(false)
  const [criteria, setCriteria] = useState({})        // studentId → { subject_knowledge, ... }
  const [prepost,  setPrepost]  = useState(null)      // { topics, totalMarks, scores: { [studentId]: { pre, post } } }
  const [examData, setExamData] = useState(null)      // { topics, marks, sillyMistakes, maxScores }
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile || (profile.role !== 'admin' && profile.role !== 'tutor')) {
        router.push('/tutor'); return
      }
      setStaff(profile)

      // Class
      const { data: c, error: ce } = await supabase
        .from(T_CLASSES).select('*').eq('id', classId).single()
      if (ce || !c) { setError('Class not found.'); setLoading(false); return }

      // Tutors can only view their own class reports
      if (profile.role === 'tutor') {
        const firstName = (profile.full_name || '').split(' ')[0].toLowerCase()
        const teacherFirst = (c.teacher || '').split(' ')[0].toLowerCase()
        if (firstName && teacherFirst && firstName !== teacherFirst) {
          router.push('/tutor'); return
        }
      }
      setCls(c)

      // Term
      const terms = await fetchAllTerms()
      const t = (terms || []).find(x => x.id === termId)
      if (!t) { setError('Term not found.'); setLoading(false); return }
      setTerm(t)

      // Roster
      const { data: links } = await supabase
        .from(T_ENROLMENTS)
        .select('students (id, full_name, school, year)')
        .eq('class_id', classId)
      const students = (links || []).map(l => l.students).filter(Boolean)
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
      setRoster(students)

      if (students.length === 0) { setLoading(false); return }
      const ids = students.map(s => s.id)

      // Attendance for this class in the term
      const { data: att } = await supabase
        .from(T_ATTENDANCE)
        .select('student_id, session_date, status, notes')
        .eq('class_id', classId)
        .in('student_id', ids)
        .gte('session_date', t.start_date)
        .lte('session_date', t.end_date)
      setAttendance(att || [])

      // Quizzes for the roster + subject + term
      const subj = inferSubject(c)
      const { data: qz } = await supabase
        .from(T_QUIZ_RESULTS)
        .select('student_id, subject, week, score, max_score, homework_grade, quiz_date')
        .in('student_id', ids)
        .gte('quiz_date', t.start_date)
        .lte('quiz_date', t.end_date)
      setQuizzes((qz || []).filter(q => subjectsMatch(q.subject, subj)))

      // Term comments
      const { data: tc } = await supabase
        .from(T_TERM_COMMENTS)
        .select('student_id, comment')
        .eq('class_id', classId)
        .eq('term_id', termId)
      const cmtMap = {}
      for (const r of tc || []) cmtMap[r.student_id] = r.comment || ''
      setComments(cmtMap)

      // Term criteria
      const { data: cr } = await supabase
        .from(T_TERM_CRITERIA)
        .select('student_id, subject_knowledge, class_participation, class_behaviour, homework_effort')
        .eq('class_id', classId)
        .eq('term_id', termId)
      const crMap = {}
      for (const r of cr || []) crMap[r.student_id] = r
      setCriteria(crMap)

      // Pre/post test
      const { data: ppTest } = await supabase
        .from(T_PREPOST_TESTS)
        .select('id, topics')
        .eq('class_id', classId)
        .eq('term_id', t.id)
        .maybeSingle()
      if (ppTest) {
        const { data: ppScores } = await supabase
          .from(T_PREPOST_SCORES)
          .select('student_id, test_type, scores')
          .eq('test_id', ppTest.id)
          .in('student_id', ids)
        const scoreMap = {}
        for (const r of ppScores || []) {
          if (!scoreMap[r.student_id]) scoreMap[r.student_id] = { pre: [], post: [] }
          scoreMap[r.student_id][r.test_type] = r.scores || []
        }
        const topics = ppTest.topics || []
        const totalMarks = topics.reduce((s, tp) => s + (Number(tp.marks) || 0), 0)
        setPrepost({ topics, totalMarks, scores: scoreMap })
      }

      // Exam marks
      const termNumber = t.term_number
      const [{ data: cbaRows }, { data: examRows }] = await Promise.all([
        supabase
          .from('class_booklet_assignments')
          .select('booklet_id, booklets(topic)')
          .eq('class_id', classId)
          .eq('term_number', termNumber),
        supabase
          .from('exam_marks')
          .select('student_id, topic, section, score, max_score, silly_mistakes')
          .eq('class_id', classId)
          .eq('term_id', termId),
      ])
      const examTopics = [...new Set(
        (cbaRows || []).map(r => r.booklets?.topic).filter(tp => tp && tp !== 'Exam')
      )]
      const mMap  = { '1': {}, '2': {} }
      const smMap = { '1': {}, '2': {} }
      const xMap  = { '1': {}, '2': {} }
      for (const m of examRows || []) {
        const sec = m.section || '2'
        if (!mMap[sec][m.student_id])  mMap[sec][m.student_id]  = {}
        if (!smMap[sec][m.student_id]) smMap[sec][m.student_id] = {}
        mMap[sec][m.student_id][m.topic]  = m.score ?? ''
        smMap[sec][m.student_id][m.topic] = m.silly_mistakes ?? 0
        xMap[sec][m.topic] = m.max_score
      }
      setExamData({ topics: examTopics, marks: mMap, sillyMistakes: smMap, maxScores: xMap })

      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, termId])

  // Group attendance + quizzes by student for fast lookup
  const byStudent = useMemo(() => {
    const m = new Map()
    for (const s of roster) m.set(s.id, { attendance: [], quizzes: [] })
    for (const a of attendance) {
      if (!m.has(a.student_id)) m.set(a.student_id, { attendance: [], quizzes: [] })
      m.get(a.student_id).attendance.push(a)
    }
    for (const q of quizzes) {
      if (!m.has(q.student_id)) m.set(q.student_id, { attendance: [], quizzes: [] })
      m.get(q.student_id).quizzes.push(q)
    }
    return m
  }, [roster, attendance, quizzes])

  const saveAllToStorage = async () => {
    setSavingPDFs(true)
    setSavedCount(0)
    setSaveComplete(false)

    // Dynamic imports — avoids SSR issues
    const htmlToImage = await import('html-to-image')
    const { jsPDF }   = await import('jspdf')

    let count = 0
    for (const student of roster) {
      const wrapper = document.getElementById(`student-report-${student.id}`)
      if (!wrapper) continue

      const articles = wrapper.querySelectorAll('article.report-page')
      if (!articles.length) continue

      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })

      for (let i = 0; i < articles.length; i++) {
        const dataUrl = await htmlToImage.toJpeg(articles[i], {
          quality:         0.92,
          pixelRatio:      2,
          backgroundColor: '#ffffff',
          skipFonts:       false,
        })
        // Get image dimensions to calculate PDF height
        const img = new window.Image()
        await new Promise(res => { img.onload = res; img.src = dataUrl })
        const pdfW = pdf.internal.pageSize.getWidth()
        const pdfH = (img.height * pdfW) / img.width
        if (i > 0) pdf.addPage()
        pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfW, pdfH)
      }

      const pdfBlob = pdf.output('blob')
      const path    = `${termId}/${student.id}_${classId}.pdf`
      await supabase.storage
        .from('term-reports')
        .upload(path, pdfBlob, { upsert: true, contentType: 'application/pdf' })

      count++
      setSavedCount(count)
    }

    setSavingPDFs(false)
    setSaveComplete(true)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <p className="text-sm text-[#2A2035]/60">Loading report…</p>
    </div>
  )
  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="text-center">
        <p className="text-sm text-[#B23A3A] font-semibold mb-3">{error}</p>
        <Link href="/tutor/reports" className="text-xs font-semibold text-[#325099] hover:text-[#062E63]">← Back to reports</Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFF] print:bg-white">
      {/* Action bar — hidden when printing */}
      <div className="print:hidden sticky top-0 z-50 bg-white border-b border-[#DEE7FF]">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/tutor/reports" className="text-xs font-semibold text-[#325099] hover:text-[#062E63]">
            ← Reports
          </Link>
          <div className="text-sm font-semibold text-[#2A2035]">
            {cls.class_name} · {term ? formatTermLabel(term) : '—'} · {roster.length} student{roster.length === 1 ? '' : 's'}
          </div>
          <div className="flex items-center gap-2">
            {saveComplete && (
              <span className="text-xs font-semibold text-[#10b981]">✓ {savedCount} reports saved</span>
            )}
            <button
              type="button"
              onClick={saveAllToStorage}
              disabled={savingPDFs || roster.length === 0}
              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] hover:bg-[#F0F4FF] px-4 py-2 rounded-full transition disabled:opacity-40"
            >
              {savingPDFs ? `Saving ${savedCount}/${roster.length}…` : '☁ Save to Storage'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="text-xs font-semibold text-white bg-[#062E63] hover:bg-[#325099] px-4 py-2 rounded-full transition"
            >
              Print / Save as PDF
            </button>
          </div>
        </div>
      </div>

      {/* One report per student, page-break between them */}
      <div className="report-bundle max-w-5xl mx-auto py-8 print:py-0 space-y-8 print:space-y-0">
        {roster.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <p className="text-sm font-semibold text-[#2A2035]">No students enrolled in this class.</p>
          </div>
        ) : roster.map((s, i) => (
          <StudentReport
            key={s.id}
            student={s}
            cls={cls}
            term={term}
            roster={roster}
            attendance={byStudent.get(s.id)?.attendance || []}
            quizzes={byStudent.get(s.id)?.quizzes || []}
            comment={comments[s.id] || ''}
            criteria={criteria[s.id] || {}}
            prepost={prepost}
            examData={examData}
            isLast={i === roster.length - 1}
          />
        ))}
      </div>

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 10mm; }

          /* Force every element to print its background colour / image */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          body { background: white; }

          /* Scale the whole bundle down so the 5xl-wide content fits A4 */
          .report-bundle {
            zoom: 0.74;
            max-width: 100% !important;
          }

          .report-page { page-break-after: always; break-after: page; margin-bottom: 0 !important; }
          .report-page:last-child { page-break-after: auto; break-after: auto; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  )
}

const CRITERIA_FIELDS = [
  { key: 'subject_knowledge',   label: 'Subject Knowledge & Understanding' },
  { key: 'class_participation', label: 'Class Participation & Engagement' },
  { key: 'class_behaviour',     label: 'Class Behaviour' },
  { key: 'homework_effort',     label: 'Homework Effort & Completion' },
]
const GRADE_STYLE = {
  A: { solid: '#10B981', label: '#10B981' },   // green
  B: { solid: '#325099', label: '#325099' },   // blue
  C: { solid: '#F59E0B', label: '#F59E0B' },   // amber
  D: { solid: '#EF4444', label: '#EF4444' },   // red
}

function StudentReport({ student, cls, term, roster, attendance, quizzes, comment, criteria, prepost, examData, isLast }) {
  const col = subjectColor(inferSubject(cls))

  // Build per-week dataset
  const weekly = useMemo(() => {
    const attByWeek = new Map()
    for (const a of attendance) {
      const w = weekNumber(isoToDate(a.session_date), term)
      if (!w) continue
      const order = { absent: 3, late: 2, excused: 1, makeup: 1, present: 0 }
      const prev = attByWeek.get(w)
      if (!prev || (order[a.status] || 0) > (order[prev.status] || 0)) attByWeek.set(w, a)
    }
    const quizByWeek = new Map()
    for (const q of quizzes) {
      const m = String(q.week || '').match(/(\d+)/)
      if (!m) continue
      quizByWeek.set(parseInt(m[1], 10), q)
    }
    const out = []
    for (let w = 1; w <= 10; w++) {
      const att  = attByWeek.get(w)
      const quiz = quizByWeek.get(w)
      const score = quiz?.score != null && quiz?.max_score
        ? Math.round((quiz.score / quiz.max_score) * 100) : null
      const status = att?.status || null
      const hw = quiz?.homework_grade || null
      out.push({
        week: `Wk ${w}`, score,
        attended: status === 'present' || status === 'late' || status === 'makeup' ? 1 : (status ? 0 : null),
        status, hw, hwNum: hw ? HW_NUMERIC[hw] || null : null,
      })
    }
    return out
  }, [attendance, quizzes, term])

  // Aggregate stats
  const stats = useMemo(() => {
    const scored = quizzes.filter(q => q.score != null && q.max_score)
    const avgRq  = scored.length
      ? Math.round(scored.reduce((a, q) => a + (q.score / q.max_score) * 100, 0) / scored.length) : null
    const attTotal   = attendance.length
    const attPresent = attendance.filter(a => a.status === 'present' || a.status === 'late' || a.status === 'makeup').length
    const attPct  = attTotal ? Math.round((attPresent / attTotal) * 100) : null
    const hwTotal = quizzes.length
    const hwGrades = quizzes.map(q => q.homework_grade).filter(Boolean)
    const hwFreq = {}
    for (const g of hwGrades) hwFreq[g] = (hwFreq[g] || 0) + 1
    let hwMode = null, hwModeCount = 0
    for (const [g, c] of Object.entries(hwFreq)) {
      if (c > hwModeCount) { hwModeCount = c; hwMode = g }
    }
    return { avgRq, attPct, attTotal, hwMode, hwTotal, scoredCount: scored.length }
  }, [quizzes, attendance])

  const reportHeader = (pageNum) => (
    <header className="flex items-start justify-between gap-4 border-b border-[#DEE7FF] pb-4 mb-5">
      <div className="min-w-0">
        <p className="text-[10px] tracking-[0.3em] uppercase font-semibold font-display mb-1" style={{ color: col.fg }}>
          End-of-term report · {term ? formatTermLabel(term) : ''} · Page {pageNum} of 2
        </p>
        <h1 className="text-2xl font-bold text-[#2A2035] font-display leading-tight">
          {student.full_name || 'Unknown student'}
        </h1>
        <p className="text-xs text-[#2A2035]/60 mt-0.5">
          {student.school || ''}{student.year ? ` · Year ${student.year}` : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-[#2A2035]">
          {cls.class_name}{cls.teacher ? ` with ${cls.teacher}` : ''}
        </p>
      </div>
    </header>
  )

  const pageFooter = (
    <footer className="mt-6 pt-3 border-t border-[#DEE7FF] flex items-center justify-between text-[10px] text-[#2A2035]/50">
      <span>CUBE Tuition · Chatswood</span>
      <span>{cls.class_name} · {term ? formatTermLabel(term) : ''}</span>
    </footer>
  )

  return (
    <div id={`student-report-${student.id}`}>
      {/* ── PAGE 1: Stats + Criteria + Teacher comment ── */}
      <article className="report-page bg-white rounded-2xl border border-[#DEE7FF] p-8 mb-4">
        {reportHeader(1)}

        {/* Stat row */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatBox label="Quiz average" value={stats.avgRq != null ? `${stats.avgRq}%` : '—'} sub={`${stats.scoredCount} quiz${stats.scoredCount === 1 ? '' : 'zes'}`} />
          <StatBox label="Previous week's HWK" value={stats.hwMode ?? '—'} sub={`${stats.hwTotal} week${stats.hwTotal === 1 ? '' : 's'} logged`} />
          <StatBox label="Attendance"   value={stats.attPct != null ? `${stats.attPct}%` : '—'} sub={`${stats.attTotal} session${stats.attTotal === 1 ? '' : 's'}`} />
        </div>

        {/* Criteria + Comment — stacked */}
        <div className="space-y-5 mb-2">

          {/* Criteria card */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded-full" style={{ background: col.fg }} />
              <h2 className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: col.fg }}>Student Criteria</h2>
            </div>
            <div className="rounded-xl overflow-hidden border border-[#E8EDF8]">
              {/* Grade header */}
              <div className="grid grid-cols-[1fr_repeat(4,2rem)] bg-[#F4F7FF] px-3 py-2 border-b border-[#E8EDF8]">
                <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#6B7CB8]">Criterion</span>
                {['A','B','C','D'].map(g => (
                  <span key={g} className="text-[9px] font-bold tracking-[0.15em] uppercase text-[#6B7CB8] text-center">{g}</span>
                ))}
              </div>
              {CRITERIA_FIELDS.map((c, ci) => {
                const grade = criteria[c.key] || null
                return (
                  <div
                    key={c.key}
                    className={`grid grid-cols-[1fr_repeat(4,2rem)] items-center px-3 py-2.5 border-b last:border-0 border-[#EEF1F9] ${ci % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFD]'}`}
                  >
                    <span className="text-[11px] text-[#3A3550] leading-snug pr-2">{c.label}</span>
                    {['A','B','C','D'].map(g => {
                      const active = grade === g
                      const st = GRADE_STYLE[g]
                      return (
                        <div key={g} className="flex items-center justify-center">
                          {active ? (
                            <span
                              className="w-6 h-6 rounded-full flex items-center justify-center shadow-sm"
                              style={{ background: st.solid }}
                            >
                              <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                                <path d="M1 4L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </span>
                          ) : (
                            <span
                              className="w-6 h-6 rounded-full border-2"
                              style={{ borderColor: st.solid + '40', background: st.solid + '0D' }}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Teacher comment card */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded-full" style={{ background: col.fg }} />
              <h2 className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: col.fg }}>Teacher Comment</h2>
            </div>
            <div className="rounded-xl border border-[#E8EDF8] bg-[#F9FAFD] p-4 relative overflow-hidden">
              <span
                className="absolute top-2 right-3 text-5xl font-serif leading-none select-none pointer-events-none"
                style={{ color: col.fg + '18' }}
              >"</span>
              {comment.trim() ? (
                <p className="text-[12px] text-[#2A2035] leading-relaxed whitespace-pre-wrap relative z-10">{comment}</p>
              ) : (
                <p className="text-[11px] text-[#2A2035]/35 italic relative z-10">No comment recorded for this term.</p>
              )}
              {cls.teacher && (
                <p className="mt-3 pt-3 border-t border-[#E8EDF8] text-[10px] font-semibold tracking-[0.15em] uppercase" style={{ color: col.fg + 'BB' }}>
                  — {cls.teacher}
                </p>
              )}
            </div>
          </section>

          {/* Pre / Post test results */}
          {(() => {
            const topics     = prepost?.topics || []
            const totalMarks = prepost?.totalMarks || 0
            const studentPP  = prepost?.scores?.[student.id]
            const preScores  = studentPP?.pre  || []
            const postScores = studentPP?.post || []
            const hasPreData  = preScores.some(s => s != null && s !== '')
            const hasPostData = postScores.some(s => s != null && s !== '')
            const preTotal   = hasPreData  ? preScores.reduce((a, b) => a + (b != null ? Number(b) : 0), 0) : null
            const postTotal  = hasPostData ? postScores.reduce((a, b) => a + (b != null ? Number(b) : 0), 0) : null
            const prePct     = preTotal  != null && totalMarks ? Math.round((preTotal  / totalMarks) * 100) : null
            const postPct    = postTotal != null && totalMarks ? Math.round((postTotal / totalMarks) * 100) : null
            const improvement = prePct != null && postPct != null ? postPct - prePct : null

            return (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1 h-4 rounded-full" style={{ background: col.fg }} />
                  <h2 className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: col.fg }}>Pre / Post Test</h2>
                </div>

                {!prepost || (!hasPreData && !hasPostData) ? (
                  <div className="rounded-xl border border-[#E8EDF8] bg-[#F9FAFD] px-4 py-3">
                    <p className="text-[11px] text-[#2A2035]/35 italic">No pre/post test data recorded for this term.</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#E8EDF8] overflow-hidden">

                    {/* Summary tiles */}
                    <div className="grid grid-cols-3 divide-x divide-[#E8EDF8]">
                      <div className="px-4 py-3 bg-[#FEF2F2]">
                        <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#EF4444]/70 mb-1">Pre-test</p>
                        <p className="text-xl font-bold text-[#EF4444] tabular-nums">{prePct != null ? `${prePct}%` : '—'}</p>
                        {preTotal != null && <p className="text-[9px] text-[#2A2035]/50 mt-0.5">{preTotal} / {totalMarks} marks</p>}
                      </div>
                      <div className="px-4 py-3 bg-[#EFF6FF]">
                        <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#325099]/70 mb-1">Post-test</p>
                        <p className="text-xl font-bold text-[#325099] tabular-nums">{postPct != null ? `${postPct}%` : '—'}</p>
                        {postTotal != null && <p className="text-[9px] text-[#2A2035]/50 mt-0.5">{postTotal} / {totalMarks} marks</p>}
                      </div>
                      <div className={`px-4 py-3 ${improvement == null ? 'bg-[#F9FAFD]' : improvement >= 0 ? 'bg-[#F0FDF4]' : 'bg-[#FFF7ED]'}`}>
                        <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#2A2035]/50 mb-1">Improvement</p>
                        <p className="text-xl font-bold tabular-nums" style={{
                          color: improvement == null ? '#9CA3AF' : improvement >= 0 ? '#10B981' : '#F59E0B'
                        }}>
                          {improvement == null ? '—' : `${improvement >= 0 ? '+' : ''}${improvement}pp`}
                        </p>
                        {improvement != null && <p className="text-[9px] text-[#2A2035]/50 mt-0.5">percentage points</p>}
                      </div>
                    </div>

                    {/* Per-topic breakdown */}
                    {topics.length > 0 && (
                      <div className="border-t border-[#E8EDF8]">
                        <table className="w-full text-[10px] border-collapse">
                          <thead>
                            <tr className="bg-[#F8FAFF] border-b border-[#E8EDF8]">
                              <th className="text-left px-3 py-2 font-semibold text-[#6B7CB8]">Topic</th>
                              <th className="text-center px-2 py-2 font-semibold text-[#EF4444]">Pre</th>
                              <th className="text-center px-2 py-2 font-semibold text-[#325099]">Post</th>
                              <th className="text-center px-2 py-2 font-semibold text-[#6B7CB8]">Change</th>
                            </tr>
                          </thead>
                          <tbody>
                            {topics.map((t, i) => {
                              const ps  = preScores[i]  ?? null
                              const qs  = postScores[i] ?? null
                              const tPre  = ps != null && t.marks ? Math.round((Number(ps)  / t.marks) * 100) : null
                              const tPost = qs != null && t.marks ? Math.round((Number(qs) / t.marks) * 100) : null
                              const tDelta = tPre != null && tPost != null ? tPost - tPre : null
                              return (
                                <tr key={i} className={`border-b last:border-0 border-[#EEF1F9] ${i % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFD]'}`}>
                                  <td className="px-3 py-1.5 text-[#3A3550]">
                                    {t.name}
                                    {t.questions && <span className="ml-1.5 text-[9px] text-[#325099]/50 font-medium">{t.questions}</span>}
                                  </td>
                                  <td className="px-2 py-1.5 text-center font-semibold text-[#EF4444] tabular-nums">
                                    {tPre != null ? `${tPre}%` : <span className="text-[#CBD5E1]">—</span>}
                                  </td>
                                  <td className="px-2 py-1.5 text-center font-semibold text-[#325099] tabular-nums">
                                    {tPost != null ? `${tPost}%` : <span className="text-[#CBD5E1]">—</span>}
                                  </td>
                                  <td className="px-2 py-1.5 text-center font-semibold tabular-nums" style={{
                                    color: tDelta == null ? '#CBD5E1' : tDelta >= 0 ? '#10B981' : '#F59E0B'
                                  }}>
                                    {tDelta == null ? '—' : `${tDelta >= 0 ? '+' : ''}${tDelta}pp`}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )
          })()}

        </div>

        {pageFooter}
      </article>

      {/* ── PAGE 2: Class tracker + Exam analytics ── */}
      <article className={`report-page bg-white rounded-2xl border border-[#DEE7FF] p-8 ${isLast ? '' : 'mb-8'}`}>
        {reportHeader(2)}

        {/* RQ trend chart */}
        <section className="mb-6">
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-[#325099] mb-1">Revision quiz trend</h2>
          <p className="text-xs text-[#2A2035]/60 mb-3">
            RQ % per week (Wk 2–9) · attendance shaded · previous week's HWK grade shown below each week
          </p>

          {/* Chart — Wk 2–9 only */}
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <ComposedChart
                data={weekly.filter(d => d.week !== 'Wk 1' && d.week !== 'Wk 10')}
                margin={{ top: 8, right: 64, bottom: 8, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#DEE7FF" />

                {/* Custom X tick: week label + HW badge underneath */}
                <XAxis
                  dataKey="week"
                  height={52}
                  interval={0}
                  stroke="#DEE7FF"
                  tick={(props) => {
                    const { x, y, payload } = props
                    const wd = weekly.find(d => d.week === payload.value)
                    const hw = wd?.hw || null
                    const hwStyle = {
                      A: { bg: '#D1FAE5', fg: '#065F46' },
                      B: { bg: '#DEE7FF', fg: '#062E63' },
                      C: { bg: '#FEF3C7', fg: '#92400E' },
                      D: { bg: '#FFEDD5', fg: '#9A3412' },
                      E: { bg: '#FEE2E2', fg: '#991B1B' },
                    }
                    const c = hw ? hwStyle[hw] : null
                    return (
                      <g transform={`translate(${x},${y})`}>
                        {/* Week label */}
                        <text x={0} y={0} dy={13} textAnchor="middle" fill="#6B7280" fontSize={10}>
                          {payload.value}
                        </text>
                        {/* HW badge */}
                        {c ? (
                          <>
                            <rect x={-11} y={18} width={22} height={15} rx={5} fill={c.bg} />
                            <text x={0} y={29} textAnchor="middle" fill={c.fg} fontSize={9} fontWeight="bold">{hw}</text>
                          </>
                        ) : (
                          <text x={0} y={30} textAnchor="middle" fill="#CBD5E1" fontSize={9}>—</text>
                        )}
                      </g>
                    )
                  }}
                />

                <YAxis
                  yAxisId="score"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={v => `${v}%`}
                  tick={{ fontSize: 11, fill: '#374151', fontWeight: 500 }}
                  axisLine={{ stroke: '#DEE7FF' }}
                  tickLine={{ stroke: '#DEE7FF' }}
                  width={52}
                />
                <YAxis yAxisId="att" hide domain={[0, 1]} />

                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]?.payload || {}
                    return (
                      <div className="bg-white border border-[#DEE7FF] rounded-xl p-3 text-xs shadow-lg">
                        <p className="font-semibold text-[#2A2035] mb-1">{label}</p>
                        <p>RQ score: {row.score == null ? '—' : `${row.score}%`}</p>
                        <p>Prev week's HWK: {row.hw || '—'}</p>
                        <p>Attendance: {row.status || '—'}</p>
                      </div>
                    )
                  }}
                />

                {/* Attendance shading */}
                <Bar yAxisId="att" dataKey="attended" barSize={40} fillOpacity={0.25}>
                  {weekly
                    .filter(d => d.week !== 'Wk 1' && d.week !== 'Wk 10')
                    .map((d, i) => <Cell key={i} fill={ATT_COLOR[d.status] || ATT_COLOR.none} />)}
                </Bar>

                {/* RQ line */}
                <Line
                  yAxisId="score"
                  type="monotone"
                  dataKey="score"
                  stroke={col.line}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: col.line, strokeWidth: 0 }}
                  connectNulls
                />

                <ReferenceLine
                  yAxisId="score" y={70} stroke="#10b981" strokeDasharray="4 4"
                  label={{ value: 'Good (70%)', position: 'insideTopRight', fill: '#10b981', fontSize: 9, fontWeight: 600 }}
                />
                <ReferenceLine
                  yAxisId="score" y={50} stroke="#f59e0b" strokeDasharray="4 4"
                  label={{ value: 'Pass (50%)', position: 'insideTopRight', fill: '#f59e0b', fontSize: 9, fontWeight: 600 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-[#2A2035]/70">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: col.line }} /> RQ score
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm opacity-40" style={{ background: ATT_COLOR.present }} /> Present
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm opacity-40" style={{ background: ATT_COLOR.late }} /> Late
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm opacity-40" style={{ background: ATT_COLOR.absent }} /> Absent
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm opacity-40" style={{ background: ATT_COLOR.makeup }} /> Makeup
            </span>
            <span className="text-[#2A2035]/40">·</span>
            <span className="text-[#2A2035]/60">Previous week's HWK badge below each week</span>
          </div>

          {/* Weekly tracker table — Wk 2–9 only */}
          <table className="w-full text-xs mt-4 border-collapse">
            <thead>
              <tr className="bg-[#F8FAFF] border-y border-[#DEE7FF]">
                <th className="text-left px-3 py-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099] w-[14%]">Week</th>
                <th className="text-center px-2 py-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]">Attendance</th>
                <th className="text-center px-2 py-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]">Previous week's HWK</th>
                <th className="text-center px-2 py-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]">RQ %</th>
              </tr>
            </thead>
            <tbody>
              {weekly.filter(r => r.week !== 'Wk 1' && r.week !== 'Wk 10').map(r => (
                <tr key={r.week} className="border-b last:border-0 border-[#DEE7FF]">
                  <td className="px-3 py-1.5 font-semibold text-[#2A2035]">{r.week}</td>
                  <td className="px-2 py-1.5 text-center">
                    {r.status ? (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{
                        background: r.status === 'present' ? '#D1FAE5' : r.status === 'late' ? '#FEF3C7' : r.status === 'absent' ? '#FEE2E2' : r.status === 'makeup' ? '#EDE9FE' : '#E0E7FF',
                        color:      r.status === 'present' ? '#065F46' : r.status === 'late' ? '#92400E' : r.status === 'absent' ? '#991B1B' : r.status === 'makeup' ? '#5B21B6' : '#3730A3',
                      }}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
                    ) : <span className="text-[#2A2035]/30">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {r.hw ? (
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                        background: r.hw === 'A' ? '#D1FAE5' : r.hw === 'B' ? '#DEE7FF' : r.hw === 'C' ? '#FEF3C7' : r.hw === 'D' ? '#FFEDD5' : '#FEE2E2',
                        color:      r.hw === 'A' ? '#065F46' : r.hw === 'B' ? '#062E63' : r.hw === 'C' ? '#92400E' : r.hw === 'D' ? '#9A3412' : '#991B1B',
                      }}>{r.hw}</span>
                    ) : <span className="text-[#2A2035]/30">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-[#2A2035]">
                    {r.score == null ? <span className="text-[#2A2035]/30 font-normal">—</span> : `${r.score}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Exam analytics */}
        <section className="mb-6">
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-[#325099] mb-3">Exam analytics</h2>
          <ExamAnalyticsReport
            student={student}
            roster={roster}
            examData={examData}
            col={col}
            rqAvg={stats.avgRq}
          />
        </section>

        {pageFooter}
      </article>
    </div>
  )
}

// ── Exam analytics (report view) ─────────────────────────────────────────────

const EXAM_SECTIONS = [
  { id: '1', label: 'S1', subtitle: 'Multiple Choice', color: '#325099' },
  { id: '2', label: 'S2', subtitle: 'Short Answer',    color: '#7C3AED' },
]

function examScoreColor(p) {
  if (p == null) return '#9CA3AF'
  if (p >= 80)   return '#10B981'
  if (p >= 60)   return '#F59E0B'
  return '#EF4444'
}
function examScoreBg(p) {
  if (p == null) return '#F3F4F6'
  if (p >= 80)   return '#D1FAE5'
  if (p >= 60)   return '#FEF3C7'
  return '#FEE2E2'
}
function examPct(score, max) {
  if (!max || score == null || score === '') return null
  return Math.round((Number(score) / Number(max)) * 100)
}

function ExamAnalyticsReport({ student, roster, examData, col, rqAvg }) {
  if (!examData) return (
    <div className="rounded-xl border border-[#E8EDF8] bg-[#F9FAFD] px-4 py-3">
      <p className="text-[11px] text-[#2A2035]/35 italic">No exam data loaded.</p>
    </div>
  )

  const { topics, marks, sillyMistakes, maxScores } = examData

  // Check if this student has any marks entered
  const hasAny = EXAM_SECTIONS.some(sec =>
    topics.some(t => {
      const v = marks[sec.id]?.[student.id]?.[t]
      return v != null && v !== ''
    })
  )

  if (!hasAny || topics.length === 0) return (
    <div className="rounded-xl border border-[#E8EDF8] bg-[#F9FAFD] px-4 py-3">
      <p className="text-[11px] text-[#2A2035]/35 italic">No exam marks recorded for this term.</p>
    </div>
  )

  // Per-section totals for this student
  const sectionTotal = (secId) => {
    let score = 0, max = 0, sm = 0
    for (const t of topics) {
      const m = Number(maxScores[secId]?.[t] ?? 0)
      const v = marks[secId]?.[student.id]?.[t]
      const s = Number(sillyMistakes[secId]?.[student.id]?.[t] ?? 0)
      if (m && v != null && v !== '') { score += Number(v); max += m; sm += s }
    }
    return max > 0 ? { score, max, pct: Math.round((score / max) * 100), sm } : null
  }

  // Overall
  const overallTotal = () => {
    let score = 0, max = 0, sm = 0
    for (const sec of EXAM_SECTIONS) {
      const t = sectionTotal(sec.id)
      if (t) { score += t.score; max += t.max; sm += t.sm }
    }
    return max > 0 ? { score, max, pct: Math.round((score / max) * 100), sm } : null
  }
  const overall = overallTotal()

  // Class averages per topic per section
  const classAvgAt = (secId, topic) => {
    const max = Number(maxScores[secId]?.[topic] ?? 0)
    if (!max || !roster?.length) return null
    const vals = roster
      .map(s => examPct(marks[secId]?.[s.id]?.[topic], max))
      .filter(p => p != null)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  // Chart data: per topic, student % and class avg % for each section
  const chartData = topics.map(topic => {
    const entry = { topic }
    for (const sec of EXAM_SECTIONS) {
      const max = Number(maxScores[sec.id]?.[topic] ?? 0)
      entry[`s${sec.id}`]       = max ? examPct(marks[sec.id]?.[student.id]?.[topic], max) : null
      entry[`s${sec.id}Avg`]    = classAvgAt(sec.id, topic)
    }
    return entry
  })

  // Strengths / weaknesses (combined per topic)
  const topicCombinedPct = (topic) => {
    let score = 0, max = 0
    for (const sec of EXAM_SECTIONS) {
      const m = Number(maxScores[sec.id]?.[topic] ?? 0)
      const v = marks[sec.id]?.[student.id]?.[topic]
      if (m && v != null && v !== '') { score += Number(v); max += m }
    }
    return max > 0 ? Math.round((score / max) * 100) : null
  }
  const topicList = topics.map(t => ({ topic: t, pct: topicCombinedPct(t) })).filter(d => d.pct != null)
  const strengths  = topicList.filter(d => d.pct >= 80).sort((a, b) => b.pct - a.pct)
  const weaknesses = topicList.filter(d => d.pct < 60).sort((a, b) => a.pct - b.pct)
  const totalSM = EXAM_SECTIONS.reduce((sum, sec) =>
    sum + topics.reduce((s2, t) => s2 + Number(sillyMistakes[sec.id]?.[student.id]?.[t] ?? 0), 0), 0)

  /*
   * RQ-weighted expected range
   * ─────────────────────────────────────────────────────────────────
   * Formula:
   *   centre = round(RQ_avg × 0.92)
   *     → 0.92 discount: exams are ~8% harder on average than weekly
   *       quizzes (cumulative content, time pressure, longer questions).
   *       This factor is a calibrated heuristic; adjust as data accumulates.
   *   lower  = max(0,   centre − 10)
   *   upper  = min(100, centre + 10)
   *     → ±10 pp band absorbs normal variance between quiz and exam
   *       conditions (nerves, question style, recall under pressure).
   * Status:
   *   actual > upper        → "Exceeded"
   *   lower ≤ actual ≤ upper → "On track"
   *   actual < lower         → "Below expected"
   */
  const expectedRange = (() => {
    if (rqAvg == null || overall == null) return null
    const centre = Math.round(rqAvg * 0.92)
    const lower  = Math.max(0,   centre - 10)
    const upper  = Math.min(100, centre + 10)
    const actual = overall.pct
    const status = actual > upper   ? 'exceeded'
                 : actual >= lower  ? 'on_track'
                 : 'below'
    return { centre, lower, upper, actual, status }
  })()

  const ExamChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'white', border: '1px solid #DEE7FF', borderRadius: 8, padding: '8px 12px', fontSize: 10 }}>
        <p style={{ fontWeight: 700, color: '#062E63', marginBottom: 4 }}>{label}</p>
        {payload.map(p => (
          <p key={p.name} style={{ color: p.color ?? p.fill, margin: '2px 0' }}>
            {p.name}: <strong>{p.value != null ? `${p.value}%` : '—'}</strong>
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#E8EDF8] overflow-hidden">
      {/* Summary tiles */}
      <div className="grid divide-x divide-[#E8EDF8]" style={{ gridTemplateColumns: `repeat(${EXAM_SECTIONS.length + 2}, 1fr)` }}>
        {EXAM_SECTIONS.map(sec => {
          const t = sectionTotal(sec.id)
          return (
            <div key={sec.id} className="px-4 py-3 bg-[#F9FAFD]">
              <p className="text-[9px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: sec.color + 'AA' }}>
                {sec.label} — {sec.subtitle}
              </p>
              {t ? (
                <>
                  <p className="text-xl font-bold tabular-nums" style={{ color: examScoreColor(t.pct) }}>{t.pct}%</p>
                  <p className="text-[9px] mt-0.5" style={{ color: '#2A2035AA' }}>{t.score} / {t.max} marks</p>
                </>
              ) : <p className="text-lg font-bold text-[#CBD5E1]">—</p>}
            </div>
          )
        })}
        <div className="px-4 py-3 bg-[#F0F4FF]">
          <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#325099]/60 mb-1">Overall</p>
          {overall ? (
            <>
              <p className="text-xl font-bold tabular-nums" style={{ color: examScoreColor(overall.pct) }}>{overall.pct}%</p>
              <p className="text-[9px] mt-0.5 text-[#2A2035]/50">{overall.score} / {overall.max} marks</p>
            </>
          ) : <p className="text-lg font-bold text-[#CBD5E1]">—</p>}
        </div>
        {/* Expected range tile */}
        <div className="px-4 py-3 bg-[#FFFBEB]">
          <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-amber-600/70 mb-1">Expected range</p>
          {expectedRange ? (
            <>
              <p className="text-xl font-bold tabular-nums text-amber-700">
                {expectedRange.lower}–{expectedRange.upper}%
              </p>
              <p className={`text-[9px] font-bold mt-0.5 ${
                expectedRange.status === 'exceeded'  ? 'text-emerald-600' :
                expectedRange.status === 'on_track'  ? 'text-[#325099]'  :
                'text-amber-600'
              }`}>
                {expectedRange.status === 'exceeded'  ? '↑ Exceeded'      :
                 expectedRange.status === 'on_track'  ? '✓ On track'      :
                 '↓ Below expected'}
              </p>
            </>
          ) : <p className="text-lg font-bold text-[#CBD5E1]">—</p>}
        </div>
      </div>

      {/* Expected range explanation */}
      {expectedRange && (
        <div className="border-t border-[#E8EDF8] px-4 py-2 bg-[#FFFBEB]/60 flex items-start gap-2">
          <span className="text-amber-500 text-[11px] mt-0.5">ⓘ</span>
          <p className="text-[9px] text-amber-800/70 leading-relaxed">
            <strong>Expected range</strong> is based on your revision quiz average of{' '}
            <strong>{rqAvg}%</strong> (RQ avg × 0.92, ±10 pp). It predicts a consistent exam
            performance of <strong>{expectedRange.lower}–{expectedRange.upper}%</strong> based
            solely on your own quiz work — it does not reflect any other student's results.
          </p>
        </div>
      )}

      {/* Chart */}
      <div className="border-t border-[#E8EDF8] px-4 pt-3 pb-1">
        <p className="text-[9px] font-semibold text-[#325099]/50 uppercase tracking-wider mb-2">
          Performance by topic · Bars = student · Dashed = class average
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F4FF" />
            <XAxis dataKey="topic" tick={{ fontSize: 9, fill: '#325099' }} interval={0} angle={0} textAnchor="middle" />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9, fill: '#325099' }} width={32} />
            <Tooltip content={<ExamChartTooltip />} />
            <ReferenceLine y={80} stroke="#10B981" strokeDasharray="3 2" strokeWidth={1} />
            <ReferenceLine y={60} stroke="#F59E0B" strokeDasharray="3 2" strokeWidth={1} />
            <Bar dataKey="s1" name="S1 (student)"   fill={EXAM_SECTIONS[0].color} radius={[2,2,0,0]} maxBarSize={28} />
            <Bar dataKey="s2" name="S2 (student)"   fill={EXAM_SECTIONS[1].color} radius={[2,2,0,0]} maxBarSize={28} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Topic breakdown table */}
      <div className="border-t border-[#E8EDF8]">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="bg-[#F8FAFF] border-b border-[#E8EDF8]">
              <th className="text-left px-3 py-2 font-semibold text-[#6B7CB8]">Topic</th>
              {EXAM_SECTIONS.map(sec => (
                <th key={sec.id} className="text-center px-2 py-2 font-semibold" style={{ color: sec.color }}>
                  {sec.label}
                </th>
              ))}
              <th className="text-center px-2 py-2 font-semibold text-[#062E63]">Combined</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((topic, i) => {
              const combined = topicCombinedPct(topic)
              return (
                <tr key={topic} className={`border-b last:border-0 border-[#EEF1F9] ${i % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFD]'}`}>
                  <td className="px-3 py-1.5 font-medium text-[#3A3550]">{topic}</td>
                  {EXAM_SECTIONS.map(sec => {
                    const max   = Number(maxScores[sec.id]?.[topic] ?? 0)
                    const score = marks[sec.id]?.[student.id]?.[topic]
                    const p     = examPct(score, max)
                    const avg   = classAvgAt(sec.id, topic)
                    return (
                      <td key={sec.id} className="px-2 py-1.5 text-center">
                        {p != null ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-bold tabular-nums" style={{ color: examScoreColor(p) }}>{p}%</span>
                            <span className="text-[#325099]/40">{score}/{max}</span>
                            {avg != null && (
                              <span className="text-[8px]" style={{ color: p >= avg ? '#10B981' : '#EF4444' }}>
                                {p >= avg ? '↑' : '↓'} avg {avg}%
                              </span>
                            )}
                          </div>
                        ) : <span className="text-[#CBD5E1]">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1.5 text-center">
                    {combined != null ? (
                      <span className="inline-block font-bold text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ color: examScoreColor(combined), background: examScoreBg(combined) }}>
                        {combined}%
                      </span>
                    ) : <span className="text-[#CBD5E1]">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Strengths, weaknesses, SM */}
      {(strengths.length > 0 || weaknesses.length > 0 || totalSM > 0) && (
        <div className="border-t border-[#E8EDF8] px-4 py-3 grid grid-cols-2 gap-3 bg-[#FAFBFF]">
          {strengths.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-emerald-700 uppercase tracking-wider mb-1.5">✅ Strengths (≥80%)</p>
              <div className="flex flex-wrap gap-1">
                {strengths.map(d => (
                  <span key={d.topic} className="text-[9px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300 px-1.5 py-0.5 rounded-full">
                    {d.topic} {d.pct}%
                  </span>
                ))}
              </div>
            </div>
          )}
          {weaknesses.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-red-700 uppercase tracking-wider mb-1.5">⚠️ Needs work (&lt;60%)</p>
              <div className="flex flex-wrap gap-1">
                {weaknesses.map(d => (
                  <span key={d.topic} className="text-[9px] font-semibold bg-red-100 text-red-700 border border-red-300 px-1.5 py-0.5 rounded-full">
                    {d.topic} {d.pct}%
                  </span>
                ))}
              </div>
            </div>
          )}
          {totalSM > 0 && (
            <div className="col-span-2 border-t border-[#E8EDF8] pt-2">
              <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wider mb-1">✏️ Silly mistakes</p>
              <p className="text-[10px] text-amber-700">
                <strong>{totalSM} mark{totalSM !== 1 ? 's' : ''}</strong> attributed to silly mistakes.
                {overall && overall.max > 0 && (
                  <> Without them: <strong>{Math.min(100, Math.round(((overall.score + totalSM) / overall.max) * 100))}%</strong></>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] px-4 py-3">
      <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">{label}</p>
      <p className="text-xl font-bold text-[#2A2035] font-display tabular-nums leading-none">{value}</p>
      <p className="text-[10px] text-[#2A2035]/55 mt-1">{sub}</p>
    </div>
  )
}

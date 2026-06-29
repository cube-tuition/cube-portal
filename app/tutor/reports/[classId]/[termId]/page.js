'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../lib/getProfile'
import { fetchAllTerms, formatTermLabel } from '../../../../../lib/terms'
import { inferSubject, subjectsMatch } from '../../../../../components/CourseDetail'
import { StudentReport } from '../../../../../components/reports/StudentReport'
import PdfPreviewModal from '../../../../../components/qbank/PdfPreviewModal'
import { T_ATTENDANCE, T_CLASSES, T_ENROLMENTS, T_QUIZ_RESULTS, T_TERM_COMMENTS, T_TERM_CRITERIA } from '../../../../../lib/tables'
import { loadExamAnalysisForClass } from '../../../../../lib/examMarking'
import { loadPrePostForReport } from '../../../../../components/PrePostSection'

/*
 * Printable end-of-term report bundle — one page per student.
 *
 * URL: /tutor/reports/[classId]/[termId]
 * Admin opens, clicks the "Print / Save as PDF" button, browser produces a
 * single PDF with all enrolled students. CSS page-break ensures clean splits.
 */

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
  const [rqByWeek, setRqByWeek] = useState({})        // weekNum → has_rq (false ⇒ no revision quiz)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [preview, setPreview] = useState(null)   // { url, filename } for the in-app PDF preview
  const closePreview = () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null) }

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

      // Pre/post test (topics, scores, class averages + expected marks) for the
      // numeric summary AND the individualised charts in the report.
      const pp = await loadPrePostForReport(classId, t.id, students)
      if (pp) setPrepost(pp)

      // Exam analysis — per-question marks rolled up by topic (assigned exam).
      const examAnalysis = await loadExamAnalysisForClass({
        classId, termNumber: t.term_number, termId, roster: students,
      })
      setExamData(examAnalysis)

      // Per-week revision-quiz flag (false ⇒ class had no RQ that week).
      const { data: lessonRqRows } = await supabase
        .from('lessons')
        .select('week, has_rq, is_makeup')
        .eq('class_id', classId)
      const rqMap = {}
      for (const l of lessonRqRows || []) {
        if (l.is_makeup || l.week == null) continue
        rqMap[l.week] = l.has_rq
      }
      setRqByWeek(rqMap)

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

  // Build one combined PDF (all students' report pages) and show it in-app so the
  // bundle can be checked without downloading or going through the print dialog.
  const previewPdf = async () => {
    setBuilding(true)
    try {
      const htmlToImage = await import('html-to-image')
      const { jsPDF }   = await import('jspdf')
      const articles = document.querySelectorAll('.report-bundle article.report-page')
      if (!articles.length) { setBuilding(false); return }

      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
      for (let i = 0; i < articles.length; i++) {
        const dataUrl = await htmlToImage.toJpeg(articles[i], {
          quality: 0.92, pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: false,
        })
        const img = new window.Image()
        await new Promise(res => { img.onload = res; img.src = dataUrl })
        const pdfW = pdf.internal.pageSize.getWidth()
        const pdfH = (img.height * pdfW) / img.width
        if (i > 0) pdf.addPage()
        pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfW, pdfH)
      }
      const filename = `${cls.class_name}-${term ? formatTermLabel(term) : 'term'}-reports.pdf`
        .replace(/[^a-z0-9.-]+/gi, '-').toLowerCase()
      setPreview({ url: URL.createObjectURL(pdf.output('blob')), filename })
    } catch (e) {
      alert('Could not build the preview: ' + (e.message || e))
    } finally {
      setBuilding(false)
    }
  }

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
              onClick={previewPdf}
              disabled={building || roster.length === 0}
              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] hover:bg-[#F0F4FF] px-4 py-2 rounded-full transition disabled:opacity-40"
            >
              {building ? 'Building…' : '👁 Preview PDF'}
            </button>
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
            rqByWeek={rqByWeek}
            isLast={i === roster.length - 1}
          />
        ))}
      </div>

      <style jsx global>{`
        /* Each report page is a fixed A4-proportioned sheet (height grows only if
           content overflows), so the footer can sit at the very bottom of the page
           — pushed down by its mt-auto — instead of right after the content. */
        .report-page {
          display: flex;
          flex-direction: column;
          aspect-ratio: 210 / 297;
        }

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

      {preview && (
        <PdfPreviewModal url={preview.url} filename={preview.filename} title="Term reports — preview" onClose={closePreview} />
      )}
    </div>
  )
}


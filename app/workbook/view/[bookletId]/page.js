'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { subjectCode } from '../../../../lib/format'
import { requireStudent } from '../../../../lib/requireStudent'
import { fetchAllTerms, solutionsUnlockAt } from '../../../../lib/terms'

/*
 * Read-only view of a printed workbook — /workbook/view/<bookletId>?class=<id>&i=<n>
 *
 * Students can read the workbook in class without being handed the file: the
 * PDF is shown in the browser's viewer with its toolbar suppressed, so there
 * is no download or print button, and the file's own address is never put in
 * front of them.
 *
 * Worth being straight about the limit: any PDF a browser can display has
 * already been sent to that browser, so this discourages saving rather than
 * preventing it. Making it genuinely un-savable would mean rasterising each
 * page server-side, which costs a lot and still yields images anyone can
 * screenshot. Access itself IS enforced — enrolment is checked before the
 * viewer will show anything.
 *
 * ?copy=solutions serves the teacher/solutions PDF, but only once the time
 * gate passes: a week's solutions unlock one week after that week's lesson, at
 * lesson end time (i.e. after the NEXT lesson finishes), so the homework due
 * in between can't be copied. The gate is enforced HERE, not just on the
 * button, so pasting the URL early doesn't bypass it.
 */

function ViewerInner() {
  const { bookletId } = useParams()
  const router = useRouter()
  const params = useSearchParams()
  const classId = params.get('class')
  const idx = Number(params.get('i') || 0)
  const wantSolutions = params.get('copy') === 'solutions'

  const [booklet, setBooklet] = useState(null)
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      if (!requireStudent(user, router)) return

      if (!classId) { setErr('This link is missing its class.'); return }
      const { data: enrol } = await supabase.from('enrolments')
        .select('id').eq('class_id', classId).eq('student_id', user.id).eq('status', 'active').maybeSingle()
      if (!enrol) { setErr('This workbook belongs to a class you are not enrolled in.'); return }

      // The booklet must actually be set for this class — not just any booklet id.
      // limit(1): the same booklet can legitimately be set for two weeks of one
      // class, and any row at all means it is theirs to read.
      const { data: asgRows } = await supabase.from('class_booklet_assignments')
        .select('id, week').eq('class_id', classId).eq('booklet_id', bookletId)
      if (!asgRows?.length) { setErr('This workbook is not set for your class.'); return }

      // Solutions are time-gated: unlocked one week after the lesson of the
      // LATEST week this booklet is set for (after the next lesson finishes).
      if (wantSolutions) {
        const { data: klass } = await supabase.from('classes')
          .select('day_of_week, end_time, term_id').eq('id', classId).maybeSingle()
        const terms = await fetchAllTerms()
        const clsTerm = terms.find(t => t.id === klass?.term_id)
        const wk = Math.max(...asgRows.map(r => r.week).filter(w => w >= 1))
        const at = solutionsUnlockAt(clsTerm, klass?.day_of_week, klass?.end_time, wk)
        if (!at || Date.now() < at.getTime()) {
          setErr('The solutions for this workbook haven\u2019t been released yet — they unlock after your next lesson.')
          return
        }
      }

      const { data: b } = await supabase.from('booklets')
        .select('id, booklet_name, year, subject, file_path, file_paths, pdf_filenames')
        .eq('id', bookletId).maybeSingle()
      if (!b) { setErr('Workbook not found.'); return }
      setBooklet(b)

      const paths = b.file_paths?.length ? b.file_paths : (b.file_path ? [b.file_path] : [])
      const isSol = (p) => /_solutions|_teacher|\.mt\./i.test(p || '')
      // Student copy by default; the solutions copy only via the time-gated
      // ?copy=solutions path above.
      const pool = paths.filter(p => wantSolutions ? isSol(p) : !isSol(p))
      const pick = pool[idx] || pool[0]
      if (!pick) { setErr(wantSolutions ? 'No solutions file is attached to this workbook.' : 'No workbook file has been attached yet.'); return }
      const { data: pub } = supabase.storage.from('booklets').getPublicUrl(pick)
      // #toolbar=0 hides the built-in download / print controls in Chrome and Edge.
      setUrl(`${pub.publicUrl}#toolbar=0&navpanes=0&statusbar=0`)
    })()
  }, [bookletId, classId, idx, wantSolutions, router])

  const title = useMemo(() => {
    if (!booklet) return ''
    const code = subjectCode(booklet.subject)
    return `${booklet.year ? `${booklet.year}.${code}. ` : ''}${booklet.booklet_name}`
  }, [booklet])

  if (err) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center px-6"><p className="text-sm text-[#B23A3A] text-center max-w-md">{err}</p></div>
  if (!url) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="h-screen flex flex-col bg-[#F1F4FA]">
      <div className="bg-white border-b border-[#DEE7FF] px-5 py-2.5 flex items-center gap-3 shrink-0">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${wantSolutions ? 'border-[#BFE3D4] bg-[#F0FAF6] text-[#0E7A5F]' : 'border-[#DEE7FF] bg-[#EEF4FF] text-[#325099]'}`}>{wantSolutions ? '✅ Solutions' : '📄 Workbook'}</span>
        <span className="text-sm font-bold text-[#062E63]">{title}</span>
        <span className="ml-auto text-xs text-[#2A2035]/45">View only</span>
      </div>
      <iframe src={url} title={title} className="flex-1 w-full border-0" />
    </div>
  )
}

export default function WorkbookViewerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>}>
      <ViewerInner />
    </Suspense>
  )
}

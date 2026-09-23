'use client'
import { useState } from 'react'
import { renderExamPdf } from '../lib/qbankExams'
import { supabase } from '../lib/supabase'

/*
 * Buttons that generate an assigned exam's PDF on demand (nothing is stored).
 * The exam is held only as a reference (exam_id); the paper / solutions are
 * built fresh in the browser when a teacher clicks, then downloaded.
 *
 *   <ExamPdfButtons examId={b.exam_id} accentColor="#325099" accentBg="#EEF4FF" />
 */
export default function ExamPdfButtons({ examId, bookletId = null, onReleased = null, accentColor = '#325099', accentBg = '#EEF4FF', size = 'sm' }) {
  const [busy, setBusy] = useState(null)   // 'paper' | 'solutions' | 'release'
  const [err, setErr] = useState('')
  const [released, setReleased] = useState(false)

  if (!examId) return null

  /*
   * Release to students.
   *
   * A workbook reaches students because a PDF sits in storage and the booklet
   * row points at it. An exam has no stored file — the paper is built here, in
   * the browser, from the question bank, which students cannot read. So this
   * builds both copies once and files them exactly like a workbook's: the
   * solutions copy carries "_solutions" in its name, which is the convention
   * the student page and viewer use to tell paper from answers and to apply
   * the one-week unlock.
   */
  const release = async () => {
    if (!bookletId) return
    setErr(''); setBusy('release')
    try {
      const slug = `exam-${examId}`
      const paths = []
      const names = []
      for (const solutions of [false, true]) {
        const { url, filename } = await renderExamPdf(examId, { solutions, preview: true })
        const blob = await fetch(url).then((r) => r.blob())
        URL.revokeObjectURL(url)
        const path = `exams/${bookletId}/${slug}${solutions ? '_solutions' : ''}.pdf`
        const { error } = await supabase.storage.from('booklets')
          .upload(path, blob, { upsert: true, contentType: 'application/pdf' })
        if (error) throw error
        paths.push(path)
        names.push(filename || (solutions ? 'Solutions' : 'Exam paper'))
      }
      const { error: upErr } = await supabase.from('booklets')
        .update({ file_paths: paths, pdf_filenames: names })
        .eq('id', bookletId)
      if (upErr) throw upErr
      setReleased(true)
      onReleased?.(paths)
    } catch (e) {
      setErr(e.message || 'Could not release this exam.')
    } finally {
      setBusy(null)
    }
  }

  const make = async (solutions) => {
    setErr(''); setBusy(solutions ? 'solutions' : 'paper')
    try {
      await renderExamPdf(examId, { solutions, preview: false })   // downloads the PDF
    } catch (e) {
      setErr(e.message || 'Could not generate the PDF.')
    } finally {
      setBusy(null)
    }
  }

  const cls = size === 'lg'
    ? 'text-xs font-semibold px-4 py-2 rounded-full transition disabled:opacity-50'
    : 'text-[10px] font-bold px-2 py-0.5 rounded-lg transition disabled:opacity-50'

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => make(false)} disabled={!!busy} className={cls}
        style={{ background: accentBg, color: accentColor }} title="Generate the exam paper PDF">
        {busy === 'paper' ? '…' : '⬇ Paper'}
      </button>
      <button onClick={() => make(true)} disabled={!!busy} className={cls}
        style={{ background: accentBg, color: accentColor }} title="Generate the solutions PDF">
        {busy === 'solutions' ? '…' : '⬇ Solutions'}
      </button>
      {bookletId && (
        <button onClick={release} disabled={!!busy} className={cls}
          style={{ background: released ? '#ECF9F4' : accentBg, color: released ? '#0E7A5F' : accentColor }}
          title={released
            ? 'Released — students can open the paper, and the solutions unlock a week after the lesson'
            : 'Build the paper and solutions and publish them to students, like a workbook'}>
          {busy === 'release' ? '…' : released ? '✓ Released' : '↗ Release'}
        </button>
      )}
      {err && <span className="text-[9px] text-[#DC2626]">{err}</span>}
    </div>
  )
}

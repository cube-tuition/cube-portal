'use client'
import { useState } from 'react'
import { renderExamPdf } from '../lib/qbankExams'

/*
 * Buttons that generate an assigned exam's PDF on demand (nothing is stored).
 * The exam is held only as a reference (exam_id); the paper / solutions are
 * built fresh in the browser when a teacher clicks, then downloaded.
 *
 *   <ExamPdfButtons examId={b.exam_id} accentColor="#325099" accentBg="#EEF4FF" />
 */
export default function ExamPdfButtons({ examId, accentColor = '#325099', accentBg = '#EEF4FF', size = 'sm' }) {
  const [busy, setBusy] = useState(null)   // 'paper' | 'solutions'
  const [err, setErr] = useState('')

  if (!examId) return null

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
      {err && <span className="text-[9px] text-[#DC2626]">{err}</span>}
    </div>
  )
}

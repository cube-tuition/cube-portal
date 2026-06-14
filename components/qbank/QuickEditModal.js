'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { T_QBANK_QUESTIONS, T_QBANK_QUESTION_PARTS } from '../../lib/tables'
import LatexField from './LatexField'

/*
 * Quick edit of a bank question from the exam builder — stem, worked solution
 * and marks (and each part's prompt/solution/marks for multi-part questions).
 * Saves straight to the bank and calls onSaved so the caller can refresh.
 * For full editing (skill, difficulty, options, images) use the question editor.
 */
export default function QuickEditModal({ question, onClose, onSaved }) {
  const multipart = !!question.is_multipart
  const isMcq = question.qtype === 'mcq'
  const [stem, setStem] = useState(question.stem_latex || '')
  const [solution, setSolution] = useState(question.solution_latex || '')
  const [marks, setMarks] = useState(question.marks ?? '')
  const [parts, setParts] = useState(
    (question.qbank_question_parts || [])
      .slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((p) => ({ id: p.id, part_label: p.part_label || '', prompt_latex: p.prompt_latex || '', solution_latex: p.solution_latex || '', marks: p.marks ?? '' })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const setPart = (id, field, val) => setParts((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: val } : p)))

  const save = async () => {
    setSaving(true); setError('')
    try {
      const payload = { stem_latex: stem }
      if (!multipart) {
        payload.solution_latex = solution
        if (!isMcq) payload.marks = marks === '' ? null : Number(marks)
      }
      const { error: e } = await supabase.from(T_QBANK_QUESTIONS).update(payload).eq('id', question.id)
      if (e) throw e
      if (multipart) {
        for (const p of parts) {
          const { error: pe } = await supabase.from(T_QBANK_QUESTION_PARTS).update({
            prompt_latex: p.prompt_latex,
            solution_latex: p.solution_latex,
            marks: p.marks === '' ? null : Number(p.marks),
          }).eq('id', p.id)
          if (pe) throw pe
        }
      }
      onSaved?.()
    } catch (e) {
      setError(e.message || 'Could not save changes.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#0B1020]/60 backdrop-blur-sm overflow-y-auto py-8" onClick={() => !saving && onClose?.()}>
      <div className="bg-white rounded-2xl border border-[#E5ECFF] w-full max-w-2xl mx-4 p-5 space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-[#062E63] flex-1">Quick edit question</h2>
          <span className="text-[10px] text-[#2A2035]/40">Saves to the question bank</span>
        </div>

        <LatexField label={multipart ? 'Stem / intro' : 'Question text'} value={stem} onChange={setStem} rows={3}
          hint="Use $…$ for inline math, $$…$$ for display" />

        {!multipart && (
          <>
            <LatexField label={isMcq ? 'Explanation' : 'Worked solution'} value={solution} onChange={setSolution} rows={3} />
            {!isMcq && (
              <div>
                <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Marks</label>
                <input type="number" min="0" value={marks} onChange={(e) => setMarks(e.target.value)}
                  className="w-24 border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#325099]" />
              </div>
            )}
          </>
        )}

        {multipart && parts.map((p) => (
          <div key={p.id} className="rounded-xl border border-[#DEE7FF] bg-[#FBFCFF] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#062E63]">Part {p.part_label})</span>
              <input type="number" min="0" value={p.marks} placeholder="marks"
                onChange={(e) => setPart(p.id, 'marks', e.target.value)}
                className="w-20 ml-auto border border-[#DEE7FF] rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#325099]" />
            </div>
            <LatexField value={p.prompt_latex} onChange={(v) => setPart(p.id, 'prompt_latex', v)} rows={2} placeholder="Part prompt…" />
            <LatexField value={p.solution_latex} onChange={(v) => setPart(p.id, 'solution_latex', v)} rows={2} placeholder="Part solution…" />
          </div>
        ))}

        {isMcq && (
          <p className="text-[11px] text-[#EA580C]">Options and the correct answer can only be edited in the full question editor.</p>
        )}
        {error && <p className="text-sm text-[#DC2626]">{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={() => !saving && onClose?.()}
            className="px-4 py-2 rounded-xl border border-[#DEE7FF] text-sm font-semibold text-[#2A2035]/60 hover:bg-[#F8FAFF] transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

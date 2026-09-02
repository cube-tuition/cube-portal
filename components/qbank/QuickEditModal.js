'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { T_QBANK_QUESTIONS, T_QBANK_QUESTION_PARTS } from '../../lib/tables'
import { MCQ_LABELS } from '../../lib/qbank'
import LatexField from './LatexField'

/*
 * Quick edit of a bank question from the exam builder — stem, worked solution,
 * marks, each part's prompt/solution/marks, and for multiple choice the options
 * themselves: their text, their order, and which one is correct.
 * Saves straight to the bank and calls onSaved so the caller can refresh.
 * For full editing (skill, difficulty, images) use the question editor.
 *
 * Options are held by a stable key rather than by their A/B/C/D label, because
 * the labels are positional: reordering relabels every option, and the correct
 * answer has to travel with its TEXT rather than stay on a letter. Labels are
 * (re)assigned from the final order on save.
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
  // Legacy rows stored the option text under `text`; the editor writes `latex`.
  const [options, setOptions] = useState(() =>
    (question.options || []).map((o, i) => ({ key: `o${i}`, latex: o.latex ?? o.text ?? '' })))
  const [correctKey, setCorrectKey] = useState(() => {
    const i = (question.options || []).findIndex((o) => o.label === question.correct_option)
    return i >= 0 ? `o${i}` : null
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setOptLatex = (key, v) => setOptions((os) => os.map((o) => (o.key === key ? { ...o, latex: v } : o)))
  const moveOpt = (i, delta) => setOptions((os) => {
    const j = i + delta
    if (j < 0 || j >= os.length) return os
    const next = os.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  // Fisher-Yates. Re-rolls if the order came out unchanged, so pressing Shuffle
  // always visibly does something (with 2 options it can only swap).
  const shuffleOpts = () => setOptions((os) => {
    if (os.length < 2) return os
    for (let attempt = 0; attempt < 8; attempt++) {
      const next = os.slice()
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      if (next.some((o, i) => o.key !== os[i].key)) return next
    }
    return os
  })

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
      if (isMcq) {
        // A blank option is dropped, as the full editor does. Labels come from
        // the final order, and the correct answer is looked up by key so it
        // follows its text through any reordering.
        const kept = options.filter((o) => o.latex.trim())
        if (kept.length < 2) throw new Error('A multiple-choice question needs at least two options.')
        const ci = kept.findIndex((o) => o.key === correctKey)
        if (ci < 0) throw new Error('Mark one option as the correct answer.')
        if (kept.length > MCQ_LABELS.length) throw new Error(`At most ${MCQ_LABELS.length} options.`)
        payload.options = kept.map((o, i) => ({ label: MCQ_LABELS[i], latex: o.latex }))
        payload.correct_option = MCQ_LABELS[ci]
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
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-[#062E63] flex-1">Options — select the correct one</label>
              <button type="button" onClick={shuffleOpts} disabled={options.length < 2}
                className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-2 py-1 hover:bg-[#F0F4FF] transition disabled:opacity-40">
                ⇅ Shuffle
              </button>
            </div>
            {options.map((opt, i) => (
              <div key={opt.key} className="flex items-start gap-2">
                <button type="button" onClick={() => setCorrectKey(opt.key)} title="Mark correct"
                  className={`mt-1 w-7 h-7 shrink-0 rounded-full text-xs font-bold border transition ${correctKey === opt.key ? 'bg-[#16A34A] text-white border-[#16A34A]' : 'bg-white text-[#2A2035]/50 border-[#DEE7FF] hover:border-[#16A34A]'}`}>
                  {MCQ_LABELS[i]}
                </button>
                <div className="flex-1">
                  <LatexField value={opt.latex} rows={1} onChange={(v) => setOptLatex(opt.key, v)}
                    placeholder={`Option ${MCQ_LABELS[i]}…`} />
                </div>
                <div className="flex flex-col gap-0.5 mt-0.5 shrink-0">
                  <button type="button" onClick={() => moveOpt(i, -1)} disabled={i === 0} title="Move up"
                    className="w-6 h-5 rounded border border-[#DEE7FF] text-[10px] text-[#325099] hover:bg-[#F0F4FF] transition disabled:opacity-30">▲</button>
                  <button type="button" onClick={() => moveOpt(i, 1)} disabled={i === options.length - 1} title="Move down"
                    className="w-6 h-5 rounded border border-[#DEE7FF] text-[10px] text-[#325099] hover:bg-[#F0F4FF] transition disabled:opacity-30">▼</button>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-[#2A2035]/45">
              Correct answer: <span className="font-bold text-[#16A34A]">{
                correctKey ? MCQ_LABELS[options.findIndex((o) => o.key === correctKey)] : '—'
              }</span> · letters follow the order above, and the answer moves with its text.
            </p>
            <p className="text-[11px] text-[#EA580C]">
              Reordering rewrites the question in the bank, so the answer letter changes
              everywhere it is used — including papers already printed or marked.
            </p>
          </div>
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

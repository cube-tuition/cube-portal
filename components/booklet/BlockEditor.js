'use client'

import { useState } from 'react'
import { uploadQbankImage, qbankImageUrl } from '../../lib/qbank'

/*
 * BlockEditor — inline editor for one booklet block. Renders the right fields
 * for the block type and reports changes via onChange(next). Image uploads go
 * to the shared qbank-images bucket (prefix 'booklets').
 */

const L = 'block text-[11px] font-semibold text-[#325099] mb-1'
const I = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]'
const TA = I + ' resize-y min-h-[64px] font-mono text-[13px]'

// Cmd/Ctrl+B → wrap (or unwrap) the selection in **…** for bold.
function onBold(e, value, setValue) {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b')) return
  e.preventDefault()
  const el = e.target
  const s = el.selectionStart, en = el.selectionEnd
  const sel = value.slice(s, en)
  let next, caret
  if (sel && /^\*\*[\s\S]+\*\*$/.test(sel)) {            // already bold → unwrap
    const inner = sel.slice(2, -2)
    next = value.slice(0, s) + inner + value.slice(en)
    caret = s + inner.length
  } else {
    const wrapped = sel ? `**${sel}**` : '****'
    next = value.slice(0, s) + wrapped + value.slice(en)
    caret = sel ? s + wrapped.length : s + 2
  }
  setValue(next)
  requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = caret } catch { /* noop */ } })
}

function ImageField({ value, onChange }) {
  const [busy, setBusy] = useState(false)
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try { const path = await uploadQbankImage(file, 'booklets'); onChange(path) }
    catch (e) { alert('Image upload failed: ' + e.message) }
    finally { setBusy(false) }
  }
  return (
    <div>
      <label className={L}>Diagram / image</label>
      {value ? (
        <div className="flex items-center gap-2">
          <img src={qbankImageUrl(value)} alt="" className="h-16 rounded border border-[#DEE7FF] object-contain bg-white" />
          <button onClick={() => onChange('')} className="text-[11px] text-rose-500 hover:underline">Remove</button>
        </div>
      ) : (
        <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-[#325099] border border-dashed border-[#BACBFF] rounded-lg px-3 py-1.5 cursor-pointer hover:bg-[#F0F4FF]">
          {busy ? 'Uploading…' : '＋ Upload image'}
          <input type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
        </label>
      )}
    </div>
  )
}

export default function BlockEditor({ block, onChange }) {
  const set = (patch) => onChange({ ...block, ...patch })

  switch (block.type) {
    case 'section':
      return (
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <div><label className={L}>No.</label><input className={I} value={block.number} onChange={e => set({ number: e.target.value })} placeholder="1" /></div>
          <div><label className={L}>Section title</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} /></div>
        </div>
      )
    case 'subtopic':
      return <div><label className={L}>Subtopic heading</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} /></div>
    case 'formula':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Label</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} placeholder="Formula" /></div>
          <div><label className={L}>Body (use $…$ for maths, “- ” for bullets, ⌘/Ctrl-B for bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onBold(e, block.body, v => set({ body: v }))} placeholder={'Area of a Parallelogram:\n$A = bh$\n- $b$ is the base\n- $h$ is the perpendicular height'} /></div>
          <ImageField value={block.image} onChange={v => set({ image: v })} />
        </div>
      )
    case 'note':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Label</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} placeholder="Note" /></div>
          <div><label className={L}>Body (“- ” for bullets, ⌘/Ctrl-B for bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onBold(e, block.body, v => set({ body: v }))} placeholder={'Common mistakes:\n- Using diameter instead of radius\n- Forgetting to square the radius'} /></div>
        </div>
      )
    case 'definition':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Label</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} placeholder="Definition" /></div>
          <div><label className={L}>Body ($…$ maths, “- ” bullets, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onBold(e, block.body, v => set({ body: v }))} placeholder={'A polygon is a closed 2D shape with straight sides.'} /></div>
          <ImageField value={block.image} onChange={v => set({ image: v })} />
        </div>
      )
    case 'text':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Explanation (paragraphs, “- ” bullets, $…$ maths, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onBold(e, block.body, v => set({ body: v }))} /></div>
          <ImageField value={block.image} onChange={v => set({ image: v })} />
        </div>
      )
    case 'question':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Question prompt</label><textarea className={TA} value={block.prompt} onChange={e => set({ prompt: e.target.value })} onKeyDown={e => onBold(e, block.prompt, v => set({ prompt: v }))} placeholder="Find the area of the following:" /></div>
          <div className="grid grid-cols-[1fr_90px] gap-2 items-end">
            <ImageField value={block.image} onChange={v => set({ image: v })} />
            <div><label className={L}>Marks</label><input className={I} value={block.marks} onChange={e => set({ marks: e.target.value })} placeholder="" /></div>
          </div>
          <PartsEditor parts={block.parts || []} onChange={parts => set({ parts })} />
          <div><label className={L}>Sample solution / answer (shown in Solutions copy)</label><textarea className={TA} value={block.solution} onChange={e => set({ solution: e.target.value })} onKeyDown={e => onBold(e, block.solution, v => set({ solution: v }))} placeholder={'a. 320 cm²\nb. 90 mm²'} /></div>
        </div>
      )
    case 'mcq':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Question</label><textarea className={TA} value={block.prompt} onChange={e => set({ prompt: e.target.value })} onKeyDown={e => onBold(e, block.prompt, v => set({ prompt: v }))} /></div>
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <div>
            <label className={L}>Options</label>
            <div className="space-y-1.5">
              {(block.options || []).map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 text-xs font-bold text-[#325099]">{o.k}.</span>
                  <input className={I} value={o.t} onChange={e => { const options = block.options.map((x, j) => j === i ? { ...x, t: e.target.value } : x); set({ options }) }} />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <div><label className={L}>Correct</label>
              <select className={I} value={block.answer} onChange={e => set({ answer: e.target.value })}>
                <option value="">—</option>
                {(block.options || []).map(o => <option key={o.k} value={o.k}>{o.k}</option>)}
              </select>
            </div>
            <div><label className={L}>Explanation (Solutions copy)</label><input className={I} value={block.explanation} onChange={e => set({ explanation: e.target.value })} /></div>
          </div>
        </div>
      )
    case 'mcqtable':
      return (
        <div className="space-y-2">
          <label className={L}>Answer rows</label>
          {(block.rows || []).map((r, i) => (
            <div key={i} className="grid grid-cols-[50px_60px_1fr_24px] gap-1.5 items-center">
              <input className={I} value={r.q} onChange={e => { const rows = block.rows.map((x, j) => j === i ? { ...x, q: e.target.value } : x); set({ rows }) }} placeholder="1" />
              <input className={I} value={r.answer} onChange={e => { const rows = block.rows.map((x, j) => j === i ? { ...x, answer: e.target.value } : x); set({ rows }) }} placeholder="A" />
              <input className={I} value={r.explanation} onChange={e => { const rows = block.rows.map((x, j) => j === i ? { ...x, explanation: e.target.value } : x); set({ rows }) }} placeholder="Explanation" />
              <button onClick={() => set({ rows: block.rows.filter((_, j) => j !== i) })} className="text-rose-400 hover:text-rose-600 text-sm">✕</button>
            </div>
          ))}
          <button onClick={() => set({ rows: [...(block.rows || []), { q: String((block.rows?.length || 0) + 1), answer: '', explanation: '' }] })} className="text-[11px] font-semibold text-[#325099] hover:underline">＋ Add row</button>
        </div>
      )
    case 'writing':
      return (
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <div><label className={L}>Heading (optional)</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} placeholder="Extra writing space" /></div>
          <div><label className={L}>Lines</label><input className={I} type="text" inputMode="numeric" value={block.lines} onChange={e => set({ lines: e.target.value.replace(/\D/g, '') })} /></div>
        </div>
      )
    default:
      return null
  }
}

function PartsEditor({ parts, onChange }) {
  return (
    <div>
      <label className={L}>Parts (a, b, c…) — optional</label>
      <div className="space-y-2">
        {parts.map((p, i) => (
          <div key={i} className="border border-[#E8EDF8] rounded-lg p-2 bg-[#F8FAFF]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-[#325099]">{String.fromCharCode(97 + i)}.</span>
              <button onClick={() => onChange(parts.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600 text-xs">Remove</button>
            </div>
            <input className={I + ' mb-1.5'} value={p.prompt || ''} onChange={e => onChange(parts.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x))} placeholder="Part prompt (optional)" />
            <ImageField value={p.image} onChange={v => onChange(parts.map((x, j) => j === i ? { ...x, image: v } : x))} />
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...parts, { prompt: '', image: '' }])} className="text-[11px] font-semibold text-[#325099] hover:underline mt-1">＋ Add part</button>
    </div>
  )
}

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

// Cmd/Ctrl+E → toggle centre alignment on the current line(s) by adding/removing
// a leading "-> " marker (the renderer centres lines that start with it).
function onCentre(e, value, setValue) {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e')) return
  e.preventDefault()
  const el = e.target
  const s = el.selectionStart, en = el.selectionEnd
  const lineStart = value.lastIndexOf('\n', s - 1) + 1
  let lineEnd = value.indexOf('\n', en)
  if (lineEnd === -1) lineEnd = value.length
  const segment = value.slice(lineStart, lineEnd)
  const lines = segment.split('\n')
  const nonEmpty = lines.filter(l => l.trim() !== '')
  const allCentred = nonEmpty.length > 0 && nonEmpty.every(l => /^->\s?/.test(l))
  const newSegment = lines.map(l => {
    if (l.trim() === '') return l
    return allCentred ? l.replace(/^->\s?/, '') : (/^->\s?/.test(l) ? l : `-> ${l}`)
  }).join('\n')
  const next = value.slice(0, lineStart) + newSegment + value.slice(lineEnd)
  setValue(next)
  const delta = newSegment.length - segment.length
  requestAnimationFrame(() => { try { el.selectionStart = lineStart; el.selectionEnd = lineEnd + delta } catch { /* noop */ } })
}

// Tab → indent the current line(s) by 2 spaces (a sub-dot-point); Shift+Tab →
// outdent. Prevents the default focus-change so Tab nests bullets like in Word.
function onIndent(e, value, setValue) {
  if (e.key !== 'Tab') return
  e.preventDefault()
  const el = e.target
  const s = el.selectionStart, en = el.selectionEnd
  const lineStart = value.lastIndexOf('\n', s - 1) + 1
  let lineEnd = value.indexOf('\n', en)
  if (lineEnd === -1) lineEnd = value.length
  const segment = value.slice(lineStart, lineEnd)
  const lines = segment.split('\n')
  const outdent = e.shiftKey
  const firstRemoved = outdent ? (lines[0].match(/^ {1,2}/)?.[0].length || 0) : 0
  const newSegment = lines.map(l => outdent ? l.replace(/^ {1,2}/, '') : `  ${l}`).join('\n')
  const next = value.slice(0, lineStart) + newSegment + value.slice(lineEnd)
  setValue(next)
  const delta = newSegment.length - segment.length
  requestAnimationFrame(() => {
    try {
      if (s === en) {
        const caret = outdent ? Math.max(lineStart, s - firstRemoved) : s + 2
        el.selectionStart = el.selectionEnd = caret
      } else {
        el.selectionStart = lineStart
        el.selectionEnd = lineEnd + delta
      }
    } catch { /* noop */ }
  })
}

// Superscript (⌘/Ctrl+Shift+=) and subscript (⌘/Ctrl+Shift+-): wrap the selection
// in ^…^ / ~…~ (the renderer turns these into <sup>/<sub>). Toggles off if already
// wrapped. Uses e.code so it's independent of the shifted character.
function onSubSup(e, value, setValue) {
  const mod = e.metaKey || e.ctrlKey
  if (!mod || !e.shiftKey) return
  let marker = null
  if (e.code === 'Equal' || e.key === '+' || e.key === '=') marker = '^'        // superscript
  else if (e.code === 'Minus' || e.key === '_' || e.key === '-') marker = '~'   // subscript
  if (!marker) return
  e.preventDefault()
  const el = e.target
  const s = el.selectionStart, en = el.selectionEnd
  const sel = value.slice(s, en)
  const wrapped = marker === '^' ? /^\^[\s\S]+\^$/ : /^~[\s\S]+~$/
  let next, caret
  if (sel && wrapped.test(sel)) {              // already wrapped → unwrap
    const inner = sel.slice(1, -1)
    next = value.slice(0, s) + inner + value.slice(en)
    caret = s + inner.length
  } else {
    const w = sel ? `${marker}${sel}${marker}` : `${marker}${marker}`
    next = value.slice(0, s) + w + value.slice(en)
    caret = sel ? s + w.length : s + 1
  }
  setValue(next)
  requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = caret } catch { /* noop */ } })
}

// Inline fields (table cells, options, part prompts): bold + sub/superscript.
function onInlineKey(e, value, setValue) {
  onBold(e, value, setValue)
  onSubSup(e, value, setValue)
}

// Combined handler for the rich body textareas: bold (⌘/Ctrl-B), centre (⌘/Ctrl-E),
// sub/superscript, and Tab/Shift-Tab indent for sub-dot-points.
function onTextKey(e, value, setValue) {
  onBold(e, value, setValue)
  onSubSup(e, value, setValue)
  onCentre(e, value, setValue)
  onIndent(e, value, setValue)
}

function ImageField({ value, onChange, label = 'Diagram / image' }) {
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
      <label className={L}>{label}</label>
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

// Two-column control for callout boxes: a toggle, plus a right-column textarea
// when enabled (the box's main Body becomes the left column).
function TwoColField({ block, set }) {
  return (
    <div className="rounded-lg border border-[#E6ECFF] bg-[#F7F9FF] p-2.5 space-y-2">
      <label className="flex items-center gap-2 text-[11px] font-semibold text-[#325099] cursor-pointer">
        <input type="checkbox" checked={!!block.twoCol} onChange={e => set({ twoCol: e.target.checked })} className="accent-[#325099]" />
        Split into two columns
      </label>
      {block.twoCol && (
        <div><label className={L}>Right column (“- ” bullets, $…$ maths, ⌘/Ctrl-B bold)</label>
          <textarea className={TA} value={block.body2 || ''} onChange={e => set({ body2: e.target.value })} onKeyDown={e => onTextKey(e, block.body2 || '', v => set({ body2: v }))} placeholder={'Right-hand column content…'} />
        </div>
      )}
    </div>
  )
}

export default function BlockEditor({ block, onChange, isChem = false }) {
  const set = (patch) => onChange({ ...block, ...patch })

  switch (block.type) {
    case 'section':
      return (
        <div className="space-y-2.5">
          <div className="grid grid-cols-[80px_1fr] gap-2">
            <div><label className={L}>No.</label><input className={I} value={block.number} onChange={e => set({ number: e.target.value })} placeholder="1" /></div>
            <div><label className={L}>Section title</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} /></div>
          </div>
          {isChem && (
            <div><label className={L}>Syllabus dot-points (“- ” for each point, $…$ maths, ⌘/Ctrl-B bold)</label>
              <textarea className={TA} value={block.syllabus || ''} onChange={e => set({ syllabus: e.target.value })} onKeyDown={e => onTextKey(e, block.syllabus || '', v => set({ syllabus: v }))} placeholder={'- Investigate the role of activation energy, collisions and molecular orientation in collisions'} />
            </div>
          )}
        </div>
      )
    case 'subtopic':
      return <div><label className={L}>Subtopic heading</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} /></div>
    case 'formula':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Label</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} placeholder="Formula" /></div>
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} (use $…$ for maths, “- ” for bullets, ⌘/Ctrl-B for bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Area of a Parallelogram:\n$A = bh$\n- $b$ is the base\n- $h$ is the perpendicular height'} /></div>
          <TwoColField block={block} set={set} />
          <ImageField value={block.image} onChange={v => set({ image: v })} />
        </div>
      )
    case 'note':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Label</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} placeholder="Note" /></div>
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} (“- ” for bullets, ⌘/Ctrl-B for bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Common mistakes:\n- Using diameter instead of radius\n- Forgetting to square the radius'} /></div>
          <TwoColField block={block} set={set} />
        </div>
      )
    case 'definition':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Label</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} placeholder="Definition" /></div>
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} ($…$ maths, “- ” bullets, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'A polygon is a closed 2D shape with straight sides.'} /></div>
          <TwoColField block={block} set={set} />
          <ImageField value={block.image} onChange={v => set({ image: v })} />
        </div>
      )
    case 'worked':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Label</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} placeholder="Worked Solution" /></div>
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} ($…$ maths, “- ” bullets, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Step-by-step working for the example…'} /></div>
          <TwoColField block={block} set={set} />
          <ImageField value={block.image} onChange={v => set({ image: v })} />
        </div>
      )
    case 'steps':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Label</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} placeholder="Steps" /></div>
          <div><label className={L}>Steps — one per line (auto-numbered)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Read the question carefully\nIdentify what is being asked\nChoose the correct formula\nSubstitute and solve'} /></div>
        </div>
      )
    case 'text':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Explanation (paragraphs, “- ” bullets, $…$ maths, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} /></div>
          <ImageField value={block.image} onChange={v => set({ image: v })} />
        </div>
      )
    case 'question':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Question prompt</label><textarea className={TA} value={block.prompt} onChange={e => set({ prompt: e.target.value })} onKeyDown={e => onTextKey(e, block.prompt, v => set({ prompt: v }))} placeholder="Find the area of the following:" /></div>
          <div className="grid grid-cols-[1fr_90px] gap-2 items-end">
            <ImageField value={block.image} onChange={v => set({ image: v })} />
            <div><label className={L}>Marks</label><input className={I} value={block.marks} onChange={e => set({ marks: e.target.value })} placeholder="" /></div>
          </div>
          <PartsEditor parts={block.parts || []} onChange={parts => set({ parts })} />
          {/* The question-level solution only applies to single questions; with
              parts, each part carries its own solution. */}
          {!(block.parts && block.parts.length) && (
            <>
              <div><label className={L}>Sample solution / answer (shown in Solutions copy)</label><textarea className={TA} value={block.solution} onChange={e => set({ solution: e.target.value })} onKeyDown={e => onTextKey(e, block.solution, v => set({ solution: v }))} placeholder={'a. 320 cm²\nb. 90 mm²'} /></div>
              <ImageField label="Solution diagram / image (Solutions copy)" value={block.solutionImage || ''} onChange={v => set({ solutionImage: v })} />
              <div className="w-28"><label className={L}>Answer lines</label><input className={I} type="text" inputMode="numeric" value={block.lines ?? ''} onChange={e => set({ lines: e.target.value.replace(/\D/g, '') })} placeholder="6" /></div>
            </>
          )}
        </div>
      )
    case 'mcq':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Question</label><textarea className={TA} value={block.prompt} onChange={e => set({ prompt: e.target.value })} onKeyDown={e => onTextKey(e, block.prompt, v => set({ prompt: v }))} /></div>
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <div>
            <label className={L}>Options</label>
            <div className="space-y-1.5">
              {(block.options || []).map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 text-xs font-bold text-[#325099]">{o.k}.</span>
                  <input className={I} value={o.t}
                    onChange={e => { const options = block.options.map((x, j) => j === i ? { ...x, t: e.target.value } : x); set({ options }) }}
                    onKeyDown={e => onInlineKey(e, o.t, v => { const options = block.options.map((x, j) => j === i ? { ...x, t: v } : x); set({ options }) })} />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[110px_90px_1fr] gap-2">
            <div><label className={L}>Correct</label>
              <select className={I} value={block.answer} onChange={e => set({ answer: e.target.value })}>
                <option value="">—</option>
                {(block.options || []).map(o => <option key={o.k} value={o.k}>{o.k}</option>)}
              </select>
            </div>
            <div><label className={L}>Marks</label><input className={I} value={block.marks ?? ''} onChange={e => set({ marks: e.target.value })} placeholder="1" /></div>
            <div><label className={L}>Explanation (Solutions copy)</label><input className={I} value={block.explanation} onChange={e => set({ explanation: e.target.value })} onKeyDown={e => onInlineKey(e, block.explanation, v => set({ explanation: v }))} /></div>
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
    case 'table':
      return <TableEditor block={block} set={set} />
    case 'pagebreak':
      return (
        <div className="flex items-center gap-3 py-1 text-[#2A2035]/40">
          <div className="flex-1 border-t border-dashed border-[#C7D0E0]" />
          <span className="text-[10px] font-bold uppercase tracking-widest">✂ Page break</span>
          <div className="flex-1 border-t border-dashed border-[#C7D0E0]" />
        </div>
      )
    default:
      return null
  }
}

// ── Table editor — flexible rows/cols, optional header, math/bold cells ───────
function TableEditor({ block, set }) {
  const rows = Array.isArray(block.rows) && block.rows.length ? block.rows : [['', '']]
  const nCols = rows[0]?.length || 0
  const setCell = (r, c, v) => set({ rows: rows.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? v : cell) : row) })
  const addRow = () => set({ rows: [...rows, Array(nCols || 1).fill('')] })
  const removeRow = () => { if (rows.length > 1) set({ rows: rows.slice(0, -1) }) }
  const addCol = () => set({ rows: rows.map(row => [...row, '']) })
  const removeCol = () => { if (nCols > 1) set({ rows: rows.map(row => row.slice(0, -1)) }) }
  const STEP = 'w-6 h-6 flex items-center justify-center rounded border border-[#DEE7FF] text-[#325099] hover:bg-[#F0F4FF] text-sm leading-none'
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#325099] cursor-pointer">
          <input type="checkbox" checked={!!block.headerRow} onChange={e => set({ headerRow: e.target.checked })} /> Header row
        </label>
        <div className="flex items-center gap-1.5 text-[11px] text-[#2A2035]/50">
          <span>Rows</span>
          <button type="button" onClick={removeRow} className={STEP}>−</button>
          <span className="w-4 text-center font-semibold text-[#2A2035]">{rows.length}</span>
          <button type="button" onClick={addRow} className={STEP}>+</button>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[#2A2035]/50">
          <span>Columns</span>
          <button type="button" onClick={removeCol} className={STEP}>−</button>
          <span className="w-4 text-center font-semibold text-[#2A2035]">{nCols}</span>
          <button type="button" onClick={addCol} className={STEP}>+</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="p-0.5">
                    <textarea
                      value={cell}
                      onChange={e => setCell(ri, ci, e.target.value)}
                      onKeyDown={e => onInlineKey(e, cell, v => setCell(ri, ci, v))}
                      rows={1}
                      placeholder={block.headerRow && ri === 0 ? 'Header' : ''}
                      className={`w-28 align-middle border border-[#DEE7FF] rounded px-2 py-1 text-xs text-center resize-y focus:outline-none focus:border-[#325099] ${block.headerRow && ri === 0 ? 'bg-[#EEF1F5] font-semibold' : 'bg-white'}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-[#2A2035]/40">Use $…$ for maths and **bold** in cells.</p>
    </div>
  )
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
            <input className={I + ' mb-1.5'} value={p.prompt || ''} onChange={e => onChange(parts.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x))} onKeyDown={e => onInlineKey(e, p.prompt || '', v => onChange(parts.map((x, j) => j === i ? { ...x, prompt: v } : x)))} placeholder="Part prompt (optional)" />
            <ImageField value={p.image} onChange={v => onChange(parts.map((x, j) => j === i ? { ...x, image: v } : x))} />
            <textarea className={TA + ' mt-1.5'} value={p.solution || ''} onChange={e => onChange(parts.map((x, j) => j === i ? { ...x, solution: e.target.value } : x))} onKeyDown={e => onTextKey(e, p.solution || '', v => onChange(parts.map((x, j) => j === i ? { ...x, solution: v } : x)))} placeholder={`Part ${String.fromCharCode(97 + i)} solution (shown in Solutions copy)`} />
            <div className="w-28 mt-1.5"><label className={L}>Answer lines</label><input className={I} type="text" inputMode="numeric" value={p.lines ?? ''} onChange={e => onChange(parts.map((x, j) => j === i ? { ...x, lines: e.target.value.replace(/\D/g, '') } : x))} placeholder="3" /></div>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...parts, { prompt: '', image: '', solution: '', lines: '' }])} className="text-[11px] font-semibold text-[#325099] hover:underline mt-1">＋ Add part</button>
    </div>
  )
}

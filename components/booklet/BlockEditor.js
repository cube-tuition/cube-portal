'use client'

import { useState } from 'react'
import { uploadQbankImage, qbankImageUrl } from '../../lib/qbank'
import { selectedToSyllabusText, countSelected } from '../../lib/syllabus'
import { onTextKey, onInlineKey } from '../../lib/textShortcuts'

/*
 * SectionSyllabusPicker — draw syllabus dotpoints from the master list into a
 * section header (Chemistry). Stores the selected ids on block.syllabus_points
 * and regenerates block.syllabus (the printable band text) so the renderer shows
 * them under the section header in the booklet.
 */
function SectionSyllabusPicker({ modules = [], block, onChange }) {
  const [open, setOpen] = useState(false)
  const selected = Array.isArray(block.syllabus_points) ? block.syllabus_points : []
  const sset = new Set(selected)
  const apply = (next) => {
    const ids = [...next]
    onChange({ syllabus_points: ids, syllabus: selectedToSyllabusText(modules, ids) })
  }
  const toggle = (id, on) => { const s = new Set(selected); if (on) s.add(id); else s.delete(id); apply(s) }
  const toggleGroup = (main, on) => { const s = new Set(selected); for (const x of main.subs) { if (on) s.add(x.id); else s.delete(x.id) } apply(s) }
  const count = countSelected(modules, sset)

  if (!modules.length) {
    return <p className="text-[11px] text-[#2A2035]/45">No master syllabus for this year yet — add it on the <a href="/tutor/resources/syllabus" className="underline">Syllabus</a> page.</p>
  }
  const cb = 'mt-0.5 shrink-0 accent-[#325099]'
  return (
    <div className="rounded-lg border border-[#DEE7FF] bg-[#FBFCFF]">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-semibold text-[#325099]">📚 Syllabus dotpoints{count > 0 && <span className="ml-1.5 text-[10px] font-bold text-[#16A34A]">· {count} drawn</span>}</span>
        <span className="text-[10px] text-[#325099]/60">{open ? '▲ hide' : '▼ draw'}</span>
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto px-3 pb-2 space-y-2 border-t border-[#F0F4FF]">
          {modules.map(mod => (
            <div key={mod.id}>
              <p className="text-[11px] font-bold text-[#062E63] mt-1">{mod.name}</p>
              {mod.topics.map(tp => (
                <div key={tp.id} className="mb-1">
                  <p className="text-[10px] font-semibold text-[#325099]">{tp.name}</p>
                  {tp.dotpoints.map(dp => {
                    if (dp.subs.length === 0) {
                      return (
                        <label key={dp.id} className="flex items-start gap-1.5 py-0.5 cursor-pointer">
                          <input type="checkbox" className={cb} checked={sset.has(dp.id)} onChange={e => toggle(dp.id, e.target.checked)} />
                          <span className="text-[12px] text-[#2A2035]">{dp.text}</span>
                        </label>
                      )
                    }
                    const all = dp.subs.every(s => sset.has(s.id))
                    const some = dp.subs.some(s => sset.has(s.id))
                    return (
                      <div key={dp.id}>
                        <label className="flex items-start gap-1.5 py-0.5 cursor-pointer">
                          <input type="checkbox" className={cb} checked={all} ref={el => { if (el) el.indeterminate = some && !all }} onChange={e => toggleGroup(dp, e.target.checked)} />
                          <span className="text-[12px] font-medium text-[#2A2035]">{dp.text}</span>
                        </label>
                        <div className="pl-5">
                          {dp.subs.map(s => (
                            <label key={s.id} className="flex items-start gap-1.5 py-0.5 cursor-pointer">
                              <input type="checkbox" className={cb} checked={sset.has(s.id)} onChange={e => toggle(s.id, e.target.checked)} />
                              <span className="text-[11px] text-[#2A2035]/80">{s.text}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/*
 * BlockEditor — inline editor for one booklet block. Renders the right fields
 * for the block type and reports changes via onChange(next). Image uploads go
 * to the shared qbank-images bucket (prefix 'booklets').
 */

const L = 'block text-[11px] font-semibold text-[#325099] mb-1'
const I = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]'
const TA = I + ' resize-y min-h-[64px] font-mono text-[13px]'

// ── Maths-object row editors ─────────────────────────────────────────────────
// Points/lines used to be free-text; convert legacy strings to structured rows.
const toPointRows = (v) => Array.isArray(v) ? v : String(v ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const p = l.replace(/[()]/g, '').split(',').map(x => x.trim())
  return { x: p[0] ?? '', y: p[1] ?? '', label: p.slice(2).join(', ') }
})
const toLineRows = (v) => Array.isArray(v) ? v : String(v ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const p = l.split(',').map(x => x.trim())
  return { m: p[0] ?? '', c: p[1] ?? '', label: p.slice(2).join(', ') }
})

function PointRows({ rows, onChange }) {
  const upd = (i, patch) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  return (
    <div>
      <label className={L}>Points</label>
      <div className="space-y-1.5">
        {rows.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={I + ' w-16 text-center'} value={p.x ?? ''} onChange={e => upd(i, { x: e.target.value })} placeholder="x" />
            <input className={I + ' w-16 text-center'} value={p.y ?? ''} onChange={e => upd(i, { y: e.target.value })} placeholder="y" />
            <input className={I + ' flex-1'} value={p.label ?? ''} onChange={e => upd(i, { label: e.target.value })} placeholder="Label (optional), e.g. A(-3, 2)" />
            <button onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600 text-xs shrink-0" title="Remove point">✕</button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...rows, { x: '', y: '', label: '' }])} className="text-[11px] font-semibold text-[#325099] hover:underline mt-1">＋ Add point</button>
    </div>
  )
}

function LineRows({ rows, onChange }) {
  const upd = (i, patch) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  return (
    <div>
      <label className={L}>Lines — each draws y = mx + c</label>
      <div className="space-y-1.5">
        {rows.map((l, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={I + ' w-20 text-center'} value={l.m ?? ''} onChange={e => upd(i, { m: e.target.value })} placeholder="m" title="Gradient" />
            <input className={I + ' w-20 text-center'} value={l.c ?? ''} onChange={e => upd(i, { c: e.target.value })} placeholder="c" title="y-intercept" />
            <input className={I + ' flex-1'} value={l.label ?? ''} onChange={e => upd(i, { label: e.target.value })} placeholder="Label (optional), e.g. y = 2x + 1" />
            <button onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600 text-xs shrink-0" title="Remove line">✕</button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...rows, { m: '', c: '', label: '' }])} className="text-[11px] font-semibold text-[#325099] hover:underline mt-1">＋ Add line</button>
    </div>
  )
}

// Layout controls for a block's image: position (below / float with text
// wrapping) and width as a % of the container. Only shown once an image is set.
function ImageLayoutFields({ block, set }) {
  if (!block.image) return null
  return (
    <div className="flex gap-2 items-end">
      <div>
        <label className={L}>Image position</label>
        <select className={I} value={block.imagePos || 'below'} onChange={e => set({ imagePos: e.target.value === 'below' ? '' : e.target.value })}>
          <option value="below">Below text</option>
          <option value="left">Left — text wraps</option>
          <option value="right">Right — text wraps</option>
        </select>
      </div>
      <div className="w-28">
        <label className={L}>Width (%)</label>
        <input className={I} type="text" inputMode="numeric" value={block.imageWidth ?? ''} onChange={e => set({ imageWidth: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 40" />
      </div>
    </div>
  )
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

export default function BlockEditor({ block, onChange, isChem = false, syllabus = [] }) {
  const set = (patch) => onChange({ ...block, ...patch })

  switch (block.type) {
    case 'section':
      return (
        <div className="space-y-2.5">
          <div className="grid grid-cols-[80px_1fr] gap-2">
            <div><label className={L}>No.</label><input className={I} value={block.number} onChange={e => set({ number: e.target.value })} placeholder="1" /></div>
            <div><label className={L}>Section title</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} /></div>
          </div>
          {isChem && <SectionSyllabusPicker modules={syllabus} block={block} onChange={set} />}
        </div>
      )
    case 'subtopic':
      return <div><label className={L}>Subtopic heading</label><input className={I} value={block.title} onChange={e => set({ title: e.target.value })} /></div>
    case 'formula':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} (use $…$ for maths, “- ” for bullets, ⌘/Ctrl-B for bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Area of a Parallelogram:\n$A = bh$\n- $b$ is the base\n- $h$ is the perpendicular height'} /></div>
          <TwoColField block={block} set={set} />
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <ImageLayoutFields block={block} set={set} />
        </div>
      )
    case 'note':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} (“- ” for bullets, ⌘/Ctrl-B for bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Common mistakes:\n- Using diameter instead of radius\n- Forgetting to square the radius'} /></div>
          <TwoColField block={block} set={set} />
        </div>
      )
    case 'definition':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} ($…$ maths, “- ” bullets, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'A polygon is a closed 2D shape with straight sides.'} /></div>
          <TwoColField block={block} set={set} />
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <ImageLayoutFields block={block} set={set} />
        </div>
      )
    case 'worked':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} ($…$ maths, “- ” bullets, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Step-by-step working for the example…'} /></div>
          <TwoColField block={block} set={set} />
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <ImageLayoutFields block={block} set={set} />
        </div>
      )
    case 'steps':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Steps — one per line (auto-numbered)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Read the question carefully\nIdentify what is being asked\nChoose the correct formula\nSubstitute and solve'} /></div>
        </div>
      )
    case 'image':
      return (
        <div className="space-y-2.5">
          <ImageField value={block.image} onChange={v => set({ image: v })} label="Image" />
          <div><label className={L}>Caption (optional)</label><input className={I} value={block.caption || ''} onChange={e => set({ caption: e.target.value })} placeholder="e.g. Figure 1 — the Cartesian plane" /></div>
          <div className="flex gap-2 items-end">
            <div>
              <label className={L}>Alignment</label>
              <select className={I} value={block.align || 'center'} onChange={e => set({ align: e.target.value })}>
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="w-32"><label className={L}>Width (% of page)</label><input className={I} type="text" inputMode="numeric" value={block.width ?? ''} onChange={e => set({ width: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 60" /></div>
          </div>
        </div>
      )
    case 'mathobj':
      return (
        <div className="space-y-2.5">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className={L}>Object type</label>
              <select className={I} value={block.objType || 'cartesian'} onChange={e => set({ objType: e.target.value })}>
                <option value="cartesian">Cartesian plane</option>
                <option value="numberline">Number line</option>
                <option value="boxplot">Box plot</option>
              </select>
            </div>
            <div className="w-28"><label className={L}>Width (%)</label><input className={I} type="text" inputMode="numeric" value={block.width ?? ''} onChange={e => set({ width: e.target.value.replace(/\D/g, '') })} placeholder="60" /></div>
          </div>
          {(block.objType || 'cartesian') === 'cartesian' && (
            <>
              <div className="grid grid-cols-4 gap-2">
                <div><label className={L}>x min</label><input className={I} value={block.xMin ?? ''} onChange={e => set({ xMin: e.target.value })} placeholder="-5" /></div>
                <div><label className={L}>x max</label><input className={I} value={block.xMax ?? ''} onChange={e => set({ xMax: e.target.value })} placeholder="5" /></div>
                <div><label className={L}>y min</label><input className={I} value={block.yMin ?? ''} onChange={e => set({ yMin: e.target.value })} placeholder="-5" /></div>
                <div><label className={L}>y max</label><input className={I} value={block.yMax ?? ''} onChange={e => set({ yMax: e.target.value })} placeholder="5" /></div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-[11px] font-semibold text-[#2A2035]/70 select-none">
                  <input type="checkbox" checked={block.grid !== false} onChange={e => set({ grid: e.target.checked })} className="accent-[#325099]" />
                  Show gridlines
                </label>
                <label className="flex items-center gap-2 text-[11px] font-semibold text-[#2A2035]/70 select-none">
                  <input type="checkbox" checked={block.intercepts !== false} onChange={e => set({ intercepts: e.target.checked })} className="accent-[#325099]" />
                  Show intercept labels
                </label>
              </div>
              <PointRows rows={toPointRows(block.points)} onChange={points => set({ points })} />
              <LineRows rows={toLineRows(block.lines)} onChange={lines => set({ lines })} />
            </>
          )}
          {block.objType === 'numberline' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div><label className={L}>Min</label><input className={I} value={block.nlMin ?? ''} onChange={e => set({ nlMin: e.target.value })} placeholder="0" /></div>
                <div><label className={L}>Max</label><input className={I} value={block.nlMax ?? ''} onChange={e => set({ nlMax: e.target.value })} placeholder="10" /></div>
                <div><label className={L}>Step</label><input className={I} value={block.nlStep ?? ''} onChange={e => set({ nlStep: e.target.value })} placeholder="1" /></div>
              </div>
              <div><label className={L}>Marked values — one per line: value, label (optional)</label><textarea className={TA} value={block.nlPoints ?? ''} onChange={e => set({ nlPoints: e.target.value })} placeholder={'3.5\n7, B'} /></div>
            </>
          )}
          {block.objType === 'boxplot' && (
            <div className="grid grid-cols-5 gap-2">
              <div><label className={L}>Min</label><input className={I} value={block.bpMin ?? ''} onChange={e => set({ bpMin: e.target.value })} /></div>
              <div><label className={L}>Q1</label><input className={I} value={block.bpQ1 ?? ''} onChange={e => set({ bpQ1: e.target.value })} /></div>
              <div><label className={L}>Median</label><input className={I} value={block.bpMed ?? ''} onChange={e => set({ bpMed: e.target.value })} /></div>
              <div><label className={L}>Q3</label><input className={I} value={block.bpQ3 ?? ''} onChange={e => set({ bpQ3: e.target.value })} /></div>
              <div><label className={L}>Max</label><input className={I} value={block.bpMax ?? ''} onChange={e => set({ bpMax: e.target.value })} /></div>
            </div>
          )}
        </div>
      )
    case 'text':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Explanation (paragraphs, “- ” bullets, $…$ maths, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} /></div>
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <ImageLayoutFields block={block} set={set} />
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
          <ImageLayoutFields block={block} set={set} />
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

'use client'

import Link from 'next/link'
import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
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
    return <p className="text-[11px] text-[#2A2035]/45">No master syllabus for this year yet — add it on the <Link href="/tutor/resources/syllabus?subject=Chemistry" className="underline">Syllabus</Link> page.</p>
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
 * StimulusLibraryPicker — fill a Stimulus block from the Texts/Stimuli library
 * (/tutor/resources/texts). Lazy-loads on first open; picking a text copies its
 * title, source and body into the block (the library row stays untouched).
 */
function StimulusLibraryPicker({ onPick }) {
  const [open, setOpen] = useState(false)
  const [texts, setTexts] = useState(null)   // null = not fetched yet
  const [query, setQuery] = useState('')

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && texts === null) {
      const { data } = await supabase
        .from('stimulus_texts')
        .select('id, title, source, text_type, year, body')
        .order('updated_at', { ascending: false })
      setTexts(data || [])
    }
  }

  const q = query.trim().toLowerCase()
  const shown = (texts || []).filter(t =>
    !q || `${t.title} ${t.source || ''} ${t.body}`.toLowerCase().includes(q))

  return (
    <div className="rounded-lg border border-[#DEE7FF] bg-[#FBFCFF]">
      <button type="button" onClick={toggle} className="w-full flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-semibold text-[#325099]">❝ From the Texts/Stimuli library</span>
        <span className="text-[10px] text-[#325099]/60">{open ? '▲ hide' : '▼ browse'}</span>
      </button>
      {open && (
        <div className="border-t border-[#F0F4FF] px-3 pb-2">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search title, author or text…"
            className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs mt-2 focus:outline-none focus:border-[#325099]" />
          <div className="max-h-56 overflow-y-auto mt-1.5 space-y-1">
            {texts === null ? (
              <p className="text-[11px] text-[#2A2035]/40 py-3 text-center animate-pulse">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="text-[11px] text-[#2A2035]/40 py-3 text-center italic">
                {texts.length === 0 ? <>No texts in the library yet — add some on the <Link href="/tutor/resources/texts" className="underline">Texts/Stimuli</Link> page.</> : 'No texts match.'}
              </p>
            ) : shown.map(t => (
              <button key={t.id} type="button"
                onClick={() => { onPick(t); setOpen(false) }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#F0F4FF] transition">
                <span className="text-xs font-semibold text-[#062E63]">{t.title}</span>
                {t.source && <span className="text-[10px] italic text-[#2A2035]/45"> — {t.source}</span>}
                <span className="text-[10px] text-[#2A2035]/35"> · {t.text_type}{t.year ? ` · Yr ${t.year}` : ''}</span>
                <span className="block text-[10px] text-[#2A2035]/45 truncate">{(t.body || '').split('\n')[0]}</span>
              </button>
            ))}
          </div>
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
// Curve rows are { eq, label }; convert legacy { m, c } rows and "m, c, label"
// text into equation form.
const mcToEq = (m, c) => `${m}x ${Number(c) < 0 ? '-' : '+'} ${Math.abs(Number(c))}`
const toLineRows = (v) => {
  if (Array.isArray(v)) return v.map(l => (l && l.eq !== undefined) ? l : { eq: mcToEq(l?.m ?? 0, l?.c ?? 0), label: l?.label ?? '' })
  return String(v ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const p = l.split(',').map(x => x.trim())
    return { eq: mcToEq(p[0] ?? 0, p[1] ?? 0), label: p.slice(2).join(', ') }
  })
}

// Row inputs manage their own widths, so strip the w-full baked into I.
const I0 = I.replace('w-full ', '')

function PointRows({ rows, onChange }) {
  const upd = (i, patch) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  return (
    <div>
      <label className={L}>Points</label>
      <div className="space-y-1.5">
        {rows.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={I0 + ' w-16 shrink-0 text-center'} value={p.x ?? ''} onChange={e => upd(i, { x: e.target.value })} placeholder="x" />
            <input className={I0 + ' w-16 shrink-0 text-center'} value={p.y ?? ''} onChange={e => upd(i, { y: e.target.value })} placeholder="y" />
            <input className={I0 + ' flex-1 min-w-0'} value={p.label ?? ''} onChange={e => upd(i, { label: e.target.value })} placeholder="Label (optional), e.g. A(-3, 2)" />
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
      <label className={L}>Curves — any equation (e.g. y = 2x + 1, y = x^2 - 2, x^2 + y^2 = 9)</label>
      <div className="space-y-1.5">
        {rows.map((l, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={I0 + ' flex-1 min-w-0'} value={l.eq ?? ''} onChange={e => upd(i, { eq: e.target.value })} placeholder="y = x^2 - 2  or  x^2 + y^2 = 9" />
            <input className={I0 + ' w-32 shrink-0'} value={l.label ?? ''} onChange={e => upd(i, { label: e.target.value })} placeholder="Label (optional)" />
            <button onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600 text-xs shrink-0" title="Remove curve">✕</button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...rows, { eq: '', label: '' }])} className="text-[11px] font-semibold text-[#325099] hover:underline mt-1">＋ Add curve</button>
    </div>
  )
}

// ── Maths-object fields (shared by the standalone block and box embeds) ─────
function MathObjFields({ obj, upd }) {
  return (
    <>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className={L}>Object type</label>
          <select className={I} value={obj.objType || 'cartesian'} onChange={e => upd({ objType: e.target.value })}>
            <option value="cartesian">Cartesian plane</option>
            <option value="numberline">Number line</option>
            <option value="boxplot">Box plot</option>
            <option value="xytable">Table of values</option>
          </select>
        </div>
        <div>
          <label className={L}>Position</label>
          <select className={I} value={obj.pos || 'below'} onChange={e => upd({ pos: e.target.value === 'below' ? '' : e.target.value })}>
            <option value="below">Own line (centred)</option>
            <option value="left">Left — text wraps</option>
            <option value="right">Right — text wraps</option>
          </select>
        </div>
        <div className="w-28"><label className={L}>Width (%)</label><input className={I} type="text" inputMode="numeric" value={obj.width ?? ''} onChange={e => upd({ width: e.target.value.replace(/\D/g, '') })} placeholder="60" /></div>
      </div>
      {(obj.objType || 'cartesian') === 'cartesian' && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <div><label className={L}>x min</label><input className={I} value={obj.xMin ?? ''} onChange={e => upd({ xMin: e.target.value })} placeholder="-5" /></div>
            <div><label className={L}>x max</label><input className={I} value={obj.xMax ?? ''} onChange={e => upd({ xMax: e.target.value })} placeholder="5" /></div>
            <div><label className={L}>y min</label><input className={I} value={obj.yMin ?? ''} onChange={e => upd({ yMin: e.target.value })} placeholder="-5" /></div>
            <div><label className={L}>y max</label><input className={I} value={obj.yMax ?? ''} onChange={e => upd({ yMax: e.target.value })} placeholder="5" /></div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div><label className={L}>x per square</label><input className={I} value={obj.xStep ?? ''} onChange={e => upd({ xStep: e.target.value })} placeholder="1" /></div>
            <div><label className={L}>y per square</label><input className={I} value={obj.yStep ?? ''} onChange={e => upd({ yStep: e.target.value })} placeholder="1" /></div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-[11px] font-semibold text-[#2A2035]/70 select-none">
              <input type="checkbox" checked={obj.grid !== false} onChange={e => upd({ grid: e.target.checked })} className="accent-[#325099]" />
              Show gridlines
            </label>
            <label className="flex items-center gap-2 text-[11px] font-semibold text-[#2A2035]/70 select-none">
              <input type="checkbox" checked={obj.intercepts !== false} onChange={e => upd({ intercepts: e.target.checked })} className="accent-[#325099]" />
              Show intercept labels
            </label>
          </div>
          <PointRows rows={toPointRows(obj.points)} onChange={points => upd({ points })} />
          <LineRows rows={toLineRows(obj.lines)} onChange={lines => upd({ lines })} />
        </>
      )}
      {obj.objType === 'numberline' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={L}>Min</label><input className={I} value={obj.nlMin ?? ''} onChange={e => upd({ nlMin: e.target.value })} placeholder="0" /></div>
            <div><label className={L}>Max</label><input className={I} value={obj.nlMax ?? ''} onChange={e => upd({ nlMax: e.target.value })} placeholder="10" /></div>
            <div><label className={L}>Step</label><input className={I} value={obj.nlStep ?? ''} onChange={e => upd({ nlStep: e.target.value })} placeholder="1" /></div>
          </div>
          <div><label className={L}>Marked values — one per line: value, label (optional)</label><textarea className={TA} value={obj.nlPoints ?? ''} onChange={e => upd({ nlPoints: e.target.value })} placeholder={'3.5\n7, B'} /></div>
        </>
      )}
      {obj.objType === 'boxplot' && (
        <div className="grid grid-cols-5 gap-2">
          <div><label className={L}>Min</label><input className={I} value={obj.bpMin ?? ''} onChange={e => upd({ bpMin: e.target.value })} /></div>
          <div><label className={L}>Q1</label><input className={I} value={obj.bpQ1 ?? ''} onChange={e => upd({ bpQ1: e.target.value })} /></div>
          <div><label className={L}>Median</label><input className={I} value={obj.bpMed ?? ''} onChange={e => upd({ bpMed: e.target.value })} /></div>
          <div><label className={L}>Q3</label><input className={I} value={obj.bpQ3 ?? ''} onChange={e => upd({ bpQ3: e.target.value })} /></div>
          <div><label className={L}>Max</label><input className={I} value={obj.bpMax ?? ''} onChange={e => upd({ bpMax: e.target.value })} /></div>
        </div>
      )}
      {obj.objType === 'xytable' && (
        <>
          <div className="flex gap-2 items-end">
            <div className="w-16"><label className={L}>Row 1</label><input className={I} value={obj.tbXLabel ?? ''} onChange={e => upd({ tbXLabel: e.target.value })} placeholder="x" /></div>
            <div className="flex-1"><label className={L}>Values (comma separated)</label><input className={I} value={obj.tbX ?? ''} onChange={e => upd({ tbX: e.target.value })} placeholder="0, 1, 2, 3" /></div>
          </div>
          <div className="flex gap-2 items-end">
            <div className="w-16"><label className={L}>Row 2</label><input className={I} value={obj.tbYLabel ?? ''} onChange={e => upd({ tbYLabel: e.target.value })} placeholder="y" /></div>
            <div className="flex-1"><label className={L}>Values (leave blanks with just commas)</label><input className={I} value={obj.tbY ?? ''} onChange={e => upd({ tbY: e.target.value })} placeholder="5, 8, 11, 14" /></div>
          </div>
        </>
      )}
    </>
  )
}

// Embed extras inside a callout box (Definition, Formula, Note, …): a maths
// object and/or a plain blank space beneath the text.
const EMPTY_MATHOBJ = { objType: 'cartesian', width: '55', pos: '', xMin: '-5', xMax: '5', yMin: '-5', yMax: '5', grid: true, intercepts: true, points: [], lines: [], nlMin: '0', nlMax: '10', nlStep: '1', nlPoints: '', bpMin: '', bpQ1: '', bpMed: '', bpQ3: '', bpMax: '', tbX: '0, 1, 2, 3', tbY: '', tbXLabel: 'x', tbYLabel: 'y' }
function MathObjSection({ block, set, blank = true }) {
  return (
    <>
      <div className="flex items-center gap-4">
        {!block.mathObj && (
          <button onClick={() => set({ mathObj: { ...EMPTY_MATHOBJ } })} className="text-[11px] font-semibold text-[#325099] hover:underline">＋ Add maths object</button>
        )}
        {blank && block.blankSpace == null && (
          <button onClick={() => set({ blankSpace: '4' })} className="text-[11px] font-semibold text-[#325099] hover:underline" title="Empty room inside the box (e.g. for working)">＋ Add blank space</button>
        )}
      </div>
      {block.mathObj && (
        <div className="border border-[#DEE7FF] rounded-lg p-2.5 bg-[#F8FAFF] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#325099]">Maths object</span>
            <button onClick={() => set({ mathObj: null })} className="text-[11px] text-rose-500 hover:underline">Remove</button>
          </div>
          <MathObjFields obj={block.mathObj} upd={patch => set({ mathObj: { ...block.mathObj, ...patch } })} />
        </div>
      )}
      {blank && block.blankSpace != null && (
        <div className="border border-[#DEE7FF] rounded-lg p-2.5 bg-[#F8FAFF] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#325099]">Blank space</span>
            <button onClick={() => set({ blankSpace: null })} className="text-[11px] text-rose-500 hover:underline">Remove</button>
          </div>
          <div className="w-32"><label className={L}>Height (cm)</label><input className={I} type="text" inputMode="decimal" value={block.blankSpace ?? ''} onChange={e => set({ blankSpace: e.target.value.replace(/[^\d.]/g, '') })} placeholder="4" /></div>
        </div>
      )}
    </>
  )
}

// Answer space for a question or part: writing lines (default), plain blank
// space of a chosen height, or a blank maths object (e.g. an empty Cartesian
// plane for plotting questions).
function AnswerSpace({ holder, patch, dflt = 3 }) {
  // The mode is explicit (answerType) so clearing the height box doesn't flip
  // the control back to lines; legacy rows without it fall back to inference.
  const mode = holder.answerType
    || (holder.answerObj ? 'object' : (holder.answerBlank ?? '') !== '' ? 'blank' : 'lines')
  const setMode = (m) => {
    if (m === mode) return
    // Only the type switches — each mode's settings are kept for switching back.
    if (m === 'blank') patch({ answerType: 'blank', answerBlank: (holder.answerBlank ?? '') === '' ? '4' : holder.answerBlank })
    else if (m === 'object') patch({ answerType: 'object', answerObj: holder.answerObj || { ...EMPTY_MATHOBJ } })
    else patch({ answerType: 'lines' })
  }
  return (
    <div className="space-y-2">
      <div>
        <label className={L}>Answer space</label>
        <div className="inline-flex items-stretch rounded-lg border border-[#DEE7FF] overflow-hidden text-[11px]">
          {[['lines', 'Writing lines'], ['blank', 'Blank space'], ['object', 'Maths object']].map(([m, lbl], i) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 font-semibold transition ${i > 0 ? 'border-l border-[#DEE7FF]' : ''} ${mode === m ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      {mode === 'lines' && (
        <div className="w-28"><label className={L}>Answer lines</label><input className={I} type="text" inputMode="numeric" value={holder.lines ?? ''} onChange={e => patch({ lines: e.target.value.replace(/\D/g, '') })} placeholder={String(dflt)} /></div>
      )}
      {mode === 'blank' && (
        <div className="w-32"><label className={L}>Height (cm)</label><input className={I} type="text" inputMode="decimal" value={holder.answerBlank ?? ''} onChange={e => patch({ answerBlank: e.target.value.replace(/[^\d.]/g, '') })} placeholder="4" /></div>
      )}
      {mode === 'object' && (
        <div className="border border-[#DEE7FF] rounded-lg p-2.5 bg-[#F8FAFF] space-y-2.5">
          <MathObjFields obj={holder.answerObj} upd={o => patch({ answerObj: { ...holder.answerObj, ...o } })} />
        </div>
      )}
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
          <MathObjSection block={block} set={set} />
        </div>
      )
    case 'note':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} (“- ” for bullets, ⌘/Ctrl-B for bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Common mistakes:\n- Using diameter instead of radius\n- Forgetting to square the radius'} /></div>
          <TwoColField block={block} set={set} />
          <MathObjSection block={block} set={set} />
        </div>
      )
    case 'definition':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} ($…$ maths, “- ” bullets, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'A polygon is a closed 2D shape with straight sides.'} /></div>
          <TwoColField block={block} set={set} />
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <ImageLayoutFields block={block} set={set} />
          <MathObjSection block={block} set={set} />
        </div>
      )
    case 'worked':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>{block.twoCol ? 'Left column' : 'Body'} ($…$ maths, “- ” bullets, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Step-by-step working for the example…'} /></div>
          <TwoColField block={block} set={set} />
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <ImageLayoutFields block={block} set={set} />
          <MathObjSection block={block} set={set} />
        </div>
      )
    case 'steps':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Steps — one per line (auto-numbered)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Read the question carefully\nIdentify what is being asked\nChoose the correct formula\nSubstitute and solve'} /></div>
          <MathObjSection block={block} set={set} />
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
      return <div className="space-y-2.5"><MathObjFields obj={block} upd={set} /></div>
    case 'text':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Explanation (paragraphs, “- ” bullets, $…$ maths, ⌘/Ctrl-B bold)</label><textarea className={TA} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} /></div>
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <ImageLayoutFields block={block} set={set} />
        </div>
      )
    case 'stimulus':
      return (
        <div className="space-y-2.5">
          <StimulusLibraryPicker onPick={(t) => set({ title: t.title || '', source: t.source || '', body: t.body || '' })} />
          <div className="grid grid-cols-2 gap-2">
            <div><label className={L}>Title (optional)</label><input className={I} value={block.title || ''} onChange={e => set({ title: e.target.value })} placeholder="e.g. Mother to Son" /></div>
            <div><label className={L}>Source / author (optional)</label><input className={I} value={block.source || ''} onChange={e => set({ source: e.target.value })} placeholder="e.g. Langston Hughes, 1922" /></div>
          </div>
          <div>
            <label className={L}>Text — paste the poem/extract as-is. Line breaks are kept exactly; a blank line makes a stanza/paragraph gap (⌘/Ctrl-B bold works)</label>
            <textarea className={TA} rows={10} value={block.body} onChange={e => set({ body: e.target.value })} onKeyDown={e => onTextKey(e, block.body, v => set({ body: v }))} placeholder={'Well, son, I’ll tell you:\nLife for me ain’t been no crystal stair.\n…'} />
          </div>
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
          <ImageLayoutFields block={block} set={set} />
          <MathObjSection block={block} set={set} blank={false} />
          <PartsEditor parts={block.parts || []} onChange={parts => set({ parts })} />
          {/* The question-level solution only applies to single questions; with
              parts, each part carries its own solution. */}
          {!(block.parts && block.parts.length) && (
            <>
              <div><label className={L}>Sample solution / answer (shown in Solutions copy)</label><textarea className={TA} value={block.solution} onChange={e => set({ solution: e.target.value })} onKeyDown={e => onTextKey(e, block.solution, v => set({ solution: v }))} placeholder={'a. 320 cm²\nb. 90 mm²'} /></div>
              <ImageField label="Solution diagram / image (Solutions copy)" value={block.solutionImage || ''} onChange={v => set({ solutionImage: v })} />
              <AnswerSpace holder={block} patch={set} dflt={6} />
            </>
          )}
        </div>
      )
    case 'mcq':
      return (
        <div className="space-y-2.5">
          <div><label className={L}>Question</label><textarea className={TA} value={block.prompt} onChange={e => set({ prompt: e.target.value })} onKeyDown={e => onTextKey(e, block.prompt, v => set({ prompt: v }))} /></div>
          <ImageField value={block.image} onChange={v => set({ image: v })} />
          <MathObjSection block={block} set={set} blank={false} />
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
  // Per-column widths (% of the table, '' = auto), kept index-aligned with the
  // columns through every insert/remove below.
  const colWidths = rows[0]?.map((_, i) => (Array.isArray(block.colWidths) ? block.colWidths[i] : '') ?? '') || []
  // Effective % per column, mirroring what the renderer's fixed layout does:
  // set columns keep their %, auto columns share the remainder equally. The
  // editor grid is sized with these so it previews the real proportions.
  const setVals = colWidths.map(v => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 100 ? n : null })
  const sumSet = setVals.reduce((s, v) => s + (v || 0), 0)
  const nAuto = setVals.filter(v => v == null).length
  const autoShare = nAuto ? Math.max(8, (100 - sumSet) / nAuto) : 0
  const effPct = setVals.map(v => v ?? autoShare)
  const effTotal = effPct.reduce((s, v) => s + v, 0)
  const effScale = effTotal > 100 ? 100 / effTotal : 1
  // Drag-to-resize a column from the divider above the grid (Excel-style).
  const tableRef = useRef(null)
  const resizeRef = useRef(null)
  const startResize = (ci) => (e) => {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = { ci, startX: e.clientX, startPct: effPct[ci], tw: tableRef.current?.offsetWidth || 600 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveResize = (e) => {
    const d = resizeRef.current
    if (!d) return
    const dPct = ((e.clientX - d.startX) / d.tw) * 100
    const v = String(Math.round(Math.min(90, Math.max(5, d.startPct + dPct))))
    if (v !== colWidths[d.ci]) set({ colWidths: colWidths.map((w, i) => i === d.ci ? v : w) })
  }
  const endResize = () => { resizeRef.current = null }
  const resetColWidth = (ci) => set({ colWidths: colWidths.map((w, i) => i === ci ? '' : w) })
  const setCell = (r, c, v) => set({ rows: rows.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? v : cell) : row) })
  const addRow = () => set({ rows: [...rows, Array(nCols || 1).fill('')] })
  const removeRow = () => { if (rows.length > 1) set({ rows: rows.slice(0, -1) }) }
  const removeRowAt = (ri) => { if (rows.length > 1) set({ rows: rows.filter((_, i) => i !== ri) }) }
  const insertRowAt = (ri) => set({ rows: [...rows.slice(0, ri), Array(nCols || 1).fill(''), ...rows.slice(ri)] })
  const addCol = () => set({ rows: rows.map(row => [...row, '']), colWidths: [...colWidths, ''] })
  const removeCol = () => { if (nCols > 1) set({ rows: rows.map(row => row.slice(0, -1)), colWidths: colWidths.slice(0, -1) }) }
  const removeColAt = (ci) => { if (nCols > 1) set({ rows: rows.map(row => row.filter((_, i) => i !== ci)), colWidths: colWidths.filter((_, i) => i !== ci) }) }
  const insertColAt = (ci) => set({ rows: rows.map(row => [...row.slice(0, ci), '', ...row.slice(ci)]), colWidths: [...colWidths.slice(0, ci), '', ...colWidths.slice(ci)] })
  const STEP = 'w-6 h-6 flex items-center justify-center rounded border border-[#DEE7FF] text-[#325099] hover:bg-[#F0F4FF] text-sm leading-none'
  // Width: empty = full page width (the default every existing table already has).
  // The slider stores '' at 100 so untouched tables keep rendering exactly as before.
  const widthPct = (() => { const w = Number(block.width); return Number.isFinite(w) && w >= 25 && w < 100 ? w : 100 })()
  const ALIGNS = [['left', '⇤', 'Align left'], ['', '↔', 'Centre'], ['right', '⇥', 'Align right']]
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
        <div className="flex items-center gap-1.5 text-[11px] text-[#2A2035]/50">
          <span>Width</span>
          <input
            type="range" min={25} max={100} step={5} value={widthPct}
            onChange={e => { const v = Number(e.target.value); set(v >= 100 ? { width: '' } : { width: String(v) }) }}
            title="Table width as a percentage of the page"
            className="w-24 accent-[#325099] cursor-pointer"
          />
          <span className="w-8 text-center font-semibold text-[#2A2035]">{widthPct === 100 ? 'Full' : `${widthPct}%`}</span>
        </div>
        {widthPct < 100 && (
          <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden">
            {ALIGNS.map(([v, icon, tip]) => (
              <button key={v || 'center'} type="button" onClick={() => set({ align: v })} title={tip}
                className={`w-7 h-6 flex items-center justify-center text-xs leading-none transition ${
                  (block.align || '') === v ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'
                }`}>{icon}</button>
            ))}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table ref={tableRef} className="border-collapse w-full" style={{ tableLayout: 'fixed', minWidth: nCols * 72 + 60 }}>
          <colgroup>
            {effPct.map((p, i) => <col key={i} style={{ width: `${p * effScale * 0.9}%` }} />)}
            <col style={{ width: 60 }} />
          </colgroup>
          <tbody>
            {/* Column controls — per column: live width label ("auto" = shares
                leftover space), insert/delete buttons, and a draggable divider
                on the right edge to resize the column (double-click resets). */}
            <tr>
              {rows[0]?.map((_, ci) => (
                <td key={ci} className="p-0.5 relative">
                  <div className="flex items-center justify-center gap-1">
                    <span className={`text-[10px] tabular-nums ${setVals[ci] != null ? 'font-semibold text-[#325099]' : 'text-[#2A2035]/35'}`}
                      title={setVals[ci] != null ? `This column is set to ${setVals[ci]}% of the table` : 'Automatic — shares the space left over'}>
                      {setVals[ci] != null ? `${setVals[ci]}%` : 'auto'}
                    </span>
                    <div className="flex items-center opacity-30 hover:opacity-100 transition">
                      <button type="button" onClick={() => insertColAt(ci + 1)} title="Insert a column to the right of this one"
                        className="w-5 h-5 flex items-center justify-center rounded text-[#325099] hover:bg-[#F0F4FF] text-xs leading-none">＋</button>
                      {nCols > 1 && (
                        <button type="button" onClick={() => removeColAt(ci)} title="Delete this column"
                          className="w-5 h-5 flex items-center justify-center rounded text-rose-400 hover:text-rose-600 hover:bg-rose-50 text-xs leading-none">✕</button>
                      )}
                    </div>
                  </div>
                  <div
                    onPointerDown={startResize(ci)} onPointerMove={moveResize}
                    onPointerUp={endResize} onPointerCancel={endResize}
                    onDoubleClick={() => resetColWidth(ci)}
                    title="Drag to resize this column · double-click to reset to auto"
                    className="absolute top-0 -bottom-1 -right-[5px] w-2.5 cursor-col-resize touch-none flex justify-center group/rz"
                  >
                    <div className="w-[3px] h-full rounded pointer-events-none bg-[#C7D5F8] group-hover/rz:bg-[#325099] transition" />
                  </div>
                </td>
              ))}
              <td />
            </tr>
            {rows.map((row, ri) => (
              <tr key={ri} className="group">
                {row.map((cell, ci) => (
                  <td key={ci} className="p-0.5">
                    <textarea
                      value={cell}
                      onChange={e => setCell(ri, ci, e.target.value)}
                      onKeyDown={e => onInlineKey(e, cell, v => setCell(ri, ci, v))}
                      rows={1}
                      placeholder={block.headerRow && ri === 0 ? 'Header' : ''}
                      className={`w-full min-w-0 align-middle border border-[#DEE7FF] rounded px-2 py-1 text-xs text-center resize-y focus:outline-none focus:border-[#325099] ${block.headerRow && ri === 0 ? 'bg-[#EEF1F5] font-semibold' : 'bg-white'}`}
                    />
                  </td>
                ))}
                {/* Per-row controls — insert a row below this one, or delete it
                    (the last remaining row can't be removed). */}
                <td className="p-0.5 align-middle">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button type="button" onClick={() => insertRowAt(ri + 1)} title="Insert a row below this one"
                      className="w-6 h-6 flex items-center justify-center rounded text-[#325099] hover:bg-[#F0F4FF] text-sm leading-none">＋</button>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => removeRowAt(ri)} title="Delete this row"
                        className="w-6 h-6 flex items-center justify-center rounded text-rose-300 hover:text-rose-600 hover:bg-rose-50 text-sm leading-none">✕</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-[#2A2035]/40">Use $…$ for maths and **bold** in cells. Drag the blue dividers to resize columns — double-click one to set its column back to auto.</p>
      {sumSet > 100 && (
        <p className="text-[10px] font-semibold text-amber-600">⚠ Column widths add up to {Math.round(sumSet)}% — they&apos;ll be squeezed to fit. Keep the total at 100% or less.</p>
      )}
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
            <div className="mt-1.5"><MathObjSection block={p} set={patch => onChange(parts.map((x, j) => j === i ? { ...x, ...patch } : x))} blank={false} /></div>
            <textarea className={TA + ' mt-1.5'} value={p.solution || ''} onChange={e => onChange(parts.map((x, j) => j === i ? { ...x, solution: e.target.value } : x))} onKeyDown={e => onTextKey(e, p.solution || '', v => onChange(parts.map((x, j) => j === i ? { ...x, solution: v } : x)))} placeholder={`Part ${String.fromCharCode(97 + i)} solution (shown in Solutions copy)`} />
            <div className="mt-1.5"><AnswerSpace holder={p} patch={obj => onChange(parts.map((x, j) => j === i ? { ...x, ...obj } : x))} /></div>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...parts, { prompt: '', image: '', solution: '', lines: '' }])} className="text-[11px] font-semibold text-[#325099] hover:underline mt-1">＋ Add part</button>
    </div>
  )
}

'use client'
/*
 * Info Centre — the page as you read it, but editable in place.
 *
 * The viewer normally renders with InfoBlocks, which is deliberately read-only
 * and light. This is the same page, in the same stylesheet, with the text in
 * fields: a register that changes weekly should not need a trip to the full
 * editor and back to correct one cell.
 *
 * Only the blocks you would change on the fly are editable here — text, lists
 * and tables. Anything structural (adding blocks, reordering, images, embeds)
 * stays in the full editor, which is one click away and is the right place for
 * it. Those blocks still render, read-only, so the page reads as it will look.
 */
import { useEffect, useRef } from 'react'
import InfoBlocks, { IH_CSS } from './InfoBlocks'
import { calloutVariant } from '../../lib/infohub/blocks'
import { autoGrow } from '../../lib/autoGrow'

const EDITABLE = new Set(['heading', 'paragraph', 'quote', 'callout', 'bulleted',
                          'numbered', 'steps', 'checklist', 'table'])

export const isInlineEditable = (b) => EDITABLE.has(b?.type)

// A textarea that grows with its content, so a long cell never hides its text.
// autoGrow's second argument is a MINIMUM height: one comfortable line here,
// then it grows. (Passing a large number pins every field to that height.)
const MIN_FIELD = 30
function Field({ value, onChange, placeholder, className = '', rows = 1, mono = false }) {
  const ref = useRef(null)
  useEffect(() => { autoGrow(ref.current, MIN_FIELD) }, [value])
  return (
    <textarea
      ref={ref}
      rows={rows}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => { onChange(e.target.value); autoGrow(e.target, MIN_FIELD) }}
      className={`ihx-field ${mono ? 'ihx-mono' : ''} ${className}`}
    />
  )
}

function ListFields({ items, onChange, placeholder }) {
  const set = (i, v) => onChange(items.map((x, j) => (j === i ? v : x)))
  return (
    <div className="ihx-list">
      {(items || []).map((it, i) => (
        <div key={i} className="ihx-listrow">
          <span className="ihx-bullet" aria-hidden="true">•</span>
          <Field value={it} onChange={(v) => set(i, v)} placeholder={placeholder} />
          <button type="button" className="ihx-x" title="Remove"
            onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="ihx-add" onClick={() => onChange([...(items || []), ''])}>＋ Add item</button>
    </div>
  )
}

function TableFields({ block, set }) {
  const rows = (block.rows || []).map((r) => [...r])
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0) || 1
  const norm = rows.map((r) => (r.length === width ? r : [...r, ...Array(width - r.length).fill('')]))
  const put = (ri, ci, v) => set({ rows: norm.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)) })
  const addRow = () => set({ rows: [...norm, Array(width).fill('')] })
  const delRow = (ri) => set({ rows: norm.filter((_, i) => i !== ri) })
  const addCol = () => set({ rows: norm.map((r) => [...r, '']) })
  const delCol = (ci) => set({ rows: norm.map((r) => r.filter((_, j) => j !== ci)) })
  const head = block.headerRow ? norm[0] : null
  const body = block.headerRow ? norm.slice(1) : norm

  return (
    <div className="ihx-tblwrap">
      <table className="ih-tbl ihx-tbl">
        {head && (
          <thead>
            <tr>
              {head.map((c, ci) => (
                <th key={ci}>
                  <Field value={c} onChange={(v) => put(0, ci, v)} placeholder="Column" />
                  {width > 1 && (
                    <button type="button" className="ihx-colx" title="Delete this column"
                      onClick={() => delCol(ci)}>×</button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, ri) => {
            const realRow = block.headerRow ? ri + 1 : ri
            return (
              <tr key={realRow}>
                {r.map((c, ci) => (
                  <td key={ci}><Field value={c} onChange={(v) => put(realRow, ci, v)} /></td>
                ))}
                <td className="ihx-rowtools">
                  <button type="button" className="ihx-x" title="Delete this row"
                    onClick={() => delRow(realRow)}>×</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="ihx-tblbtns">
        <button type="button" className="ihx-add" onClick={addRow}>＋ Row</button>
        <button type="button" className="ihx-add" onClick={addCol}>＋ Column</button>
      </div>
    </div>
  )
}

function EditableBlock({ b, set }) {
  switch (b.type) {
    case 'heading':
      return <Field value={b.text} onChange={(v) => set({ text: v })} placeholder="Heading"
        className={b.level === 3 ? 'ihx-h3' : 'ihx-h2'} />
    case 'paragraph':
      return <Field value={b.text} onChange={(v) => set({ text: v })} placeholder="Text…" />
    case 'quote':
      return (
        <div className="ih-quote">
          <Field value={b.text} onChange={(v) => set({ text: v })} placeholder="Quote…" />
          <Field value={b.cite} onChange={(v) => set({ cite: v })} placeholder="— who said it" className="ihx-small" />
        </div>
      )
    case 'callout': {
      // Mirrors InfoBlocks' Callout: coloured bar, then a stacked head + body.
      // Without the inner column the two fields sat side by side, because
      // .ih-callout is a flex row.
      const v = calloutVariant(b.variant)
      return (
        <div className="ih-callout" style={{ background: v.bg, borderColor: v.border }}>
          <div className="ih-callout-bar" style={{ background: v.accent }} />
          <div className="ih-callout-body ihx-grow">
            <div className="ih-callout-head" style={{ color: v.fg }}>
              <span aria-hidden="true" className="ih-callout-icon">{v.icon}</span>
              <Field value={b.title} onChange={(t) => set({ title: t })} placeholder={v.label} className="ihx-strong" />
            </div>
            <Field value={b.body} onChange={(t) => set({ body: t })} placeholder="Body…" />
          </div>
        </div>
      )
    }
    case 'bulleted': case 'numbered': case 'steps':
      return <ListFields items={b.items} onChange={(items) => set({ items })} placeholder="Item…" />
    case 'checklist':
      return (
        <div className="ihx-list">
          {(b.items || []).map((it, i) => (
            <div key={i} className="ihx-listrow">
              <input type="checkbox" checked={!!it.done} className="ihx-check"
                onChange={(e) => set({ items: b.items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
              <Field value={it.text} placeholder="Item…"
                onChange={(v) => set({ items: b.items.map((x, j) => (j === i ? { ...x, text: v } : x)) })} />
              <button type="button" className="ihx-x" title="Remove"
                onClick={() => set({ items: b.items.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button type="button" className="ihx-add"
            onClick={() => set({ items: [...(b.items || []), { text: '', done: false }] })}>＋ Add item</button>
        </div>
      )
    case 'table':
      return <TableFields block={b} set={set} />
    default:
      return null
  }
}

export default function InlineBlocks({ blocks, onChange }) {
  const list = blocks || []
  const setBlock = (id, patch) => onChange(list.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  return (
    <div className="ih-root ihx-root">
      <style>{IH_CSS}</style>
      <style>{IHX_CSS}</style>
      {list.map((b) => (
        <div key={b.id} className="ih-block">
          {isInlineEditable(b)
            ? <EditableBlock b={b} set={(patch) => setBlock(b.id, patch)} />
            : (
              // Structural blocks are shown as they will look, with a note
              // saying where to change them — better than hiding them and
              // leaving a hole in the page you are editing.
              <div className="ihx-locked" title="Open the full editor to change this block">
                <InfoBlocks blocks={[b]} canReveal />
              </div>
            )}
        </div>
      ))}
    </div>
  )
}

const IHX_CSS = `
.ihx-root .ihx-field{ width:100%; border:1px solid transparent; border-radius:8px; padding:4px 7px;
  font:inherit; color:inherit; background:#fff; resize:none; overflow:hidden; display:block; }
.ihx-root .ihx-field:hover{ border-color:#E2E8F7; background:#FCFDFF; }
.ihx-root .ihx-field:focus{ outline:none; border-color:#325099; background:#fff; box-shadow:0 0 0 3px rgba(50,80,153,.10); }
.ihx-root .ihx-field::placeholder{ color:#2A2035; opacity:.32; }
.ihx-root .ihx-h2{ font-size:1.35rem; font-weight:700; color:#062E63; }
.ihx-root .ihx-h3{ font-size:1.08rem; font-weight:700; color:#325099; }
.ihx-root .ihx-strong{ font-weight:700; }
.ihx-root .ihx-small{ font-size:.85em; opacity:.75; }
.ihx-root .ihx-list{ display:flex; flex-direction:column; gap:2px; }
.ihx-root .ihx-listrow{ display:flex; align-items:flex-start; gap:6px; }
.ihx-root .ihx-bullet{ color:#325099; padding-top:6px; }
.ihx-root .ihx-check{ margin-top:10px; accent-color:#325099; }
.ihx-root .ihx-x{ border:0; background:transparent; color:#2A2035; opacity:.25; font-size:15px;
  line-height:1; padding:6px 4px; cursor:pointer; border-radius:6px; }
.ihx-root .ihx-x:hover{ opacity:1; color:#B91C1C; background:#FEF2F2; }
.ihx-root .ihx-add{ align-self:flex-start; margin-top:4px; border:1px dashed #C7D5F8; background:#fff;
  color:#325099; font-size:11px; font-weight:700; border-radius:999px; padding:3px 10px; cursor:pointer; }
.ihx-root .ihx-add:hover{ background:#F0F4FF; border-style:solid; }
.ihx-root .ihx-tblwrap{ overflow-x:auto; }
.ihx-root .ihx-tbl td, .ihx-root .ihx-tbl th{ padding:2px; vertical-align:top; }
.ihx-root .ihx-tbl th{ position:relative; }
.ihx-root .ihx-colx{ position:absolute; top:1px; right:1px; border:0; background:transparent; cursor:pointer;
  color:#2A2035; opacity:.2; font-size:12px; line-height:1; padding:2px 3px; border-radius:5px; }
.ihx-root .ihx-colx:hover{ opacity:1; color:#B91C1C; background:#FEF2F2; }
.ihx-root .ihx-rowtools{ border:0 !important; background:transparent !important; width:26px; }
.ihx-root .ihx-tblbtns{ display:flex; gap:8px; margin-top:6px; }
.ihx-root .ihx-locked{ opacity:.92; }
.ihx-root .ihx-grow{ flex:1 1 auto; min-width:0; }
.ihx-root .ih-callout-head .ihx-field{ background:transparent; }
`

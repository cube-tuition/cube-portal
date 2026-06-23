'use client'
/*
 * Info Centre block editor (Notion-style, MVP). Add / edit / delete / duplicate /
 * collapse / reorder (drag + keyboard) blocks; per-block controls; debounced
 * autosave of the draft; manual Save draft; Publish; live preview at desktop /
 * tablet / mobile widths; word count; unsaved-changes guard. The viewer never
 * loads this file (it's dynamically imported from the editor route only).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import InfoBlocks from './InfoBlocks'
import {
  BLOCK_TYPES, BLOCK_GROUPS, newBlock, duplicateBlock, blockLabel, blockIcon,
  CALLOUT_VARIANTS, BUTTON_VARIANTS, IMAGE_WIDTHS, ALIGNMENTS, pageWordCount,
} from '../../lib/infohub/blocks'
import { saveDraft, publishPage, listRevisions, restoreRevision } from '../../lib/infohub/data'
import { uploadQbankImage, qbankImageUrl } from '../../lib/qbank'

const L = 'block text-[11px] font-semibold text-[#325099]/70 mb-1'
const I = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099]'
const TA = I + ' resize-y min-h-[64px] leading-relaxed'

// Cmd/Ctrl-B → **bold**, Cmd/Ctrl-I → *italic* on the focused textarea/input.
function onFmtKey(e, value, setValue) {
  if (!(e.metaKey || e.ctrlKey)) return
  const k = e.key.toLowerCase()
  const wrap = k === 'b' ? '**' : k === 'i' ? '*' : null
  if (!wrap) return
  e.preventDefault()
  const el = e.target
  const s = el.selectionStart, en = el.selectionEnd
  const sel = value.slice(s, en) || ''
  const next = value.slice(0, s) + wrap + sel + wrap + value.slice(en)
  setValue(next)
  requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = s + wrap.length + sel.length + wrap.length } catch { /* noop */ } })
}

function ImageField({ value, onChange }) {
  const [busy, setBusy] = useState(false)
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try { onChange(await uploadQbankImage(file, 'infohub')) }
    catch (e) { alert('Image upload failed: ' + (e.message || e)) }
    finally { setBusy(false) }
  }
  return value ? (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qbankImageUrl(value)} alt="" className="h-16 rounded-lg border border-[#DEE7FF] object-contain bg-white" />
      <label className="text-[11px] font-semibold text-[#325099] border border-dashed border-[#BACBFF] rounded-lg px-3 py-1.5 cursor-pointer hover:bg-[#F0F4FF]">
        {busy ? 'Uploading…' : 'Replace'}
        <input type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
      </label>
      <button onClick={() => onChange('')} className="text-[11px] text-rose-500 hover:underline">Remove</button>
    </div>
  ) : (
    <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-[#325099] border border-dashed border-[#BACBFF] rounded-lg px-3 py-2 cursor-pointer hover:bg-[#F0F4FF]">
      {busy ? 'Uploading…' : '＋ Upload image'}
      <input type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
    </label>
  )
}

// Editor for a list of plain-text items (bulleted / numbered / steps).
function ItemsEditor({ items, onChange, placeholder = 'List item' }) {
  const set = (i, v) => onChange(items.map((x, j) => j === i ? v : x))
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-[#325099]/40 text-xs mt-2 w-4 text-right">{i + 1}.</span>
          <textarea rows={1} className={TA + ' min-h-[38px]'} value={it} placeholder={placeholder}
            onChange={e => set(i, e.target.value)} onKeyDown={e => onFmtKey(e, it, v => set(i, v))} />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="text-rose-400 hover:text-rose-600 mt-1.5 text-sm" aria-label="Remove item" disabled={items.length === 1}>✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ''])} className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63]">＋ Add item</button>
    </div>
  )
}

function ChecklistEditor({ items, onChange }) {
  const set = (i, patch) => onChange(items.map((x, j) => j === i ? { ...x, ...patch } : x))
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="checkbox" checked={!!it.done} onChange={e => set(i, { done: e.target.checked })} className="accent-[#15803D]" />
          <input className={I} value={it.text} placeholder="Checklist item" onChange={e => set(i, { text: e.target.value })} onKeyDown={e => onFmtKey(e, it.text, v => set(i, { text: v }))} />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600 text-sm" aria-label="Remove" disabled={items.length === 1}>✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, { text: '', done: false }])} className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63]">＋ Add item</button>
    </div>
  )
}

function PairsEditor({ items, onChange, keyA, keyB, labelA, labelB }) {
  const set = (i, patch) => onChange(items.map((x, j) => j === i ? { ...x, ...patch } : x))
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => (
        <div key={i} className="rounded-lg border border-[#E6ECFF] bg-[#F8FAFF] p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/50">Item {i + 1}</span>
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600 text-xs" disabled={items.length === 1}>Remove</button>
          </div>
          <input className={I} value={it[keyA] || ''} placeholder={labelA} onChange={e => set(i, { [keyA]: e.target.value })} />
          <textarea className={TA} value={it[keyB] || ''} placeholder={labelB} onChange={e => set(i, { [keyB]: e.target.value })} onKeyDown={e => onFmtKey(e, it[keyB] || '', v => set(i, { [keyB]: v }))} />
        </div>
      ))}
      <button onClick={() => onChange([...items, { [keyA]: '', [keyB]: '' }])} className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63]">＋ Add item</button>
    </div>
  )
}

function TableEditor({ block, set }) {
  const rows = block.rows
  const setCell = (r, c, v) => set({ rows: rows.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? v : cell) : row) })
  const addRow = () => set({ rows: [...rows, rows[0].map(() => '')] })
  const delRow = (r) => set({ rows: rows.length > 1 ? rows.filter((_, i) => i !== r) : rows })
  const addCol = () => set({ rows: rows.map(row => [...row, '']) })
  const delCol = (c) => set({ rows: rows[0].length > 1 ? rows.map(row => row.filter((_, i) => i !== c)) : rows })
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[11px] font-semibold text-[#325099]">
        <input type="checkbox" checked={!!block.headerRow} onChange={e => set({ headerRow: e.target.checked })} className="accent-[#325099]" /> First row is a header
      </label>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="p-0.5">
                    <input className={I + ' min-w-[120px] text-xs'} value={cell} onChange={e => setCell(r, c, e.target.value)} />
                  </td>
                ))}
                <td className="pl-1"><button onClick={() => delRow(r)} className="text-rose-400 hover:text-rose-600 text-xs" aria-label="Delete row">✕ row</button></td>
              </tr>
            ))}
            <tr>{rows[0].map((_, c) => (
              <td key={c} className="text-center"><button onClick={() => delCol(c)} className="text-rose-400 hover:text-rose-600 text-[10px]" aria-label="Delete column">✕ col</button></td>
            ))}<td /></tr>
          </tbody>
        </table>
      </div>
      <div className="flex gap-3">
        <button onClick={addRow} className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63]">＋ Row</button>
        <button onClick={addCol} className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63]">＋ Column</button>
      </div>
    </div>
  )
}

function BlockFields({ block, onChange }) {
  const set = (patch) => onChange({ ...block, ...patch })
  switch (block.type) {
    case 'heading':
      return (
        <div className="flex gap-2">
          <select className={I + ' w-28'} value={block.level} onChange={e => set({ level: Number(e.target.value) })}>
            <option value={2}>Heading</option><option value={3}>Sub-heading</option>
          </select>
          <input className={I} value={block.text} placeholder="Heading text" onChange={e => set({ text: e.target.value })} onKeyDown={e => onFmtKey(e, block.text, v => set({ text: v }))} />
        </div>
      )
    case 'paragraph':
      return <textarea className={TA} value={block.text} placeholder="Write here… **bold**, *italic*, `code`, [link](url), ==highlight==" onChange={e => set({ text: e.target.value })} onKeyDown={e => onFmtKey(e, block.text, v => set({ text: v }))} />
    case 'quote':
      return (
        <div className="space-y-2">
          <textarea className={TA} value={block.text} placeholder="Quote" onChange={e => set({ text: e.target.value })} onKeyDown={e => onFmtKey(e, block.text, v => set({ text: v }))} />
          <input className={I} value={block.cite} placeholder="Attribution (optional)" onChange={e => set({ cite: e.target.value })} />
        </div>
      )
    case 'divider': return <p className="text-xs text-[#2A2035]/40 italic">A horizontal divider.</p>
    case 'bulleted': case 'numbered': case 'steps':
      return <ItemsEditor items={block.items} onChange={items => set({ items })} />
    case 'checklist':
      return <ChecklistEditor items={block.items} onChange={items => set({ items })} />
    case 'callout':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {CALLOUT_VARIANTS.map(v => (
              <button key={v.id} onClick={() => set({ variant: v.id })}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${block.variant === v.id ? 'text-white' : 'text-[#325099] border-[#DEE7FF] bg-white'}`}
                style={block.variant === v.id ? { background: v.accent, borderColor: v.accent } : {}}>{v.icon} {v.label}</button>
            ))}
          </div>
          <input className={I} value={block.title} placeholder="Title (optional)" onChange={e => set({ title: e.target.value })} />
          <textarea className={TA} value={block.body} placeholder="Callout text" onChange={e => set({ body: e.target.value })} onKeyDown={e => onFmtKey(e, block.body, v => set({ body: v }))} />
        </div>
      )
    case 'deadline':
      return (
        <div className="space-y-2">
          <input className={I} value={block.title} placeholder="Title (e.g. Reports due)" onChange={e => set({ title: e.target.value })} />
          <div className="flex gap-2">
            <input type="date" className={I + ' w-44'} value={block.date} onChange={e => set({ date: e.target.value })} />
            <input className={I} value={block.note} placeholder="Note (optional)" onChange={e => set({ note: e.target.value })} />
          </div>
        </div>
      )
    case 'columns':
      return (
        <div className="space-y-2">
          <select className={I + ' w-40'} value={block.count} onChange={e => { const count = Number(e.target.value); const cols = [...block.cols]; while (cols.length < count) cols.push(''); set({ count, cols: cols.slice(0, count) }) }}>
            <option value={2}>Two columns</option><option value={3}>Three columns</option>
          </select>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${block.count}, minmax(0,1fr))` }}>
            {Array.from({ length: block.count }).map((_, i) => (
              <textarea key={i} className={TA} value={block.cols[i] || ''} placeholder={`Column ${i + 1}`} onChange={e => set({ cols: block.cols.map((c, j) => j === i ? e.target.value : c) })} onKeyDown={e => onFmtKey(e, block.cols[i] || '', v => set({ cols: block.cols.map((c, j) => j === i ? v : c) }))} />
            ))}
          </div>
        </div>
      )
    case 'table': return <TableEditor block={block} set={set} />
    case 'accordion': return <PairsEditor items={block.items} onChange={items => set({ items })} keyA="title" keyB="body" labelA="Heading" labelB="Content" />
    case 'faq': return <PairsEditor items={block.items} onChange={items => set({ items })} keyA="q" keyB="a" labelA="Question" labelB="Answer" />
    case 'image':
      return (
        <div className="space-y-2">
          <ImageField value={block.path} onChange={path => set({ path })} />
          <input className={I} value={block.alt} placeholder="Alt text (describe the image for screen readers)" onChange={e => set({ alt: e.target.value })} />
          <input className={I} value={block.caption} placeholder="Caption (optional)" onChange={e => set({ caption: e.target.value })} />
          <div className="flex gap-2">
            <select className={I + ' w-36'} value={block.width} onChange={e => set({ width: e.target.value })}>{IMAGE_WIDTHS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</select>
            <select className={I + ' w-32'} value={block.align} onChange={e => set({ align: e.target.value })}>{ALIGNMENTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
          </div>
        </div>
      )
    case 'video':
      return (
        <div className="space-y-2">
          <input className={I} value={block.url} placeholder="YouTube or Vimeo URL" onChange={e => set({ url: e.target.value })} />
          <input className={I} value={block.caption} placeholder="Caption (optional)" onChange={e => set({ caption: e.target.value })} />
        </div>
      )
    case 'button':
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className={I} value={block.label} placeholder="Button label" onChange={e => set({ label: e.target.value })} />
            <select className={I + ' w-36'} value={block.variant} onChange={e => set({ variant: e.target.value })}>{BUTTON_VARIANTS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
          </div>
          <input className={I} value={block.href} placeholder="Link (/internal-path or https://external)" onChange={e => set({ href: e.target.value, external: /^https?:/i.test(e.target.value) })} />
        </div>
      )
    case 'portallink':
      return (
        <div className="space-y-2">
          <input className={I} value={block.label} placeholder="Link label" onChange={e => set({ label: e.target.value })} />
          <input className={I} value={block.href} placeholder="Portal path (e.g. /tutor/classes)" onChange={e => set({ href: e.target.value })} />
          <input className={I} value={block.desc} placeholder="Description (optional)" onChange={e => set({ desc: e.target.value })} />
        </div>
      )
    case 'contact':
      return (
        <div className="grid grid-cols-2 gap-2">
          <input className={I} value={block.name} placeholder="Name" onChange={e => set({ name: e.target.value })} />
          <input className={I} value={block.role} placeholder="Role" onChange={e => set({ role: e.target.value })} />
          <input className={I} value={block.email} placeholder="Email" onChange={e => set({ email: e.target.value })} />
          <input className={I} value={block.phone} placeholder="Phone" onChange={e => set({ phone: e.target.value })} />
        </div>
      )
    default: return null
  }
}

// Add-block menu (grouped palette).
function AddMenu({ onAdd, onClose }) {
  return (
    <div className="absolute z-30 mt-1 w-[440px] max-w-[88vw] bg-white border border-[#DEE7FF] rounded-xl shadow-lg p-3" role="menu">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60">Add a block</span>
        <button onClick={onClose} className="text-[#325099]/40 hover:text-[#325099] text-sm">✕</button>
      </div>
      <div className="space-y-2.5 max-h-[60vh] overflow-y-auto">
        {BLOCK_GROUPS.map(g => (
          <div key={g}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-[#2A2035]/35 mb-1">{g}</p>
            <div className="grid grid-cols-2 gap-1">
              {BLOCK_TYPES.filter(b => b.group === g).map(b => (
                <button key={b.type} onClick={() => onAdd(b.type)} className="flex items-center gap-2 text-left text-xs font-medium text-[#062E63] rounded-lg px-2 py-1.5 hover:bg-[#F0F4FF]" role="menuitem">
                  <span className="w-5 text-center text-[#5b7bc4]">{b.icon}</span>{b.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PageEditor({ page, staff }) {
  const [title, setTitle] = useState(page.title || '')
  const [blocks, setBlocks] = useState(Array.isArray(page.draft) ? page.draft : [])
  const [published, setPublished] = useState(page.published || null)
  const [status, setStatus] = useState(page.status)
  const [collapsed, setCollapsed] = useState({})
  const [addAt, setAddAt] = useState(null)       // index where the add-menu is open, or null
  const [confirmDel, setConfirmDel] = useState(null)
  const [saveState, setSaveState] = useState('saved') // saved | unsaved | saving | error
  const [device, setDevice] = useState('desktop')
  const [preview, setPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const [revs, setRevs] = useState(null)
  const [viewRev, setViewRev] = useState(null)
  const dragId = useRef(null)
  const firstRun = useRef(true)
  const editorName = staff?.full_name || ''

  const hasUnpublished = useMemo(
    () => status !== 'published' || JSON.stringify(blocks) !== JSON.stringify(published),
    [blocks, published, status])

  // Debounced autosave of the draft (skips the initial mount).
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    setSaveState('unsaved')
    const t = setTimeout(async () => {
      setSaveState('saving')
      try { await saveDraft(page.id, { title, draft: blocks, editorName }); setSaveState('saved') }
      catch { setSaveState('error') }
    }, 900)
    return () => clearTimeout(t)
  }, [title, blocks, page.id, editorName])

  // Warn on unload if a save is pending.
  useEffect(() => {
    const h = (e) => { if (saveState === 'unsaved' || saveState === 'saving') { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [saveState])

  const update = useCallback((id, next) => setBlocks(bs => bs.map(b => b.id === id ? next : b)), [])
  const addBlock = (type, index) => { const nb = newBlock(type); setBlocks(bs => { const c = [...bs]; c.splice(index ?? c.length, 0, nb); return c }); setAddAt(null) }
  const removeBlock = (id) => { setBlocks(bs => bs.filter(b => b.id !== id)); setConfirmDel(null) }
  const dupBlock = (id) => setBlocks(bs => { const i = bs.findIndex(b => b.id === id); if (i < 0) return bs; const c = [...bs]; c.splice(i + 1, 0, duplicateBlock(bs[i])); return c })
  const move = (id, dir) => setBlocks(bs => { const i = bs.findIndex(b => b.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= bs.length) return bs; const c = [...bs];[c[i], c[j]] = [c[j], c[i]]; return c })
  const onDrop = (id) => setBlocks(bs => { const from = bs.findIndex(b => b.id === dragId.current); const to = bs.findIndex(b => b.id === id); if (from < 0 || to < 0 || from === to) return bs; const c = [...bs]; const [m] = c.splice(from, 1); c.splice(to, 0, m); return c })

  const doPublish = async () => {
    setPublishing(true)
    try {
      await saveDraft(page.id, { title, draft: blocks, editorName })
      await publishPage(page.id, { editorId: staff?.id, editorName })
      setPublished(blocks); setStatus('published'); setSaveState('saved')
    } catch (e) { alert('Publish failed: ' + (e.message || e)) }
    finally { setPublishing(false) }
  }

  const openHistory = async () => { setHistOpen(true); setViewRev(null); setRevs(null); setRevs(await listRevisions(page.id)) }
  const doRestore = async (rev) => {
    if (!confirm('Restore this revision into the draft? Your current unsaved draft will be replaced (publish to make it live).')) return
    await restoreRevision(page.id, rev.blocks)
    setBlocks(rev.blocks); setHistOpen(false); setViewRev(null)
  }

  const words = pageWordCount(blocks)
  const deviceW = device === 'mobile' ? 390 : device === 'tablet' ? 768 : '100%'

  const saveBadge = (() => {
    const map = {
      saved: ['Saved', 'text-[#15803D] bg-[#F0FDF4] border-[#A7F3D0]'],
      unsaved: ['Unsaved…', 'text-[#92400E] bg-[#FFF7ED] border-[#FDE2B8]'],
      saving: ['Saving…', 'text-[#325099] bg-[#EEF4FF] border-[#C7D5F8]'],
      error: ['Save failed', 'text-[#991B1B] bg-[#FEF2F2] border-[#FCA5A5]'],
    }
    const [t, c] = map[saveState] || map.saved
    return <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${c}`}>{t}</span>
  })()

  return (
    <div className="min-h-screen bg-[#F7F9FF]">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#DEE7FF]">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center gap-3 flex-wrap">
          <Link href="/tutor/hub/manage" className="text-sm font-semibold text-[#325099] hover:text-[#062E63]">← Pages</Link>
          {saveBadge}
          <span className="text-[11px] text-[#2A2035]/45">{words} word{words === 1 ? '' : 's'}</span>
          <div className="flex-1" />
          <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden text-xs">
            {['desktop', 'tablet', 'mobile'].map(d => (
              <button key={d} onClick={() => { setDevice(d); setPreview(true) }} title={d}
                className={`px-2.5 py-1.5 font-semibold capitalize ${device === d && preview ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>{d === 'desktop' ? '🖥' : d === 'tablet' ? '▭' : '▯'}</button>
            ))}
          </div>
          <button onClick={() => setPreview(p => !p)} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3.5 py-1.5 hover:bg-[#F0F4FF]">{preview ? '✎ Edit' : '👁 Preview'}</button>
          <button onClick={openHistory} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3.5 py-1.5 hover:bg-[#F0F4FF]">↺ History</button>
          <button onClick={doPublish} disabled={publishing}
            className="text-xs font-semibold text-white bg-[#062E63] rounded-full px-4 py-1.5 hover:bg-[#325099] disabled:opacity-50">
            {publishing ? 'Publishing…' : hasUnpublished ? '● Publish changes' : 'Published'}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-8">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Page title"
          className="w-full text-2xl md:text-3xl font-bold text-[#062E63] font-display bg-transparent focus:outline-none mb-6 placeholder:text-[#062E63]/30" />

        {preview ? (
          <div className="flex justify-center">
            <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 md:p-8 transition-all" style={{ width: deviceW, maxWidth: '100%' }}>
              {blocks.length ? <InfoBlocks blocks={blocks} /> : <p className="text-sm text-[#2A2035]/40 text-center py-10">Nothing to preview yet.</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {blocks.length === 0 && (
              <div className="text-center py-10 border border-dashed border-[#DEE7FF] rounded-xl text-sm text-[#2A2035]/45">No blocks yet — add your first block below.</div>
            )}
            {blocks.map((b, i) => (
              <div key={b.id}>
                {/* insert-between */}
                <div className="relative h-3 group">
                  <button onClick={() => setAddAt(addAt === i ? null : i)} aria-label="Add block here"
                    className="absolute left-1/2 -translate-x-1/2 -top-1 opacity-0 group-hover:opacity-100 text-[10px] font-bold text-[#325099] bg-white border border-[#DEE7FF] rounded-full w-5 h-5 leading-none hover:bg-[#F0F4FF]">＋</button>
                  {addAt === i && <AddMenu onAdd={t => addBlock(t, i)} onClose={() => setAddAt(null)} />}
                </div>
                <div draggable onDragStart={() => { dragId.current = b.id }} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(b.id)}
                  className="bg-white rounded-xl border border-[#DEE7FF] hover:border-[#BACBFF] transition group">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[#EEF2FF]">
                    <span className="cursor-grab text-[#2A2035]/25" title="Drag to reorder" aria-hidden="true">⠿</span>
                    <span className="text-[10px] font-bold tracking-wider uppercase text-[#325099] bg-[#EEF4FF] border border-[#DEE7FF] rounded-full px-2 py-0.5">{blockIcon(b.type)} {blockLabel(b.type)}</span>
                    <div className="flex-1" />
                    <button onClick={() => setCollapsed(c => ({ ...c, [b.id]: !c[b.id] }))} className="text-[#2A2035]/40 hover:text-[#325099] text-xs px-1" aria-label="Collapse">{collapsed[b.id] ? '▸' : '▾'}</button>
                    <button onClick={() => move(b.id, -1)} disabled={i === 0} className="text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20 text-xs px-1" aria-label="Move up">↑</button>
                    <button onClick={() => move(b.id, 1)} disabled={i === blocks.length - 1} className="text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20 text-xs px-1" aria-label="Move down">↓</button>
                    <button onClick={() => dupBlock(b.id)} className="text-[#2A2035]/40 hover:text-[#325099] text-xs px-1" aria-label="Duplicate">⧉</button>
                    <button onClick={() => setConfirmDel(b.id)} className="text-rose-400 hover:text-rose-600 text-xs px-1" aria-label="Delete">🗑</button>
                  </div>
                  {!collapsed[b.id] && (
                    <div className="p-3">
                      <BlockFields block={b} onChange={next => update(b.id, next)} />
                    </div>
                  )}
                  {confirmDel === b.id && (
                    <div className="px-3 pb-3 flex items-center gap-2 text-xs">
                      <span className="text-[#991B1B] font-semibold">Delete this block?</span>
                      <button onClick={() => removeBlock(b.id)} className="font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-full px-3 py-1">Delete</button>
                      <button onClick={() => setConfirmDel(null)} className="text-[#325099]/60 hover:text-[#325099]">Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* add at end */}
            <div className="relative pt-2">
              <button onClick={() => setAddAt(addAt === 'end' ? null : 'end')}
                className="w-full text-sm font-semibold text-[#325099] border border-dashed border-[#BACBFF] rounded-xl py-2.5 hover:bg-[#F0F4FF]">＋ Add block</button>
              {addAt === 'end' && <AddMenu onAdd={t => addBlock(t)} onClose={() => setAddAt(null)} />}
            </div>
          </div>
        )}
      </div>

      {histOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) setHistOpen(false) }} role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-10 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#DEE7FF]">
              <h2 className="text-base font-bold text-[#062E63]">Version history</h2>
              <button onClick={() => setHistOpen(false)} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg" aria-label="Close">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {revs === null ? (
                <p className="p-6 text-sm text-[#2A2035]/45">Loading…</p>
              ) : revs.length === 0 ? (
                <p className="p-6 text-sm text-[#2A2035]/45">No published revisions yet. Each time you publish, a snapshot is saved here.</p>
              ) : viewRev ? (
                <div className="p-5">
                  <button onClick={() => setViewRev(null)} className="text-xs font-semibold text-[#325099] mb-3">← Back to list</button>
                  <div className="bg-[#F8FAFF] rounded-xl border border-[#DEE7FF] p-5"><InfoBlocks blocks={viewRev.blocks} /></div>
                </div>
              ) : (
                <div className="divide-y divide-[#EEF2FF]">
                  {revs.map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#FAFBFF]">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[#062E63]">{new Date(r.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                        <div className="text-[11px] text-[#2A2035]/50">{r.editor_name || 'Unknown'}{r.note ? ` · ${r.note}` : ''}</div>
                      </div>
                      <button onClick={() => setViewRev(r)} className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63]">Preview</button>
                      <button onClick={() => doRestore(r)} className="text-[11px] font-semibold text-white bg-[#062E63] rounded-full px-3 py-1 hover:bg-[#325099]">Restore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

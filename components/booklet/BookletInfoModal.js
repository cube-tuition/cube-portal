'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { curriculumTerms } from '../../lib/terms'
import BookletContentView from './BookletContentView'
import useChemModules from './useChemModules'
import { isChemistry, chemModuleNumber, chemModuleLabel } from '../../lib/format'
import LatexContent from '../qbank/LatexContent'
import {
  fmtItemDate, sortItems, openCount,
  addStaffItem, setItemDone, removeItem,
} from '../../lib/bookletChecklist'

/*
 * BookletInfoModal — everything about one booklet in a single large modal,
 * shared by the curriculum view and the master database so both read the same.
 *
 * This is the ONLY place a booklet is edited: the cards and rows carry no Edit
 * button and no note preview, so a booklet's details, content, notes, PDFs and
 * improvement checklists are all read and changed here.
 *
 * Every write touches ONLY its own columns (details / content / notes / PDFs /
 * a checklist RPC) and saves on its own button, so two people with the modal
 * open can't clobber each other's unrelated fields, and it is safe to open on a
 * partial row — the modal re-reads the full booklets row on open anyway, both
 * to fill missing fields and to pick up entries tutors added since page load.
 *
 * Props: booklet (row with at least { id }) — null closes; title (heading);
 *        staff (for the "done by" stamp); content (optional override for the
 *        Content section — the master DB passes build-derived Chemistry
 *        content); topicBank ([{ id, name }] suggestions);
 *        onClose(); onChanged(patch) — partial booklet fields after any write.
 */

const WORKBOOK_STATUSES = ['Not Started', 'In Progress', 'Needs Improvement', 'Complete']
const STATUS_SELECT_CLS = {
  'Complete':          'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Needs Improvement': 'bg-amber-100 text-amber-800 border-amber-200',
  'In Progress':       'bg-blue-100 text-blue-800 border-blue-200',
  'Not Started':       'bg-gray-100 text-gray-500 border-gray-200',
}

const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]
const SUBJECTS_BY_YEAR = {
  11: ['English', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Chemistry'],
  12: ['English', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths', 'Chemistry'],
}
const getSubjects = (year) => SUBJECTS_BY_YEAR[year] || ['Maths', 'English']

// Fallback topic suggestions for years/subjects with no topic bank of their own.
const COMMON_TOPICS = [
  'Number & Algebra', 'Fractions & Decimals', 'Ratios & Rates', 'Percentages',
  'Linear Relationships', 'Equations & Inequalities', 'Quadratics', 'Functions & Graphs',
  'Measurement & Geometry', 'Trigonometry', 'Probability & Statistics',
  'Financial Mathematics', 'Calculus', 'Reading Comprehension', 'Creative Writing',
  'Persuasive Writing', 'Grammar & Punctuation', 'Vocabulary', 'Poetry',
  'Narrative Techniques', 'Essay Writing',
]

const LIST_META = {
  fixes:       { label: 'Fixes',       blurb: 'Errors to correct', addHint: 'Something to correct…' },
  suggestions: { label: 'Suggestions', blurb: 'Ideas for improvement', addHint: 'Something that would make it better…' },
}

// Collision-proof suffix for a storage path. Module scope on purpose: Date.now
// and Math.random are impure, and the React compiler rejects them inside a
// component body.
const uploadStamp = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`

const FIELD = 'w-full border border-[#E8EDF8] rounded-lg px-2.5 py-1.5 text-[12px] text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] transition'
const FIELD_LABEL = 'block text-[9px] font-bold tracking-widest uppercase text-[#325099]/60 mb-1'

function SectionLabel({ children, right }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-2">
      <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#325099]/60">{children}</p>
      {right}
    </div>
  )
}

// Shared save button for the per-section saves.
function SaveButton({ dirty, state, onClick, label = 'Save' }) {
  return (
    <button
      onClick={onClick}
      disabled={!dirty || state === 'saving'}
      className="shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-bold text-white bg-[#325099] hover:bg-[#062E63] transition disabled:opacity-40 disabled:hover:bg-[#325099]"
    >{state === 'saving' ? 'Saving…' : label}</button>
  )
}

const SavedNote = ({ state, children }) => (
  <p className="text-[10px] text-[#2A2035]/40">
    {state === 'saved' ? <span className="text-[#065F46] font-semibold">✓ Saved.</span> : children}
  </p>
)

// One checklist (fixes OR suggestions): tick, staff-delete, add. Mirrors the
// rules the lesson page and SQL enforce — lesson items tick but never delete.
function ChecklistColumn({ list, items, bookletId, staff, busy, setBusy, onList, onErr, readOnly = false }) {
  const meta = LIST_META[list]
  const [draft, setDraft] = useState('')
  const open = openCount(items)

  const run = async (key, fn) => {
    setBusy(key); onErr('')
    try { onList(await fn()) }
    catch (e) { onErr(e.message || String(e)) }
    finally { setBusy(null) }
  }

  return (
    <div className="min-w-0 flex flex-col rounded-xl border border-[#E8EDF8] bg-[#FBFCFF]">
      <div className="px-3.5 pt-3 pb-2 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold text-[#062E63]">
          {meta.label}
          {open > 0 && <span className="ml-1.5 text-[10px] font-bold text-[#B45309]">{open} open</span>}
        </p>
        <span className="text-[9px] text-[#2A2035]/35 uppercase tracking-wider">{meta.blurb}</span>
      </div>

      <div className="px-3.5 pb-2 flex-1 space-y-1.5 overflow-y-auto max-h-56">
        {items.length === 0 ? (
          <p className="text-[11px] text-[#2A2035]/35 py-3 text-center">Nothing here yet.</p>
        ) : sortItems(items).map(it => (
          <div key={it.id}
            className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${
              it.done ? 'border-[#EEF1F6] bg-white/60' : 'border-[#E8EDF8] bg-white'}`}>
            <button
              onClick={() => run(it.id, () => setItemDone({
                bookletId, list, itemId: it.id, done: !it.done, by: staff?.full_name }))}
              disabled={readOnly || busy === it.id}
              title={it.done ? 'Mark as not done' : 'Mark as done'}
              className={`mt-0.5 w-3.5 h-3.5 rounded shrink-0 border flex items-center justify-center text-[9px] leading-none transition disabled:opacity-40 ${
                it.done ? 'bg-[#065F46] border-[#065F46] text-white' : 'border-[#C7D0E0] hover:border-[#325099]'}`}
            >{it.done ? '✓' : ''}</button>
            <div className="min-w-0 flex-1">
              <p className={`text-[12px] leading-snug whitespace-pre-line ${
                it.done ? 'text-[#2A2035]/40 line-through' : 'text-[#2A2035]'}`}>{it.text}</p>
              <p className="text-[9px] text-[#2A2035]/40 mt-0.5">
                {[fmtItemDate(it.date), it.class_name, it.author].filter(Boolean).join(' · ')}
                {it.source === 'staff' && <span className="ml-1 text-[#325099]/50">· added here</span>}
                {it.done && it.done_by && <span className="ml-1 text-[#065F46]/70">· done by {it.done_by}</span>}
              </p>
            </div>
            {it.source === 'staff' && !readOnly && (
              <button
                onClick={() => run(it.id, () => removeItem({ bookletId, list, itemId: it.id }))}
                disabled={busy === it.id}
                title="Delete this item"
                className="shrink-0 text-[9px] font-semibold text-[#2A2035]/25 hover:text-[#DC2626] transition disabled:opacity-40"
              >Delete</button>
            )}
          </div>
        ))}
      </div>

      {readOnly ? <div className="pb-1.5" /> : <div className="px-3.5 pb-3 flex items-end gap-1.5">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={1}
          placeholder={meta.addHint}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-[#E8EDF8] bg-white text-[12px] text-[#2A2035] leading-relaxed placeholder:text-[#2A2035]/25 focus:outline-none focus:border-[#325099] transition resize-y"
        />
        <button
          onClick={() => run('add:' + list, async () => {
            const next = await addStaffItem({ bookletId, list, text: draft.trim(), author: staff?.full_name })
            setDraft('')
            return next
          })}
          disabled={!draft.trim() || busy === 'add:' + list}
          className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-[#325099] hover:bg-[#062E63] transition disabled:opacity-40 disabled:hover:bg-[#325099]"
        >{busy === 'add:' + list ? '…' : 'Add'}</button>
      </div>}
    </div>
  )
}

// The printable PDFs attached to the booklet. Uploads and removals write
// straight away (the file is already in storage by then, so staging them behind
// a Save button would only risk orphans). file_path stays in step with
// file_paths[0] — older screens still read the single-path column.
function PdfList({ row, patch, onErr, readOnly = false }) {
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)
  const [confirmIdx, setConfirmIdx] = useState(null)

  const paths = row.file_paths?.length ? row.file_paths : (row.file_path ? [row.file_path] : [])
  const names = row.pdf_filenames || []

  const write = async (nextPaths, nextNames) => {
    const update = { file_path: nextPaths[0] ?? null, file_paths: nextPaths, pdf_filenames: nextNames }
    const { error } = await supabase.from('booklets').update(update).eq('id', row.id)
    if (error) { onErr('Could not save PDFs: ' + error.message); return false }
    patch(update)
    return true
  }

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true); onErr('')
    const nextPaths = [...paths]
    const nextNames = [...names]
    for (const file of files) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `y${row.year}/${String(row.subject || '').toLowerCase()}/${uploadStamp()}_${safe}`
      const { error } = await supabase.storage.from('booklets').upload(path, file, { upsert: true })
      if (error) { onErr('Upload failed: ' + error.message); setUploading(false); return }
      nextPaths.push(path)
      nextNames.push(file.name.replace(/\.[^.]+$/, ''))
    }
    await write(nextPaths, nextNames)
    setUploading(false)
  }

  const handleRemove = async (i) => {
    if (confirmIdx !== i) { setConfirmIdx(i); setTimeout(() => setConfirmIdx(c => (c === i ? null : c)), 3000); return }
    setConfirmIdx(null); onErr('')
    const removed = paths[i]
    const ok = await write(paths.filter((_, j) => j !== i), names.filter((_, j) => j !== i))
    if (ok) await supabase.storage.from('booklets').remove([removed])
  }

  return (
    <div className="min-w-0">
      <div className="space-y-1.5">
        {paths.map((path, i) => {
          const url = supabase.storage.from('booklets').getPublicUrl(path).data?.publicUrl
          const name = names[i] || `PDF ${i + 1}`
          return (
            <div key={path} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#F0F4FF]">
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="text-[12px] font-semibold text-[#325099] truncate hover:underline">📄 {name}</a>
              ) : (
                <span className="text-[12px] font-semibold text-[#325099] truncate">📄 {name}</span>
              )}
              {!readOnly && <button
                onClick={() => handleRemove(i)}
                title={confirmIdx === i ? 'Click again to delete this PDF' : 'Remove this PDF'}
                className={`shrink-0 text-[10px] font-semibold transition ${
                  confirmIdx === i ? 'text-red-600' : 'text-[#2A2035]/25 hover:text-red-500'}`}
              >{confirmIdx === i ? 'Click to confirm' : 'Remove'}</button>}
            </div>
          )
        })}
      </div>
      {!readOnly && <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="w-full mt-1.5 border-2 border-dashed border-[#DEE7FF] rounded-xl px-4 py-2.5 text-[12px] text-[#2A2035]/40 hover:border-[#325099] hover:text-[#325099] hover:bg-[#F8FAFF] transition disabled:opacity-50"
      >{uploading ? 'Uploading…' : paths.length ? '+ Add another PDF' : 'Attach PDF(s)'}</button>}
      <input ref={fileRef} type="file" accept="application/pdf" multiple className="hidden" onChange={handleUpload} />
    </div>
  )
}

/* readOnly: tutors get the same modal purely to READ — every field disabled,
   every save/upload/remove/add control gone. Nothing here writes for them. */
export default function BookletInfoModal({ booklet, title, staff, content, topicBank, onClose, onChanged, readOnly = false }) {
  const { moduleNames } = useChemModules()      // Chemistry files by module, not topic
  const [row, setRow] = useState(null)          // full booklets row, re-read on open
  const [form, setForm] = useState(null)        // editable details
  const [detailState, setDetailState] = useState('idle')   // idle | saving | saved | error
  const [notes, setNotes] = useState('')
  const [notesStatus, setNotesStatus] = useState('idle')
  const [contentText, setContentText] = useState('')
  const [contentState, setContentState] = useState('idle')
  const [syll, setSyll] = useState(null)        // syllabus structure for year+subject (null = loading)
  const [selected, setSelected] = useState(() => new Set())
  const [openChapters, setOpenChapters] = useState(() => new Set())
  const [syllDirty, setSyllDirty] = useState(false)
  const [busy, setBusy] = useState(null)        // checklist item id / add key being written
  const [err, setErr] = useState('')

  const fillFrom = (data) => {
    setRow(data)
    setNotes(data.notes || '')
    setContentText(data.content || '')
    setForm({
      booklet_name: data.booklet_name ?? '',
      year:         data.year ?? '',
      subject:      data.subject ?? '',
      topic:        data.topic ?? '',
      term_number:  data.term_number ?? '',
      week:         data.week ?? '',
    })
  }

  useEffect(() => {
    if (!booklet) return undefined
    let cancelled = false
    setErr(''); setNotesStatus('idle'); setDetailState('idle'); setContentState('idle')
    setSyllDirty(false)
    fillFrom(booklet)                                  // show what we have immediately
    supabase.from('booklets').select('*').eq('id', booklet.id).single()
      .then(({ data }) => { if (!cancelled && data) fillFrom(data) })
    return () => { cancelled = true }
  }, [booklet])

  // Syllabus sections for the booklet's year + subject. Ticking them writes the
  // booklet's Content (one line per section) plus the dotpoint ids the syllabus
  // page reads for its "covered" ticks. Subjects with no syllabus loaded fall
  // back to free-text content below.
  const sYear = row?.year
  const sSubject = row?.subject
  useEffect(() => {
    if (!booklet) return undefined
    let cancelled = false
    ;(async () => {
      if (!sSubject || !sYear) { setSyll([]); return }
      setSyll(null)
      const { data: mods } = await supabase.from('syllabus_modules')
        .select('id, name, sort_order').eq('subject', sSubject).eq('year', Number(sYear)).order('sort_order')
      if (cancelled) return
      if (!mods?.length) { setSyll([]); return }
      const { data: tops } = await supabase.from('syllabus_topics')
        .select('id, module_id, name, sort_order').in('module_id', mods.map(m => m.id)).order('sort_order')
      const { data: dps } = await supabase.from('syllabus_dotpoints')
        .select('id, topic_id, text, sort_order').in('topic_id', (tops || []).map(t => t.id)).order('sort_order')
      if (cancelled) return
      const structure = mods.map(m => ({
        ...m,
        chapters: (tops || []).filter(t => t.module_id === m.id).map(t => ({
          ...t,
          points: (dps || []).filter(d => d.topic_id === t.id),
        })),
      }))
      setSyll(structure)
      setSyllDirty(false)
      // Pre-tick this booklet's saved dotpoint ids; fall back to matching
      // Content lines by text for booklets saved before ids were recorded.
      const saved = booklet.id === row?.id ? row : booklet
      if (Array.isArray(saved?.syllabus_points) && saved.syllabus_points.length) {
        setSelected(new Set(saved.syllabus_points))
      } else if (saved?.content) {
        const lines = new Set(saved.content.split('\n').map(l => l.trim()).filter(Boolean))
        const pre = new Set()
        for (const m of structure) for (const ch of m.chapters) for (const p of ch.points) {
          if (lines.has(p.text.trim())) pre.add(p.id)
        }
        setSelected(pre)
      } else {
        setSelected(new Set())
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booklet, sYear, sSubject])

  if (!booklet || !row || !form) return null

  const patch = (p) => { setRow(r => ({ ...r, ...p })); onChanged?.(p) }
  const setField = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setDetailState('idle') }

  const saveStatus = async (status) => {
    const prev = row.status
    patch({ status })
    const { error } = await supabase.from('booklets').update({ status }).eq('id', row.id)
    if (error) { patch({ status: prev }); setErr('Could not save status: ' + error.message) }
  }

  const saveDetails = async () => {
    if (!form.booklet_name.trim()) { setErr('Booklet name is required.'); return }
    setDetailState('saving'); setErr('')
    const payload = {
      booklet_name: form.booklet_name.trim(),
      year:         form.year !== '' ? Number(form.year) : null,
      subject:      form.subject || null,
      topic:        form.topic.trim() || null,
      term_number:  form.term_number !== '' ? Number(form.term_number) : null,
      week:         form.week !== '' ? Number(form.week) : null,
    }
    const { error } = await supabase.from('booklets').update(payload).eq('id', row.id)
    if (error) { setDetailState('error'); setErr('Could not save details: ' + error.message); return }
    patch(payload)
    setDetailState('saved')
  }

  const saveNotes = async () => {
    setNotesStatus('saving'); setErr('')
    const value = notes.trim() || null
    const { error } = await supabase.from('booklets').update({ notes: value }).eq('id', row.id)
    if (error) { setNotesStatus('error'); setErr('Could not save notes: ' + error.message); return }
    patch({ notes: value })
    setNotesStatus('saved')
  }

  // Ticked syllabus sections become Content, in syllabus order, alongside the
  // dotpoint ids. Topic auto-fills from the first ticked chapter when blank.
  const saveSyllabusContent = async () => {
    setContentState('saving'); setErr('')
    const ordered = [], orderedIds = []
    let firstChapter = null
    for (const m of syll) for (const ch of m.chapters) for (const p of ch.points) {
      if (selected.has(p.id)) { ordered.push(p.text); orderedIds.push(p.id); if (!firstChapter) firstChapter = ch.name }
    }
    const payload = {
      content: ordered.length ? ordered.join('\n') : null,
      syllabus_points: orderedIds.length ? orderedIds : null,
    }
    if (!row.topic && firstChapter && !isChemistry(row.subject)) {
      payload.topic = firstChapter.includes(' — ') ? firstChapter.split(' — ').slice(1).join(' — ') : firstChapter
    }
    const { error } = await supabase.from('booklets').update(payload).eq('id', row.id)
    if (error) { setContentState('error'); setErr('Could not save content: ' + error.message); return }
    patch(payload)
    if (payload.topic) setForm(f => ({ ...f, topic: payload.topic }))
    setContentText(payload.content || '')
    setSyllDirty(false)
    setContentState('saved')
  }

  const saveFreeContent = async () => {
    setContentState('saving'); setErr('')
    const value = contentText.trim() || null
    const { error } = await supabase.from('booklets').update({ content: value }).eq('id', row.id)
    if (error) { setContentState('error'); setErr('Could not save content: ' + error.message); return }
    patch({ content: value })
    setContentState('saved')
  }

  const togglePoint = (id) => {
    setSyllDirty(true); setContentState('idle')
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const detailsDirty = ['booklet_name', 'topic'].some(k => (form[k].trim() || '') !== ((row[k] ?? '') || ''))
    || ['year', 'subject', 'term_number', 'week'].some(k => String(form[k] ?? '') !== String(row[k] ?? ''))
  const notesDirty = (notes.trim() || null) !== (row.notes || null)
  const freeContentDirty = (contentText.trim() || null) !== (row.content || null)

  const isChem = row.subject === 'Chemistry'
  const shownContent = (content ?? row.content) || ''
  const hasPicker = !isChem && Array.isArray(syll) && syll.length > 0
  const termOptions = (() => {
    const base = curriculumTerms(Number(form.year))
    const cur = Number(form.term_number)
    return Number.isFinite(cur) && cur > 0 && !base.includes(cur) ? [...base, cur].sort() : base
  })()
  const topicOptions = (topicBank?.length ? topicBank.map(t => t.name || t) : COMMON_TOPICS)

  const blockClose = busy || notesStatus === 'saving' || detailState === 'saving' || contentState === 'saving'

  // Each section saves on its own button, so closing with an unsaved edit
  // silently drops it — worth one confirm now that this modal is the only way
  // to edit a booklet.
  const anyDirty = detailsDirty || notesDirty || syllDirty || (!hasPicker && !isChem && freeContentDirty)
  const tryClose = () => {
    if (blockClose) return
    if (anyDirty && !window.confirm('You have unsaved changes. Close anyway?')) return
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) tryClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        {/* Header: name, status (editable) */}
        <div className="px-6 py-4 border-b border-[#F0F4FF]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Booklet info</p>
              <h2 className="text-base font-bold text-[#062E63] truncate">{row.booklet_name || title}</h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {readOnly ? (
                <span className={`text-[10px] font-semibold rounded-full px-2 py-1 border ${
                  STATUS_SELECT_CLS[row.status || 'Not Started']}`}>{row.status || 'Not Started'}</span>
              ) : (
                <select
                  value={row.status || 'Not Started'}
                  onChange={e => saveStatus(e.target.value)}
                  className={`text-[10px] font-semibold rounded-full px-2 py-1 border cursor-pointer focus:outline-none transition ${
                    STATUS_SELECT_CLS[row.status || 'Not Started']}`}
                >
                  {WORKBOOK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              <button onClick={tryClose}
                className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {/* Details */}
          <div>
            <SectionLabel right={!readOnly && <SavedNote state={detailState}>Changes save when you press the button.</SavedNote>}>
              Details
            </SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
              <div className="col-span-2 sm:col-span-6">
                <label className={FIELD_LABEL}>Booklet name</label>
                <input value={form.booklet_name} onChange={setField('booklet_name')} disabled={readOnly} className={FIELD} placeholder="e.g. Linear Relationships 2" />
              </div>
              <div className="sm:col-span-1">
                <label className={FIELD_LABEL}>Year</label>
                <select value={form.year} onChange={setField('year')} disabled={readOnly} className={FIELD}>
                  {/* A booklet with no year kept one: without it the select
                      would display Year 5 while the row says nothing. */}
                  {form.year === '' && <option value="">—</option>}
                  {YEARS.map(y => <option key={y} value={y}>Year {y}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={FIELD_LABEL}>Subject</label>
                <select value={form.subject} onChange={setField('subject')} disabled={readOnly} className={FIELD}>
                  {form.subject === '' && <option value="">—</option>}
                  {[...new Set([...getSubjects(Number(form.year)), form.subject].filter(Boolean))].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className={FIELD_LABEL}>Term</label>
                <select value={form.term_number} onChange={setField('term_number')} disabled={readOnly} className={FIELD}>
                  <option value="">—</option>
                  {termOptions.map(t => <option key={t} value={t}>T{t}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={FIELD_LABEL}>Week</label>
                <input type="number" min={1} max={10} value={form.week} onChange={setField('week')} disabled={readOnly} className={FIELD} placeholder="—" />
              </div>
              <div className="col-span-2 sm:col-span-3">
                {/* Chemistry files by module, read off the booklet name — there
                    is no topic to assign, so the field states what it derived. */}
                {isChemistry(form.subject) ? (
                  <>
                    <label className={FIELD_LABEL}>Module</label>
                    <p className="text-[11px] text-[#2A2035]/50 bg-[#F8FAFF] border border-[#E8EDF8] rounded-lg px-3 py-2">
                      {chemModuleNumber(form.booklet_name) != null ? (
                        <>From the name: <span className="font-semibold text-[#0F766E]">{chemModuleLabel(chemModuleNumber(form.booklet_name), moduleNames)}</span></>
                      ) : (
                        <>Name it <span className="font-semibold">M&lt;module&gt;L&lt;lesson&gt;</span> (e.g. M3L2) to file it under a module.</>
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <label className={FIELD_LABEL}>Topic</label>
                    <input value={form.topic} onChange={setField('topic')} disabled={readOnly} list="booklet-info-topics" className={FIELD} placeholder="e.g. Linear Relationships" />
                    <datalist id="booklet-info-topics">
                      {topicOptions.map(t => <option key={t} value={t} />)}
                    </datalist>
                  </>
                )}
              </div>
            </div>
            {!readOnly && (
              <div className="flex justify-end mt-2">
                <SaveButton dirty={detailsDirty} state={detailState} onClick={saveDetails} label="Save details" />
              </div>
            )}
          </div>

          {/* Content */}
          <div>
            <SectionLabel right={!isChem && <SavedNote state={contentState} />}>Content</SectionLabel>
            {isChem ? (
              <>
                {shownContent.trim() ? (
                  <div className="max-h-52 overflow-y-auto rounded-xl border border-[#EEF2FB] bg-[#FBFCFF] px-4 py-3">
                    <BookletContentView text={shownContent} />
                  </div>
                ) : (
                  <p className="text-[12px] text-[#2A2035]/35">No content listed for this booklet yet.</p>
                )}
                <p className="text-[10px] text-[#2A2035]/40 mt-1.5">
                  Chemistry content is chosen as a dotpoint checklist on the workbook builder’s Content tab, then allocated to section headers on its Content page — edit it there.
                </p>
              </>
            ) : syll === null ? (
              <p className="text-[12px] text-[#2A2035]/35">Loading syllabus…</p>
            ) : hasPicker ? (
              <>
                <div className="border border-[#E8EDF8] rounded-xl max-h-56 overflow-y-auto">
                  {syll.map(m => (
                    <div key={m.id}>
                      {syll.length > 1 && (
                        <div className="px-3 py-1.5 bg-[#EEF4FF] text-[10px] font-bold text-[#325099] sticky top-0">{m.name}</div>
                      )}
                      {m.chapters.map(ch => {
                        const open = openChapters.has(ch.id)
                        const count = ch.points.filter(p => selected.has(p.id)).length
                        return (
                          <div key={ch.id} className="border-b border-[#F0F4FF] last:border-0">
                            <button
                              type="button"
                              onClick={() => setOpenChapters(prev => {
                                const n = new Set(prev)
                                if (n.has(ch.id)) n.delete(ch.id); else n.add(ch.id)
                                return n
                              })}
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#F8FAFF] transition"
                            >
                              <span className={`text-[11px] ${count ? 'font-bold text-[#062E63]' : 'font-semibold text-[#2A2035]/70'}`}>{ch.name}</span>
                              <span className="text-[10px] text-[#325099] shrink-0">{count ? `${count} ✓ ` : ''}{open ? '▾' : '▸'}</span>
                            </button>
                            {open && ch.points.map(p => (
                              <label key={p.id} className="flex items-start gap-2 px-4 py-1 cursor-pointer hover:bg-[#F8FAFF]">
                                <input type="checkbox" checked={selected.has(p.id)} onChange={() => togglePoint(p.id)} disabled={readOnly} className="mt-0.5 accent-[#325099]" />
                                <LatexContent className="text-[11px] text-[#2A2035]/80 leading-snug" text={p.text} />
                              </label>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
                {!readOnly && (
                  <div className="flex items-center justify-between gap-3 mt-1.5">
                    <p className="text-[10px] text-[#2A2035]/40">
                      Tick the syllabus sections this booklet covers — they become its Content, and Topic auto-fills from the chapter when blank.
                    </p>
                    <SaveButton dirty={syllDirty} state={contentState} onClick={saveSyllabusContent} label="Save content" />
                  </div>
                )}
              </>
            ) : (
              <>
                <textarea
                  value={contentText}
                  onChange={e => { setContentText(e.target.value); setContentState('idle') }}
                  disabled={readOnly}
                  rows={5}
                  placeholder={'What\'s in this booklet? e.g.\n• Area of triangles\n• Area of composite shapes\n• 12 practice questions'}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#E8EDF8] bg-[#F8FAFF] text-[13px] text-[#2A2035] leading-relaxed placeholder:text-[#2A2035]/25 focus:outline-none focus:border-[#325099] focus:bg-white transition resize-y"
                />
                {!readOnly && (
                  <div className="flex items-center justify-between gap-3 mt-1.5">
                    <p className="text-[10px] text-[#2A2035]/40">One line per item — shown here and on the booklet’s row.</p>
                    <SaveButton dirty={freeContentDirty} state={contentState} onClick={saveFreeContent} label="Save content" />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Notes */}
          <div>
            <SectionLabel>Notes</SectionLabel>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setNotesStatus('idle') }}
              disabled={readOnly}
              rows={4}
              placeholder="Notes about this booklet — what to emphasise, what to skip, how it went, anything the next tutor should know…"
              className="w-full px-3 py-2.5 rounded-xl border border-[#E8EDF8] bg-[#F8FAFF] text-[13px] text-[#2A2035] leading-relaxed placeholder:text-[#2A2035]/25 focus:outline-none focus:border-[#325099] focus:bg-white transition resize-y"
            />
            <div className="flex items-center justify-between gap-3 mt-1.5">
              <SavedNote state={notesStatus}>Staff only — never shown to students, never printed, and only visible here.</SavedNote>
              {!readOnly && <SaveButton dirty={notesDirty} state={notesStatus} onClick={saveNotes} label="Save notes" />}
            </div>
          </div>

          {/* Files */}
          <div>
            <SectionLabel>PDFs</SectionLabel>
            <PdfList row={row} patch={patch} onErr={setErr} readOnly={readOnly} />
            {!readOnly && (
              <p className="text-[10px] text-[#2A2035]/40 mt-2">
                These are what the class opens from the booklet card. Uploads and removals save immediately.
              </p>
            )}
          </div>

          {/* Improvement checklists */}
          <div>
            <SectionLabel>Improvement checklist</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {['fixes', 'suggestions'].map(list => (
                <ChecklistColumn
                  key={list}
                  list={list}
                  items={row[list] || []}
                  bookletId={row.id}
                  staff={staff}
                  busy={busy}
                  setBusy={setBusy}
                  onList={(next) => patch({ [list]: next })}
                  onErr={setErr}
                  readOnly={readOnly}
                />
              ))}
            </div>
            <p className="text-[10px] text-[#2A2035]/40 mt-2">
              {readOnly
                ? 'Add items from your lesson page — the directors tick them off here once dealt with.'
                : 'Tutors add items from their lesson page; tick them off here once dealt with. Ticked items stay, struck through.'}
            </p>
          </div>

          {err && <p className="text-[11px] text-red-500 font-semibold">{err}</p>}
        </div>
      </div>
    </div>
  )
}

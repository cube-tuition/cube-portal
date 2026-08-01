'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import BookletContentView from './BookletContentView'
import {
  fmtItemDate, sortItems, openCount,
  addStaffItem, setItemDone, removeItem,
} from '../../lib/bookletChecklist'

/*
 * BookletInfoModal — everything about one booklet in a single large modal,
 * shared by the curriculum view and the master database so both read the same.
 *
 * Replaces the separate Content / Notes / Checklist modals: one Info button per
 * card opens this, with sections for the booklet's details (status editable in
 * place), its content, the staff notes, and the Fixes / Suggestions checklists.
 *
 * Fully interactive, but every write touches ONLY its own column (status, notes,
 * or a checklist RPC), so it is safe to open from a partial row — the modal
 * re-reads the full booklets row on open anyway, both to fill any missing fields
 * and to pick up entries tutors have added since the page loaded.
 *
 * Props: booklet (row with at least { id }) — null closes; title (heading);
 *        staff (for the "done by" stamp); content (optional override for the
 *        Content section — the master DB passes build-derived Chemistry content);
 *        onClose(); onChanged(patch) — partial booklet fields after any write.
 */

const WORKBOOK_STATUSES = ['Not Started', 'In Progress', 'Needs Improvement', 'Complete']
const STATUS_SELECT_CLS = {
  'Complete':          'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Needs Improvement': 'bg-amber-100 text-amber-800 border-amber-200',
  'In Progress':       'bg-blue-100 text-blue-800 border-blue-200',
  'Not Started':       'bg-gray-100 text-gray-500 border-gray-200',
}

const LIST_META = {
  fixes:       { label: 'Fixes',       blurb: 'Errors to correct', addHint: 'Something to correct…' },
  suggestions: { label: 'Suggestions', blurb: 'Ideas for improvement', addHint: 'Something that would make it better…' },
}

function SectionLabel({ children }) {
  return <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#325099]/60 mb-2">{children}</p>
}

function MetaChip({ label, value }) {
  if (value == null || value === '') return null
  return (
    <span className="inline-flex items-baseline gap-1.5 bg-[#F0F4FF] rounded-lg px-2.5 py-1">
      <span className="text-[9px] tracking-widest uppercase font-bold text-[#325099]/50">{label}</span>
      <span className="text-[11px] font-semibold text-[#062E63]">{value}</span>
    </span>
  )
}

// One checklist (fixes OR suggestions): tick, staff-delete, add. Mirrors the
// rules the lesson page and SQL enforce — lesson items tick but never delete.
function ChecklistColumn({ list, items, bookletId, staff, busy, setBusy, onList, onErr }) {
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
              disabled={busy === it.id}
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
            {it.source === 'staff' && (
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

      <div className="px-3.5 pb-3 flex items-end gap-1.5">
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
      </div>
    </div>
  )
}

export default function BookletInfoModal({ booklet, title, staff, content, onClose, onChanged }) {
  const [row, setRow] = useState(null)          // full booklets row, re-read on open
  const [notes, setNotes] = useState('')
  const [notesStatus, setNotesStatus] = useState('idle')   // idle | saving | saved | error
  const [busy, setBusy] = useState(null)        // checklist item id / add key being written
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!booklet) return undefined
    let cancelled = false
    setErr(''); setNotesStatus('idle')
    setRow(booklet)                                    // show what we have immediately
    setNotes(booklet.notes || '')
    supabase.from('booklets').select('*').eq('id', booklet.id).single()
      .then(({ data }) => {
        if (cancelled || !data) return
        setRow(data)
        setNotes(data.notes || '')
      })
    return () => { cancelled = true }
  }, [booklet])

  if (!booklet || !row) return null

  const patch = (p) => { setRow(r => ({ ...r, ...p })); onChanged?.(p) }

  const saveStatus = async (status) => {
    const prev = row.status
    patch({ status })
    const { error } = await supabase.from('booklets').update({ status }).eq('id', row.id)
    if (error) { patch({ status: prev }); setErr('Could not save status: ' + error.message) }
  }

  const saveNotes = async () => {
    setNotesStatus('saving'); setErr('')
    const value = notes.trim() || null
    const { error } = await supabase.from('booklets').update({ notes: value }).eq('id', row.id)
    if (error) { setNotesStatus('error'); setErr('Could not save notes: ' + error.message); return }
    patch({ notes: value })
    setNotesStatus('saved')
  }

  const notesDirty = (notes.trim() || null) !== (row.notes || null)
  const contentText = (content ?? row.content) || ''
  const termWeek = [row.term_number ? `T${row.term_number}` : null, row.week ? `Wk ${row.week}` : null]
    .filter(Boolean).join(' · ')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy && notesStatus !== 'saving') onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        {/* Header: name, status (editable), meta chips */}
        <div className="px-6 py-4 border-b border-[#F0F4FF]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Booklet info</p>
              <h2 className="text-base font-bold text-[#062E63] truncate">{title || row.booklet_name}</h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={row.status || 'Not Started'}
                onChange={e => saveStatus(e.target.value)}
                className={`text-[10px] font-semibold rounded-full px-2 py-1 border cursor-pointer focus:outline-none transition ${
                  STATUS_SELECT_CLS[row.status || 'Not Started']}`}
              >
                {WORKBOOK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <MetaChip label="Year" value={row.year} />
            <MetaChip label="Subject" value={row.subject} />
            <MetaChip label="Topic" value={row.topic} />
            <MetaChip label="Skill" value={row.skill} />
            <MetaChip label="Scheduled" value={termWeek} />
            {row.is_exam && <MetaChip label="Type" value="Exam" />}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {/* Content */}
          <div>
            <SectionLabel>Content</SectionLabel>
            {contentText.trim() ? (
              <div className="max-h-52 overflow-y-auto rounded-xl border border-[#EEF2FB] bg-[#FBFCFF] px-4 py-3">
                <BookletContentView text={contentText} />
              </div>
            ) : (
              <p className="text-[12px] text-[#2A2035]/35">No content listed for this booklet yet.</p>
            )}
          </div>

          {/* Notes */}
          <div>
            <SectionLabel>Notes</SectionLabel>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setNotesStatus('idle') }}
              rows={4}
              placeholder="Notes about this booklet — what to emphasise, what to skip, how it went, anything the next tutor should know…"
              className="w-full px-3 py-2.5 rounded-xl border border-[#E8EDF8] bg-[#F8FAFF] text-[13px] text-[#2A2035] leading-relaxed placeholder:text-[#2A2035]/25 focus:outline-none focus:border-[#325099] focus:bg-white transition resize-y"
            />
            <div className="flex items-center justify-between gap-3 mt-1.5">
              <p className="text-[10px] text-[#2A2035]/40">
                {notesStatus === 'saved' ? <span className="text-[#065F46] font-semibold">✓ Saved.</span>
                  : 'Staff only — never shown to students and never printed.'}
              </p>
              <button
                onClick={saveNotes}
                disabled={!notesDirty || notesStatus === 'saving'}
                className="shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-bold text-white bg-[#325099] hover:bg-[#062E63] transition disabled:opacity-40 disabled:hover:bg-[#325099]"
              >{notesStatus === 'saving' ? 'Saving…' : 'Save notes'}</button>
            </div>
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
                />
              ))}
            </div>
            <p className="text-[10px] text-[#2A2035]/40 mt-2">
              Tutors add items from their lesson page; tick them off here once dealt with. Ticked items stay, struck through.
            </p>
          </div>

          {err && <p className="text-[11px] text-red-500 font-semibold">{err}</p>}
        </div>
      </div>
    </div>
  )
}

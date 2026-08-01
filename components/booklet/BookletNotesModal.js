'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

/*
 * BookletNotesModal — read and edit a booklet's staff notes on their own.
 *
 * The notes column already existed, but the only way to reach it was the full
 * Add/Edit Booklet modal, and the curriculum cards clipped it to a single line —
 * so a note longer than a few words was effectively write-only. This gives notes
 * a surface of their own: open from any booklet card, read the whole thing, edit
 * and save without touching the booklet's other fields.
 *
 * Saves ONLY the notes column, so it is safe to open on a partial booklets row
 * (the class-tab cards join a handful of columns, not the full row).
 *
 * Notes are staff-only: they are never rendered to students and never reach the
 * exported PDF (lib/bookletRender only ever sees builder blocks, not this row).
 *
 * Props: booklet (row with { id, notes }) — null closes; title (display heading);
 *        onClose(); onSaved(notes) — fired after a successful write.
 */
export default function BookletNotesModal({ booklet, title, onClose, onSaved }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Re-seed whenever a different booklet is opened.
  useEffect(() => {
    setText(booklet?.notes || '')
    setErr('')
  }, [booklet])

  if (!booklet) return null

  const original = booklet.notes || ''
  const dirty = text !== original

  const save = async () => {
    setSaving(true); setErr('')
    const value = text.trim() || null
    const { error } = await supabase.from('booklets').update({ notes: value }).eq('id', booklet.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved?.(value)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div className="min-w-0">
            <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Booklet notes</p>
            <h2 className="text-sm font-bold text-[#062E63] truncate">{title || booklet.booklet_name}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg shrink-0"
          >×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={12}
            autoFocus
            placeholder="Notes about this booklet — what to emphasise, what to skip, how it went, anything the next tutor should know…"
            className="w-full px-3 py-2.5 rounded-xl border border-[#E8EDF8] bg-[#F8FAFF] text-[13px] text-[#2A2035] leading-relaxed placeholder:text-[#2A2035]/25 focus:outline-none focus:border-[#325099] focus:bg-white transition"
          />
          <p className="text-[10px] text-[#2A2035]/40 mt-2">
            Staff only — notes are never shown to students and never appear in the exported PDF.
          </p>
          {err && <p className="text-[11px] text-red-500 font-semibold mt-2">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#F0F4FF]">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[#2A2035]/50 hover:bg-[#F0F4FF] transition disabled:opacity-40"
          >Cancel</button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#325099] hover:bg-[#062E63] transition disabled:opacity-40 disabled:hover:bg-[#325099]"
          >{saving ? 'Saving…' : 'Save notes'}</button>
        </div>
      </div>
    </div>
  )
}

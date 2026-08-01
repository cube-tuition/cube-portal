'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  LISTS, fmtItemDate, sortItems, openCount,
  addStaffItem, setItemDone, removeItem,
} from '../../lib/bookletChecklist'

/*
 * BookletChecklistModal — the Fixes / Suggestions checklists for one booklet.
 *
 * Entries arrive from tutors on the lesson page (tagged with the class, date and
 * tutor) or are typed straight in here by staff. Ticking keeps the item on the
 * list, struck through and stamped with who closed it, so a booklet carries the
 * record of what was raised and what was dealt with.
 *
 * Only staff-authored items can be deleted — a tutor's report can be ticked off
 * but not removed out from under them.
 *
 * Props: booklet (row with { id, booklet_name, fixes, suggestions }) — null
 *        closes; title (heading); staff (for the "ticked by" stamp);
 *        onClose(); onChanged(lists) after every mutation.
 */
export default function BookletChecklistModal({ booklet, title, staff, onClose, onChanged }) {
  const [lists, setLists] = useState({ fixes: [], suggestions: [] })
  const [tab, setTab] = useState('fixes')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(null)      // item id (or 'add') being written
  const [err, setErr] = useState('')

  // Re-read on open: the card that launched this may hold a stale copy, and a
  // tutor may have reported something since the page loaded.
  useEffect(() => {
    if (!booklet) return undefined
    let cancelled = false
    setErr(''); setDraft(''); setTab('fixes')
    setLists({ fixes: booklet.fixes || [], suggestions: booklet.suggestions || [] })
    supabase.from('booklets').select('fixes, suggestions').eq('id', booklet.id).single()
      .then(({ data }) => {
        if (cancelled || !data) return
        setLists({ fixes: data.fixes || [], suggestions: data.suggestions || [] })
      })
    return () => { cancelled = true }
  }, [booklet])

  if (!booklet) return null

  const apply = async (list, fn, key) => {
    setBusy(key); setErr('')
    try {
      const next = await fn()
      const merged = { ...lists, [list]: next }
      setLists(merged)
      onChanged?.(merged)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  const toggle = (list, item) => apply(list, () => setItemDone({
    bookletId: booklet.id, list, itemId: item.id, done: !item.done, by: staff?.full_name,
  }), item.id)

  // No lessonId here: on the booklet screen staff may remove staff-authored
  // items only — a tutor's report can be ticked off but not deleted.
  const remove = (list, item) => apply(list, () => removeItem({
    bookletId: booklet.id, list, itemId: item.id,
  }), item.id)

  const add = () => {
    const text = draft.trim()
    if (!text) return
    apply(tab, async () => {
      const next = await addStaffItem({ bookletId: booklet.id, list: tab, text, author: staff?.full_name })
      setDraft('')
      return next
    }, 'add')
  }

  const items = sortItems(lists[tab])
  const open = openCount(lists[tab])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div className="min-w-0">
            <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Improvement checklist</p>
            <h2 className="text-sm font-bold text-[#062E63] truncate">{title || booklet.booklet_name}</h2>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg shrink-0">×</button>
        </div>

        {/* Which list */}
        <div className="px-6 pt-4 flex gap-2">
          {LISTS.map(l => {
            const n = openCount(lists[l.key])
            const on = tab === l.key
            return (
              <button key={l.key} onClick={() => { setTab(l.key); setDraft('') }}
                className={`text-xs font-semibold px-3.5 py-1.5 rounded-full transition ${
                  on ? 'bg-[#325099] text-white' : 'bg-[#F0F4FF] text-[#325099] hover:bg-[#DEE7FF]'}`}>
                {l.label}
                {n > 0 && (
                  <span className={`ml-1.5 text-[10px] font-bold ${on ? 'text-white/80' : 'text-[#325099]/60'}`}>{n}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {items.length === 0 ? (
            <p className="text-[12px] text-[#2A2035]/40 text-center py-8">
              Nothing on this list yet. Tutors add items from the lesson page, or type one below.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map(it => (
                <li key={it.id}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                    it.done ? 'border-[#EEF1F6] bg-[#FAFBFD]' : 'border-[#E8EDF8] bg-white'}`}>
                  <button
                    onClick={() => toggle(tab, it)}
                    disabled={busy === it.id}
                    title={it.done ? 'Mark as not done' : 'Mark as done'}
                    className={`mt-0.5 w-4 h-4 rounded shrink-0 border flex items-center justify-center text-[10px] leading-none transition disabled:opacity-40 ${
                      it.done ? 'bg-[#065F46] border-[#065F46] text-white' : 'border-[#C7D0E0] hover:border-[#325099]'}`}
                  >{it.done ? '✓' : ''}</button>

                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] leading-snug whitespace-pre-line ${
                      it.done ? 'text-[#2A2035]/40 line-through' : 'text-[#2A2035]'}`}>{it.text}</p>
                    <p className="text-[10px] text-[#2A2035]/40 mt-1">
                      {[fmtItemDate(it.date), it.class_name, it.author].filter(Boolean).join(' · ')}
                      {it.source === 'staff' && <span className="ml-1 text-[#325099]/50">· added here</span>}
                      {it.done && it.done_by && <span className="ml-1 text-[#065F46]/70">· done by {it.done_by}</span>}
                    </p>
                  </div>

                  {it.source === 'staff' && (
                    <button onClick={() => remove(tab, it)} disabled={busy === it.id}
                      title="Delete this item"
                      className="shrink-0 text-[10px] font-semibold text-[#2A2035]/25 hover:text-[#DC2626] transition disabled:opacity-40">
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {err && <p className="text-[11px] text-red-500 font-semibold mt-3">{err}</p>}
        </div>

        {/* Add straight onto the booklet */}
        <div className="px-6 py-4 border-t border-[#F0F4FF] flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">
              Add a {tab === 'fixes' ? 'fix' : 'suggestion'}
            </label>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={2}
              placeholder={tab === 'fixes' ? 'Something to correct…' : 'Something that would make it better…'}
              className="w-full px-3 py-2 rounded-xl border border-[#E8EDF8] bg-[#F8FAFF] text-[13px] text-[#2A2035] leading-relaxed placeholder:text-[#2A2035]/25 focus:outline-none focus:border-[#325099] focus:bg-white transition resize-y"
            />
          </div>
          <button
            onClick={add}
            disabled={!draft.trim() || busy === 'add'}
            className="shrink-0 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#325099] hover:bg-[#062E63] transition disabled:opacity-40 disabled:hover:bg-[#325099]"
          >{busy === 'add' ? 'Adding…' : 'Add'}</button>
        </div>

        <div className="px-6 pb-4 -mt-1">
          <p className="text-[10px] text-[#2A2035]/40">
            {open === 0 ? 'Nothing open on this list.' : `${open} open item${open === 1 ? '' : 's'}.`}
            {' '}Staff only — never shown to students or printed.
          </p>
        </div>
      </div>
    </div>
  )
}

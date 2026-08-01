'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addLessonItem, removeItem, itemsForLesson, fmtItemDate } from '../lib/bookletChecklist'

/*
 * <WorkbookFeedback booklet={...} classId={...} dateISO="YYYY-MM-DD" ... />
 *
 * Sits under the booklet panel on a lesson, and only when a curriculum booklet
 * is assigned to that week — feedback with nowhere to go is worse than no box at
 * all, so the parent renders this only when it has a booklets row.
 *
 * Two independent sections, Errors and Suggestions, each with its own Submit.
 * Every submit adds ONE item to that booklet's checklist and clears the box, so
 * a tutor who has found three problems sends three separate items that staff can
 * tick off one by one. What this lesson has sent is listed underneath, and a
 * tutor can withdraw one of their own while it is still open; once staff have
 * ticked it, it is locked (SQL enforces both rules, not this component).
 *
 * Saving is independent of the session-marking save button below it: a tutor can
 * report a typo without marking the roll, and a half-marked session never loses
 * the feedback.
 */

const SECTIONS = [
  { list: 'fixes', label: 'Workbook Errors', noun: 'error',
    hint: 'Typos, wrong answers, unclear questions — where exactly?' },
  { list: 'suggestions', label: 'Suggestions for Improvement', noun: 'suggestion',
    hint: 'Too easy / too long, a question worth adding, a better order…' },
]

export default function WorkbookFeedback({ booklet, classId, dateISO, className, staff, readOnly }) {
  const [drafts, setDrafts] = useState({ fixes: '', suggestions: '' })
  const [lists, setLists] = useState({ fixes: [], suggestions: [] })
  const [lessonId, setLessonId] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(null)      // list key or item id being written
  const [err, setErr] = useState('')

  const editable = !readOnly && !!staff

  useEffect(() => {
    if (!classId || !dateISO || !booklet?.id) return undefined
    let cancelled = false
    setLoaded(false)
    Promise.all([
      supabase.from('lessons').select('id')
        .eq('class_id', Number(classId)).eq('lesson_date', dateISO).eq('is_makeup', false)
        .maybeSingle(),
      supabase.from('booklets').select('fixes, suggestions').eq('id', booklet.id).single(),
    ]).then(([lesson, bk]) => {
      if (cancelled) return
      setLessonId(lesson.data?.id ?? null)
      setLists({ fixes: bk.data?.fixes || [], suggestions: bk.data?.suggestions || [] })
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [classId, dateISO, booklet?.id])

  // The checklist entries are keyed by lesson, so the row has to exist before the
  // first submit. Same minimal shape SessionMarker creates.
  //
  // lessons has a unique index on (class_id, lesson_date) where is_makeup=false,
  // so a row created between our read and this insert collides rather than
  // duplicating. Recover by reading the winner instead of surfacing a raw
  // duplicate-key error to the tutor.
  const ensureLesson = useCallback(async () => {
    if (lessonId) return lessonId
    const findExisting = async () => {
      const { data } = await supabase.from('lessons').select('id')
        .eq('class_id', Number(classId)).eq('lesson_date', dateISO).eq('is_makeup', false)
        .maybeSingle()
      return data?.id ?? null
    }
    const { data, error } = await supabase.from('lessons').insert({
      class_id: Number(classId), lesson_date: dateISO, is_makeup: false, status: 'scheduled',
    }).select('id').single()
    if (error) {
      const existing = await findExisting()
      if (!existing) throw error
      setLessonId(existing)
      return existing
    }
    setLessonId(data.id)
    return data.id
  }, [lessonId, classId, dateISO])

  const submit = async (list) => {
    const text = drafts[list].trim()
    if (!text) return
    setBusy(list); setErr('')
    try {
      const id = await ensureLesson()
      const next = await addLessonItem({
        bookletId: booklet.id, list, lessonId: id, text,
        className, date: dateISO, author: staff?.full_name,
      })
      setLists(l => ({ ...l, [list]: next }))
      setDrafts(d => ({ ...d, [list]: '' }))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  const withdraw = async (list, item) => {
    setBusy(item.id); setErr('')
    try {
      const next = await removeItem({ bookletId: booklet.id, list, itemId: item.id, lessonId })
      setLists(l => ({ ...l, [list]: next }))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden mt-4">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
            Improving this workbook
          </p>
          <p className="text-[11px] text-[#2A2035]/50">
            Each one you send becomes its own item on <span className="font-semibold text-[#2A2035]/70">{booklet.booklet_name}</span>’s
            checklist, for staff to tick off once it’s done.
          </p>
        </div>
        <span className={`shrink-0 text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full ${
          editable ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#F4F4F4] text-[#9CA3AF]'
        }`}>
          {editable ? '✎ Editable' : '🔒 Read only'}
        </span>
      </div>

      <div className="px-5 pb-5 space-y-5">
        {SECTIONS.map(sec => {
          const mine = itemsForLesson(lists[sec.list], lessonId)
          return (
            <div key={sec.list}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <label className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/80 font-semibold">
                  {sec.label}
                </label>
                <span className="text-[10px] text-[#2A2035]/40 shrink-0">
                  One {sec.noun} per submit — send them one at a time
                </span>
              </div>

              <textarea
                value={drafts[sec.list]}
                onChange={editable ? e => setDrafts(d => ({ ...d, [sec.list]: e.target.value })) : undefined}
                readOnly={!editable}
                placeholder={editable ? sec.hint : '—'}
                rows={2}
                className={`w-full rounded-xl border px-3 py-2 text-sm leading-relaxed resize-y transition focus:outline-none ${
                  editable
                    ? 'bg-[#F8FAFF] border-[#DEE7FF] text-[#2A2035] placeholder:text-[#2A2035]/30 focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099]'
                    : 'bg-[#F4F4F4] border-[#E5E7EB] text-[#2A2035]/70 cursor-not-allowed'
                }`}
              />

              {editable && (
                <div className="flex justify-end mt-1.5">
                  <button
                    type="button"
                    onClick={() => submit(sec.list)}
                    disabled={!loaded || !drafts[sec.list].trim() || busy === sec.list}
                    className="text-xs font-semibold px-4 py-1.5 rounded-full transition bg-[#325099] text-white hover:bg-[#062E63] disabled:opacity-40 disabled:hover:bg-[#325099]"
                  >
                    {busy === sec.list ? 'Sending…' : `Submit ${sec.noun}`}
                  </button>
                </div>
              )}

              {/* What this lesson has already sent */}
              {mine.length > 0 && (
                <div className="mt-2 rounded-xl bg-[#F8FAFF] border border-[#EEF2FB] px-3 py-2">
                  <p className="text-[9px] tracking-[0.2em] uppercase text-[#325099]/50 font-semibold mb-1.5">
                    Sent from this lesson
                  </p>
                  <ul className="space-y-1.5">
                    {mine.map(it => (
                      <li key={it.id} className="flex items-start gap-2">
                        <span className={`mt-[3px] text-[10px] shrink-0 ${it.done ? 'text-[#065F46]' : 'text-[#325099]/40'}`}>
                          {it.done ? '✓' : '•'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[12px] leading-snug whitespace-pre-line ${
                            it.done ? 'text-[#2A2035]/40 line-through' : 'text-[#2A2035]/80'}`}>{it.text}</p>
                          {it.done && (
                            <p className="text-[10px] text-[#065F46]/70">
                              Fixed{it.done_by ? ` by ${it.done_by}` : ''}{it.done_at ? ` · ${fmtItemDate(it.done_at)}` : ''}
                            </p>
                          )}
                        </div>
                        {editable && !it.done && (
                          <button
                            type="button"
                            onClick={() => withdraw(sec.list, it)}
                            disabled={busy === it.id}
                            title="Withdraw this item"
                            className="shrink-0 text-[10px] font-semibold text-[#2A2035]/25 hover:text-[#DC2626] transition disabled:opacity-40"
                          >{busy === it.id ? '…' : 'Withdraw'}</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        })}

        {err && <p className="text-[11px] text-red-500 font-semibold">{err}</p>}
      </div>
    </div>
  )
}

'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { getAuthProfile } from '../lib/getProfile'
import { loadPrep, groupPrep, prepWindow, dayLabel, fmt12 } from '../lib/classPrep'

/*
 * Class prep — the Action Centre's full-width card. Every lesson from today to
 * six days ahead, under its materials owner (Operations → Materials). Prep is
 * automatic — a booklet allocated to the class for that week on the curriculum
 * page — and Print is the one tick (lesson_prep.printed_at). A lesson drops off once its day has passed. lib/classPrep has
 * the rules; the morning job nudges the owner about tomorrow's unticked ones.
 */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
// Prep, read from the curriculum: the week's booklet allocated (and published).
const PREP = {
  ready:       { mark: '✓', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', tip: 'Prepared — this week’s booklet is allocated and published' },
  unpublished: { mark: '✓', cls: 'bg-amber-50 text-amber-700 border-amber-300', tip: 'Prepared — a booklet is allocated, but its PDFs aren’t published yet' },
  none:        { mark: '', cls: 'bg-white border-[#C7D5F8]', tip: 'Not prepared — no booklet allocated to this class for this week (Curriculum page)' },
}

export default function ClassPrepCard() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [me, setMe] = useState(null)
  const [saving, setSaving] = useState(null)
  const day = today()

  const load = useCallback(async () => {
    try {
      const [from, to] = prepWindow(today())
      setRows(await loadPrep(supabase, from, to)); setError('')
    } catch (e) { setError(e.message || 'Could not load the lessons'); setRows([]) }
  }, [])
  useEffect(() => {
    const t = setTimeout(load, 0)
    getAuthProfile().then(({ user, profile }) => setMe({ id: user?.id, name: profile?.full_name || '' })).catch(() => {})
    return () => clearTimeout(t)
  }, [load])

  // The one manual tick: printed. Unticking removes the row.
  const togglePrinted = async (r) => {
    setSaving(r.lessonId)
    const printed = r.printed ? null : { by: (me?.name || '').split(' ')[0], at: new Date().toISOString() }
    setRows(list => list.map(x => (x.lessonId === r.lessonId ? { ...x, printed } : x)))
    const { error: e } = printed
      ? await supabase.from('lesson_prep').upsert({ lesson_id: r.lessonId, prepared_by: me?.id || null, printed_at: printed.at, printed_by_name: printed.by })
      : await supabase.from('lesson_prep').delete().eq('lesson_id', r.lessonId)
    if (e) { setError(`Could not save: ${e.message}`); load() }
    setSaving(null)
  }

  const groups = useMemo(() => groupPrep(rows || []), [rows])
  const total = rows?.length || 0
  const done = (rows || []).filter(r => r.allocated).length
  const printed = (rows || []).filter(r => r.printed).length
  const ready = (r) => r.allocated && r.printed
  const cols = ['Ryan', 'Aiden', ...(groups.Unassigned.length ? ['Unassigned'] : [])]

  return (
    <div className="mt-4 bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFF] border-b border-[#F0F4FF]">
        <p className="text-xs font-bold text-[#062E63]">📚 Class prep <span className="font-normal text-[#2A2035]/45">— the next 7 days</span></p>
        {rows && total > 0 && (
          <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${done === total && printed === total ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
            {done === total && printed === total ? '✓ all prepared and printed' : `${done}/${total} prepared · ${printed}/${total} printed`}
          </span>
        )}
      </div>
      {error && <p className="px-4 py-2 text-xs text-rose-700 bg-rose-50 border-b border-rose-100">{error}</p>}
      {rows === null ? (
        <p className="px-4 py-8 text-center text-xs text-[#2A2035]/40 animate-pulse">Checking…</p>
      ) : total === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-[#2A2035]/40">No lessons in the next 7 days.</p>
      ) : (
        <div className={`grid gap-px bg-[#F0F4FF] ${cols.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          {cols.map(owner => {
            const list = groups[owner]
            const left = list.filter(r => !ready(r)).length
            return (
              <div key={owner} className="bg-white min-w-0">
                <p className="px-4 pt-3 pb-1 text-[11px] font-bold text-[#062E63] uppercase tracking-wider">
                  {owner} <span className="normal-case tracking-normal font-semibold text-[#2A2035]/40">· {left ? `${left} to go` : list.length ? 'all done' : 'nothing on'}</span>
                </p>
                {list.length > 0 && (
                  <p className="px-4 pb-0.5 flex gap-2.5 text-[9px] font-bold uppercase tracking-wider text-[#2A2035]/35">
                    <span className="w-4 text-center" title="Prepared: a booklet is allocated for the week — automatic">Prep</span><span className="w-4 text-center" title="Printed — tick when the copies are printed">Print</span>
                  </p>
                )}
                <div className="max-h-80 overflow-y-auto pb-2">
                  {list.map((r, i) => (
                    <div key={r.lessonId}>
                      {(i === 0 || list[i - 1].date !== r.date) && (
                        <p className={`px-4 pt-2 pb-0.5 text-[10px] font-semibold ${r.date === day ? 'text-[#B23A3A]' : 'text-[#2A2035]/40'}`}>{dayLabel(r.date, day)}</p>
                      )}
                      <div className={`flex items-center gap-2.5 px-4 py-1.5 hover:bg-[#F8FAFF] ${ready(r) ? 'opacity-50' : ''}`}>
                        <span title={PREP[r.booklet].tip} aria-label={PREP[r.booklet].tip}
                          className={`w-4 h-4 shrink-0 rounded border text-[10px] font-bold leading-none flex items-center justify-center ${PREP[r.booklet].cls}`}>{PREP[r.booklet].mark}</span>
                        <input type="checkbox" checked={!!r.printed} disabled={saving === r.lessonId} onChange={() => togglePrinted(r)}
                          title={r.printed ? `Printed${r.printed.by ? ` — ticked by ${r.printed.by}` : ''}` : 'Printed: tick when the copies are printed'}
                          className="accent-[#325099] w-4 h-4 shrink-0 cursor-pointer" />
                        <span className="flex-1 min-w-0">
                          <Link href={`/tutor/classes/${r.classId}/${r.date}`}
                            className={`block text-xs font-semibold text-[#2A2035] truncate hover:underline ${ready(r) ? 'line-through' : ''}`}>{r.label}</Link>
                          <span className="block text-[10.5px] text-[#2A2035]/45">
                            {fmt12(r.start)}
                            {r.booklet === 'none' && <span className="text-[#B23A3A]/70"> · no booklet allocated</span>}
                            {r.booklet === 'unpublished' && <span className="text-amber-700"> · booklet not published</span>}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                  {!list.length && <p className="px-4 py-3 text-[11px] text-[#2A2035]/35">No lessons in the next 7 days.</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

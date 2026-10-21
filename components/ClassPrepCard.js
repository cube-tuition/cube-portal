'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { getAuthProfile } from '../lib/getProfile'
import { loadPrep, groupPrep, prepWindow, dayLabel, fmt12 } from '../lib/classPrep'

/*
 * Class prep — the Action Centre's full-width card. Every lesson from today to
 * six days ahead, under its materials owner (Operations → Materials), with the
 * week's booklet status from the curriculum and a tick for "prepared"
 * (lesson_prep). A lesson drops off once its day has passed. lib/classPrep has
 * the rules; the morning job nudges the owner about tomorrow's unticked ones.
 */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
const BOOKLET = {
  ready:       { text: 'Booklet ✓', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', tip: 'This week’s booklet is assigned and published' },
  unpublished: { text: 'Not published', cls: 'text-amber-700 bg-amber-50 border-amber-200', tip: 'A booklet is assigned for this week but its PDFs aren’t published' },
  none:        { text: 'No booklet', cls: 'text-[#2A2035]/45 bg-[#F8FAFF] border-[#E4EAFB]', tip: 'No booklet is assigned to this class for this week' },
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

  const toggle = async (r) => {
    setSaving(r.lessonId)
    const prepared = r.prepared ? null : { by: (me?.name || '').split(' ')[0], at: new Date().toISOString() }
    setRows(list => list.map(x => (x.lessonId === r.lessonId ? { ...x, prepared } : x)))
    const { error: e } = prepared
      ? await supabase.from('lesson_prep').upsert({ lesson_id: r.lessonId, prepared_by: me?.id || null, prepared_by_name: prepared.by, prepared_at: prepared.at })
      : await supabase.from('lesson_prep').delete().eq('lesson_id', r.lessonId)
    if (e) { setError(`Could not save: ${e.message}`); load() }
    setSaving(null)
  }

  const groups = useMemo(() => groupPrep(rows || []), [rows])
  const total = rows?.length || 0
  const done = (rows || []).filter(r => r.prepared).length
  const cols = ['Ryan', 'Aiden', ...(groups.Unassigned.length ? ['Unassigned'] : [])]

  return (
    <div className="mt-4 bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFF] border-b border-[#F0F4FF]">
        <p className="text-xs font-bold text-[#062E63]">📚 Class prep <span className="font-normal text-[#2A2035]/45">— the next 7 days</span></p>
        {rows && total > 0 && (
          <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${done === total ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
            {done === total ? '✓ all prepared' : `${done} of ${total} prepared`}
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
            const left = list.filter(r => !r.prepared).length
            return (
              <div key={owner} className="bg-white min-w-0">
                <p className="px-4 pt-3 pb-1 text-[11px] font-bold text-[#062E63] uppercase tracking-wider">
                  {owner} <span className="normal-case tracking-normal font-semibold text-[#2A2035]/40">· {left ? `${left} to prepare` : list.length ? 'all done' : 'nothing on'}</span>
                </p>
                <div className="max-h-80 overflow-y-auto pb-2">
                  {list.map((r, i) => (
                    <div key={r.lessonId}>
                      {(i === 0 || list[i - 1].date !== r.date) && (
                        <p className={`px-4 pt-2 pb-0.5 text-[10px] font-semibold ${r.date === day ? 'text-[#B23A3A]' : 'text-[#2A2035]/40'}`}>{dayLabel(r.date, day)}</p>
                      )}
                      <label className={`flex items-center gap-2.5 px-4 py-1.5 cursor-pointer hover:bg-[#F8FAFF] ${r.prepared ? 'opacity-50' : ''}`}
                        title={r.prepared ? `Prepared${r.prepared.by ? ` — ticked by ${r.prepared.by}` : ''}` : 'Tick when the materials are ready'}>
                        <input type="checkbox" checked={!!r.prepared} disabled={saving === r.lessonId} onChange={() => toggle(r)}
                          className="accent-[#15803D] w-4 h-4 shrink-0 cursor-pointer" />
                        <span className="flex-1 min-w-0">
                          <Link href={`/tutor/classes/${r.classId}/${r.date}`} onClick={e => e.stopPropagation()}
                            className={`block text-xs font-semibold text-[#2A2035] truncate hover:underline ${r.prepared ? 'line-through' : ''}`}>{r.label}</Link>
                          <span className="block text-[10.5px] text-[#2A2035]/45">{fmt12(r.start)}</span>
                        </span>
                        {r.booklet && (
                          <span title={BOOKLET[r.booklet].tip} className={`shrink-0 text-[9.5px] font-semibold border rounded-full px-1.5 py-0.5 ${BOOKLET[r.booklet].cls}`}>{BOOKLET[r.booklet].text}</span>
                        )}
                      </label>
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

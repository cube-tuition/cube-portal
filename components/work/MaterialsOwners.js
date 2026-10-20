'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { classesForTerm } from '../../lib/classes'
import { fetchAllTerms, getCurrentTerm } from '../../lib/terms'

/*
 * Materials — which director (Ryan or Aiden) prepares the materials for each
 * class this term (classes.materials_owner). Classes are per-term rows; the
 * transition wizard copies the owner into the next term with the class.
 */
const OWNERS = ['Ryan', 'Aiden']
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const fmt12 = (t) => {
  const [h, m] = String(t || '').split(':').map(Number)
  return Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` : ''
}

export default function MaterialsOwners() {
  const [term, setTerm] = useState(null)
  const [classes, setClasses] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')   // 'all' | 'Ryan' | 'Aiden' | 'none'

  useEffect(() => {
    let live = true
    ;(async () => {
      const t = getCurrentTerm(await fetchAllTerms())
      if (!live) return
      setTerm(t)
      if (!t) { setClasses([]); return }
      const { data, error: e } = await classesForTerm(t.id, 'id, class_name, day_of_week, start_time, status, materials_owner')
      if (!live) return
      if (e) setError(`Classes failed to load: ${e.message}`)
      setClasses((data || []).filter(c => !c.status || c.status === 'active'))
    })()
    return () => { live = false }
  }, [])

  const sorted = useMemo(() => [...(classes || [])].sort((a, b) =>
    String(a.class_name).localeCompare(String(b.class_name), 'en', { numeric: true })
    || DAYS.indexOf(a.day_of_week) - DAYS.indexOf(b.day_of_week)
    || String(a.start_time).localeCompare(String(b.start_time))), [classes])
  const count = (o) => sorted.filter(c => (o === 'none' ? !c.materials_owner : c.materials_owner === o)).length
  const shown = sorted.filter(c => filter === 'all' || (filter === 'none' ? !c.materials_owner : c.materials_owner === filter))

  const setOwner = async (cls, owner) => {
    const next = cls.materials_owner === owner ? null : owner   // click again to clear
    setClasses(list => list.map(c => (c.id === cls.id ? { ...c, materials_owner: next } : c)))
    const { error: e } = await supabase.from('classes').update({ materials_owner: next }).eq('id', cls.id)
    if (e) {
      setError(`Could not save: ${e.message}`)
      setClasses(list => list.map(c => (c.id === cls.id ? { ...c, materials_owner: cls.materials_owner } : c)))
    }
  }

  const chip = (id, label) => (
    <button key={id} onClick={() => setFilter(id)}
      className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border transition ${filter === id ? 'bg-[#062E63] text-white border-[#062E63]' : 'border-[#DEE7FF] text-[#325099] hover:border-[#325099]'}`}>
      {label}
    </button>
  )

  return (
    <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-[#062E63]">📚 Materials</p>
          <p className="text-[11px] text-[#2A2035]/45 mt-0.5">Who prepares each class’s materials{term ? ` · ${term.name}` : ''} — carries into next term with the class</p>
        </div>
        {classes && classes.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {chip('all', `All · ${sorted.length}`)}
            {OWNERS.map(o => chip(o, `${o} · ${count(o)}`))}
            {chip('none', `Not assigned · ${count('none')}`)}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

      {classes === null ? (
        <p className="text-xs text-[#2A2035]/40 py-4 text-center animate-pulse">Loading classes…</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-[#2A2035]/40 py-4 text-center">{sorted.length ? 'No classes here.' : 'No classes this term.'}</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 divide-y divide-[#F0F4FF] sm:divide-y-0">
          {shown.map(c => (
            <div key={c.id} className="flex items-center gap-3 py-2 border-b border-[#F0F4FF] min-w-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#062E63] truncate">{c.class_name}</p>
                <p className="text-[11px] text-[#2A2035]/45">{[c.day_of_week && c.day_of_week.slice(0, 3), fmt12(c.start_time)].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex rounded-full border border-[#DEE7FF] overflow-hidden shrink-0">
                {OWNERS.map(o => (
                  <button key={o} onClick={() => setOwner(c, o)}
                    title={c.materials_owner === o ? `${o} prepares these — click to clear` : `${o} prepares these materials`}
                    className={`text-[11px] font-semibold px-2.5 py-1 transition ${c.materials_owner === o
                      ? (o === 'Ryan' ? 'bg-[#062E63] text-white' : 'bg-[#0E7C66] text-white')
                      : 'text-[#325099]/55 hover:bg-[#F0F4FF]'}`}>
                    {o}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

import { blankCriterion } from '../../lib/rubrics'

/*
 * RubricGridEditor — controlled editor for a rubric's bands (columns) + criteria
 * (rows). Used in the rubric library and inline (Custom) in the exam builder.
 *
 * Props: value = { bands:[{label,marks}], criteria:[{name,max,cells:[...]}] }
 *        onChange(next)   — receives the whole updated { bands, criteria }
 *        compact          — tighter sizing for the inline exam-builder use
 */
export default function RubricGridEditor({ value, onChange, compact = false }) {
  const bands = value?.bands || []
  const criteria = value?.criteria || []
  const set = (patch) => onChange({ ...value, ...patch })

  const setBand = (i, patch) => set({ bands: bands.map((b, j) => j === i ? { ...b, ...patch } : b) })
  const addBand = () => set({
    bands: [...bands, { label: String(bands.length), marks: String(bands.length) }],
    criteria: criteria.map(c => ({ ...c, cells: [...(c.cells || []), ''] })),
  })
  const removeBand = (i) => set({
    bands: bands.filter((_, j) => j !== i),
    criteria: criteria.map(c => ({ ...c, cells: (c.cells || []).filter((_, j) => j !== i) })),
  })

  const setCrit = (i, patch) => set({ criteria: criteria.map((c, j) => j === i ? { ...c, ...patch } : c) })
  const setCell = (ci, bi, val) => setCrit(ci, { cells: (criteria[ci].cells || []).map((c, j) => j === bi ? val : c) })
  const addCrit = () => set({ criteria: [...criteria, blankCriterion(bands.length)] })
  const removeCrit = (i) => set({ criteria: criteria.filter((_, j) => j !== i) })

  const inp = 'border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]'
  const minH = compact ? 'min-h-[48px]' : 'min-h-[60px]'
  const nameW = compact ? '160px' : '200px'
  const cellMin = compact ? 'minmax(120px,1fr)' : 'minmax(150px,1fr)'
  const cellCols = `${nameW} 56px ${bands.map(() => cellMin).join(' ')}`

  return (
    <div>
      {/* Bands */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Mark bands (columns)</p>
        <button onClick={addBand} className="text-[11px] font-semibold text-[#325099] hover:underline">＋ Add band</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {bands.map((b, i) => (
          <div key={i} className="flex items-center gap-1 border border-[#DEE7FF] rounded-lg px-2 py-1.5 bg-[#F8FAFF]">
            <input value={b.label} onChange={e => setBand(i, { label: e.target.value, marks: e.target.value })} className="w-14 text-center font-semibold text-[#2A2035] bg-white border border-[#DEE7FF] rounded px-1 py-1 text-sm focus:outline-none focus:border-[#325099]" placeholder="4" />
            {bands.length > 1 && <button onClick={() => removeBand(i)} className="text-rose-400 hover:text-rose-600 text-xs ml-0.5">✕</button>}
          </div>
        ))}
      </div>

      {/* Criteria grid */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Criteria (rows)</p>
        <button onClick={addCrit} className="text-[11px] font-semibold text-[#325099] hover:underline">＋ Add criterion</button>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-max">
          <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: cellCols }}>
            <div className="text-[11px] font-bold text-[#325099]">Criteria</div>
            <div className="text-[11px] font-bold text-[#325099] text-center">/ Max</div>
            {bands.map((b, i) => <div key={i} className="text-[11px] font-bold text-[#325099] text-center">{b.label || '—'}</div>)}
          </div>
          {criteria.length === 0 ? (
            <p className="text-xs text-[#2A2035]/40 italic py-2">No criteria yet — add one above.</p>
          ) : criteria.map((c, ci) => (
            <div key={ci} className="grid gap-2 mb-2 items-start" style={{ gridTemplateColumns: cellCols }}>
              <div className="flex items-start gap-1">
                <button onClick={() => removeCrit(ci)} title="Remove criterion" className="text-rose-300 hover:text-rose-600 text-xs mt-2">✕</button>
                <textarea value={c.name} onChange={e => setCrit(ci, { name: e.target.value })} className={`${inp} w-full resize-y ${minH} text-[13px]`} placeholder="Criterion name" />
              </div>
              <input value={c.max} onChange={e => setCrit(ci, { max: e.target.value.replace(/[^\d]/g, '') })} className={`${inp} text-center`} placeholder="4" />
              {bands.map((b, bi) => (
                <textarea key={bi} value={(c.cells || [])[bi] ?? ''} onChange={e => setCell(ci, bi, e.target.value)} className={`${inp} w-full resize-y ${minH} text-[12px] leading-snug`} placeholder="Descriptor…" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

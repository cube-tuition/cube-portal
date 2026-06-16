'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * LinkedRecordPicker — Airtable-style searchable dropdown for choosing the
 * record a foreign-key column should point at. Renders the human-readable name
 * (plus secondary context) for each candidate and returns the chosen id.
 *
 * It only ever passes back an id from the supplied option list (or null to
 * clear), so a save can never reference a non-existent record.
 *
 * Props:
 *   value     current stored id (highlighted in the list)
 *   options   [{ id, label, secondary }]  candidate records (from useReferenceData)
 *   width     cell width in px (keeps the popover aligned to the column)
 *   onPick    (id|null) => void   called when the user selects / clears
 *   onCancel  () => void          called on Escape / outside click
 */
export default function LinkedRecordPicker({ value, options = [], width = 240, onPick, onCancel }) {
  const [q, setQ] = useState('')
  const boxRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onCancel?.() }
    const onKey  = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel?.() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onCancel])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? options.filter(o => `${o.label} ${o.secondary ?? ''}`.toLowerCase().includes(needle))
      : options
    return list.slice(0, 50)
  }, [q, options])

  const panelW = Math.max(width, 240)

  return (
    <div
      ref={boxRef}
      className="absolute z-50 left-0 top-0 bg-white border-2 border-[#325099] rounded-lg shadow-xl overflow-hidden"
      style={{ width: panelW }}
      onClick={e => e.stopPropagation()}
    >
      <div className="p-1.5 border-b border-[#DEE7FF]">
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search…"
          className="w-full px-2 py-1.5 text-xs bg-[#F7F9FF] border border-[#DEE7FF] rounded focus:outline-none focus:border-[#325099]"
        />
      </div>
      <div className="max-h-60 overflow-y-auto py-1">
        <button
          type="button"
          onClick={() => onPick?.(null)}
          className="w-full text-left px-3 py-1.5 text-[11px] text-[#2A2035]/50 italic hover:bg-[#F0F4FF]"
        >
          — Clear / none —
        </button>
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-[#2A2035]/40">No matches.</p>
        ) : filtered.map(o => {
          const selected = String(o.id) === String(value)
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick?.(o.id)}
              className={`w-full text-left px-3 py-1.5 hover:bg-[#EEF4FF] transition ${selected ? 'bg-[#EEF4FF]' : ''}`}
            >
              <span className="block text-xs text-[#2A2035] truncate">
                {selected && <span className="text-[#325099] mr-1">✓</span>}{o.label}
              </span>
              {o.secondary && <span className="block text-[10px] text-[#2A2035]/45 truncate">{o.secondary}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

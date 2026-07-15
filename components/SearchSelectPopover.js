'use client'

import { useState, useEffect, useMemo } from 'react'

/*
 * SearchSelectPopover — the shared searchable dropdown (originally built for
 * the database explorer grids). Anchors to a trigger's bounding rect, filters
 * as you type, and supports ↑/↓/Enter/Esc. Options: [{ value, label, sub? }].
 * Pass clearLabel to pin a "clear" entry at the top (selects value '').
 */
export default function SearchSelectPopover({ anchor, options, currentValue, onSelect, onClose, placeholder = 'Search…', clearLabel = null }) {
  const [q, setQ]   = useState('')
  const [hi, setHi] = useState(0)

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const filtered = t
      ? options.filter(o => `${o.label} ${o.sub || ''}`.toLowerCase().includes(t))
      : options
    // The clear entry stays pinned at the top regardless of the search text.
    return clearLabel ? [{ value: '', label: clearLabel, _clear: true }, ...filtered] : filtered
  }, [q, options, clearLabel])
  useEffect(() => { setHi(0) }, [q])

  const WIDTH = 340, MAX_H = 336
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1200
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.max(8, Math.min(anchor.left, winW - WIDTH - 12))
  const openUp = winH - anchor.bottom < MAX_H + 16
  const pos = openUp
    ? { left, bottom: winH - anchor.top + 4, width: WIDTH }
    : { left, top: anchor.bottom + 4, width: WIDTH }

  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose}>
      <div
        className="fixed bg-white border border-[#BACBFF] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={pos}
        onMouseDown={e => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={placeholder}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
            if (e.key === 'Enter')     { e.preventDefault(); if (list[hi]) onSelect(list[hi].value) }
            if (e.key === 'Escape')    { e.preventDefault(); onClose() }
          }}
          className="w-full px-3.5 py-2.5 text-xs text-[#2A2035] border-b border-[#DEE7FF] focus:outline-none placeholder-[#2A2035]/30"
        />
        <div className="overflow-y-auto" style={{ maxHeight: MAX_H - 40 }}>
          {list.length === 0 ? (
            <p className="text-xs text-center py-6 text-[#2A2035]/40">No matches for “{q}”.</p>
          ) : list.map((o, i) => {
            const isCurrent = !o._clear && String(o.value) === String(currentValue ?? '')
            return (
              <button
                key={`${o.value}_${i}`}
                ref={i === hi ? (el => el?.scrollIntoView({ block: 'nearest' })) : undefined}
                onClick={() => onSelect(o.value)}
                onMouseEnter={() => setHi(i)}
                className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between gap-2 transition-colors ${i === hi ? 'bg-[#EEF4FF]' : 'bg-white'} ${o._clear ? 'border-b border-[#F0F4FF]' : ''}`}
              >
                <span className="min-w-0">
                  <span className={`block truncate ${o._clear ? 'italic text-[#2A2035]/50' : isCurrent ? 'font-bold text-[#062E63]' : 'font-semibold text-[#2A2035]'}`}>{o.label}</span>
                  {o.sub && <span className="block truncate text-[10px] text-[#2A2035]/50">{o.sub}</span>}
                </span>
                {isCurrent && <span className="text-[#16A34A] shrink-0">✓ current</span>}
              </button>
            )
          })}
        </div>
        <div className="px-3.5 py-1.5 border-t border-[#F0F4FF] bg-[#F8FAFF] text-[9px] text-[#2A2035]/40">
          ↑↓ navigate · Enter select · Esc close{list.length ? ` · ${list.filter(o => !o._clear).length} option${list.filter(o => !o._clear).length === 1 ? '' : 's'}` : ''}
        </div>
      </div>
    </div>
  )
}

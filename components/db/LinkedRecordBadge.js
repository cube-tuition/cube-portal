'use client'

/**
 * LinkedRecordBadge — shows the human-readable name of a foreign-key value
 * instead of a raw UUID/id, and opens the linked record when clicked.
 *
 * Non-destructive and crash-safe: if the id can't be resolved (missing
 * reference row, unusual legacy value) it falls back to showing the raw id with
 * a subtle "unresolved" hint rather than throwing.
 *
 * Props:
 *   value     the stored foreign-key value (id)
 *   refTable  the referenced table name
 *   resolve   (table, id) => { label, secondary } | null   (from useReferenceData)
 *   onOpen    (refTable, id) => void                        optional click handler
 *   compact   smaller styling for dense table cells
 */
export default function LinkedRecordBadge({ value, refTable, resolve, onOpen, compact = false }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-[#2A2035]/20 italic text-[10px]">—</span>
  }
  const hit = resolve ? resolve(refTable, value) : null
  const clickable = typeof onOpen === 'function'
  const pad = compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'

  const handle = (e) => {
    if (!clickable) return
    e.stopPropagation()
    onOpen(refTable, value)
  }

  if (!hit) {
    // Unresolved — still show something useful and safe.
    return (
      <span
        title={`Could not resolve ${refTable} #${value}`}
        className={`inline-flex items-center gap-1 rounded-full border border-dashed border-[#E5B567] bg-[#FFF7E6] text-[#92400E] font-mono ${pad}`}
      >
        <span className="opacity-60">⚠</span>{String(value).slice(0, 8)}…
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={!clickable}
      title={clickable ? `Open ${hit.label}` : hit.label}
      className={`inline-flex items-center gap-1 rounded-full border border-[#C9D9F2] bg-[#EEF4FF] text-[#27406E] font-medium max-w-full ${pad} ${clickable ? 'hover:bg-[#DEE7FF] hover:border-[#9DBBEA] cursor-pointer' : 'cursor-default'} transition`}
    >
      <span className="truncate">{hit.label}</span>
      {clickable && <span className="text-[#325099]/50 text-[9px] shrink-0">↗</span>}
    </button>
  )
}

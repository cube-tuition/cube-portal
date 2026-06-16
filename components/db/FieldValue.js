'use client'

import { fieldType, formatDisplay, linkedRef, dropdownOptions } from '../../lib/tableMeta'
import LinkedRecordBadge from './LinkedRecordBadge'

/**
 * FieldValue (DatabaseFieldRenderer) — renders a single value read-only,
 * formatted according to its column type. Pure display: it never mutates the
 * stored value and degrades gracefully (shows the raw value) for anything it
 * can't format, and shows a muted dash for null/empty.
 *
 * Props:
 *   table, col, value
 *   resolve     linked-record resolver (from useReferenceData)
 *   onOpenLink  (refTable, id) => void  — makes linked values clickable
 */

// Subtle auto-colours for status-like single-select values.
function badgeClass(v) {
  const s = String(v).toLowerCase()
  if (['active', 'paid', 'present', 'approved', 'confirmed', 'enrolled', 'sent'].some(k => s.includes(k)))
    return 'bg-emerald-100 text-emerald-800 border border-emerald-200'
  if (['trial', 'partial', 'late', 'pending', 'draft', 'submitted', 'unsent', 'new', 'contacted'].some(k => s.includes(k)))
    return 'bg-amber-100 text-amber-800 border border-amber-200'
  if (['disenrol', 'absent', 'overdue', 'voided', 'cancelled', 'declined', 'not_continuing', 'quit'].some(k => s.includes(k)))
    return 'bg-rose-100 text-rose-700 border border-rose-200'
  return 'bg-slate-100 text-slate-600 border border-slate-200'
}

export default function FieldValue({ table, col, value, resolve, onOpenLink }) {
  // Linked records first — resolved to a clickable name badge.
  const ref = linkedRef(table, col)
  if (ref) {
    return <LinkedRecordBadge value={value} refTable={ref.refTable} resolve={resolve} onOpen={onOpenLink} compact />
  }

  if (value === null || value === undefined || value === '') {
    return <span className="text-[#2A2035]/25 italic text-xs">—</span>
  }

  const type = fieldType(table, col)

  if (type === 'boolean') {
    const on = value === true || value === 'true'
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${on ? 'text-emerald-700' : 'text-[#2A2035]/45'}`}>
        <span>{on ? '☑' : '☐'}</span>{on ? 'Yes' : 'No'}
      </span>
    )
  }

  if (type === 'email') {
    return <a href={`mailto:${value}`} onClick={e => e.stopPropagation()} className="text-[#325099] hover:underline text-xs break-all">{value}</a>
  }

  if (type === 'url') {
    const href = String(value).match(/^https?:\/\//) ? value : `https://${value}`
    return <a href={href} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[#325099] hover:underline text-xs break-all">{value} ↗</a>
  }

  if (type === 'phone') {
    return <a href={`tel:${String(value).replace(/[^\d+]/g, '')}`} onClick={e => e.stopPropagation()} className="text-[#2A2035] hover:underline text-xs">{value}</a>
  }

  if (type === 'singleSelect' || dropdownOptions(table, col)) {
    return <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeClass(value)}`}>{String(value)}</span>
  }

  if (type === 'json') {
    let pretty
    try { pretty = typeof value === 'string' ? value : JSON.stringify(value, null, 2) } catch { pretty = String(value) }
    return <pre className="text-[10px] text-[#2A2035]/70 bg-[#F7F9FF] border border-[#E8EDF8] rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">{pretty}</pre>
  }

  if (type === 'currency' || type === 'percent' || type === 'date' || type === 'datetime') {
    return <span className="text-xs text-[#2A2035] tabular-nums">{formatDisplay(table, col, value)}</span>
  }

  return <span className="text-xs text-[#2A2035] whitespace-pre-wrap break-words">{String(value)}</span>
}

'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TABLE_META, columnLabel, colMeta, formatDisplay } from '../../lib/tableMeta'
import { linkedSectionsFor, REFERENCE_TABLES } from '../../lib/dbReference'
import FieldValue from './FieldValue'

/**
 * RecordDetailPanel (RecordDetailSidePanel) — Airtable-style right-hand panel
 * for one record. Shows every field rendered by type, plus "linked records"
 * sections built from existing foreign keys. Clicking any linked record opens
 * it in the same panel (with a back button), so directors can walk the graph
 * student → class → lessons without leaving the explorer.
 *
 * READ-ONLY: this panel never writes. Editing still happens in the grid, which
 * keeps all existing save / validation / undo behaviour intact.
 *
 * Props:
 *   initial   { realTable, row }   the record to open
 *   resolve   linked-record resolver from useReferenceData
 *   onClose   () => void
 */
function primaryLabel(realTable, row) {
  if (!row) return realTable
  return (
    row.full_name || row.class_name || row.name || row.course_name ||
    row.invoice_number || row.student_name ||
    `${TABLE_META[realTable]?.label ?? realTable} #${row.id}`
  )
}

export default function RecordDetailPanel({ initial, resolve, onClose }) {
  // The panel is reset by the parent via a `key` prop, so the stack can safely
  // initialise from `initial` once (no sync-setState-in-effect needed).
  const [stack, setStack] = useState(() => (initial ? [initial] : []))
  const [showSystem, setShowSystem] = useState(false)
  const [sections, setSections] = useState(null)   // [{ def, rows, error }]
  const [secLoading, setSecLoading] = useState(false)

  const current = stack[stack.length - 1] || null
  const realTable = current?.realTable
  const row = current?.row
  const rowId = row?.id

  // Load child collections for the current record. All setState happens inside
  // the async closure (never synchronously in the effect body).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!realTable || rowId === undefined) { if (!cancelled) setSections(null); return }
      const defs = linkedSectionsFor(realTable)
      if (!defs || defs.length === 0) { if (!cancelled) setSections([]); return }
      if (!cancelled) { setSecLoading(true); setSections(null) }
      const loaded = await Promise.all(defs.map(async (def) => {
        const { data, error } = await supabase
          .from(def.table).select('*').eq(def.fkCol, rowId).limit(50)
        return { def, rows: data ?? [], error: error?.message ?? null }
      }))
      if (!cancelled) { setSections(loaded); setSecLoading(false) }
    })()
    return () => { cancelled = true }
  }, [realTable, rowId])

  if (!current) return null

  const push = (entry) => setStack(s => [...s, entry])
  const back = () => setStack(s => (s.length > 1 ? s.slice(0, -1) : s))

  // Open a linked record (from a field badge or a section row).
  const openByRef = async (refTable, id) => {
    if (id === null || id === undefined) return
    const { data } = await supabase.from(refTable).select('*').eq('id', id).single()
    if (data) push({ realTable: refTable, row: data })
  }
  const openChild = (table, childRow) => push({ realTable: table, row: childRow })

  const allCols = row ? Object.keys(row) : []
  const meta = (c) => colMeta(realTable, c)
  const visibleCols = allCols.filter(c => !meta(c)?.hidden)
  const systemCols  = allCols.filter(c => meta(c)?.hidden)

  const renderField = (c) => (
    <div key={c} className="flex items-start gap-3 py-1.5 border-b border-[#F0F3FA] last:border-0">
      <div className="w-32 shrink-0 text-[11px] text-[#2A2035]/50 pt-0.5">{columnLabel(realTable, c)}</div>
      <div className="flex-1 min-w-0">
        {c === 'id'
          ? <span className="font-mono text-[10px] text-[#325099]/70 break-all">{String(row[c])}</span>
          : <FieldValue table={realTable} col={c} value={row[c]} resolve={resolve} onOpenLink={openByRef} />}
      </div>
    </div>
  )

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[440px] max-w-full z-50 bg-white shadow-2xl flex flex-col border-l border-[#DEE7FF] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#DEE7FF] bg-[#F7F9FF]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {stack.length > 1 && (
                <button onClick={back} className="text-[11px] text-[#325099] hover:underline mb-1 flex items-center gap-1">← Back</button>
              )}
              <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099]">{TABLE_META[realTable]?.label ?? realTable}</p>
              <h2 className="text-lg font-semibold text-[#2A2035] truncate">{primaryLabel(realTable, row)}</h2>
            </div>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#DEE7FF] text-[#2A2035]/50 shrink-0">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Fields */}
          <section>
            <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#2A2035]/40 mb-1.5">Fields</p>
            <div>{visibleCols.map(renderField)}</div>
            {systemCols.length > 0 && (
              <div className="mt-2">
                <button onClick={() => setShowSystem(v => !v)} className="text-[11px] text-[#325099] hover:underline">
                  {showSystem ? 'Hide' : 'Show'} system fields ({systemCols.length})
                </button>
                {showSystem && <div className="mt-1.5">{systemCols.map(renderField)}</div>}
              </div>
            )}
          </section>

          {/* Linked records */}
          <section>
            <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#2A2035]/40 mb-1.5">Linked records</p>
            {sections === null || secLoading ? (
              <p className="text-xs text-[#2A2035]/40">Loading…</p>
            ) : sections.length === 0 ? (
              <p className="text-xs text-[#2A2035]/40 italic">Relationship not configured for this table.</p>
            ) : (
              <div className="space-y-4">
                {sections.map(({ def, rows, error }) => (
                  <div key={def.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-[#2A2035]">{def.label}</span>
                      <span className="text-[10px] text-[#2A2035]/40">{error ? '—' : rows.length}</span>
                    </div>
                    {error ? (
                      <p className="text-[11px] text-rose-500">Could not load: {error}</p>
                    ) : rows.length === 0 ? (
                      <p className="text-[11px] text-[#2A2035]/35 italic">No linked records found.</p>
                    ) : (
                      <div className="space-y-1">
                        {rows.map(r => {
                          // Primary label: resolve a linked id (e.g. class_id → class name) if configured.
                          let label = r[def.labelCol]
                          if (def.linkLabelFrom) {
                            const hit = resolve?.(def.linkLabelFrom, r[def.labelCol])
                            label = hit?.label ?? `#${r[def.labelCol]}`
                          } else if (REFERENCE_TABLES[def.table] && def.labelCol === 'id') {
                            label = primaryLabel(def.table, r)
                          } else if (label === null || label === undefined || label === '') {
                            label = primaryLabel(def.table, r)
                          } else if (colMeta(def.table, def.labelCol)) {
                            label = formatDisplay(def.table, def.labelCol, label) || label
                          }
                          const secondary = (def.secondary ?? [])
                            .map(c => formatDisplay(def.table, c, r[c]) || r[c])
                            .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
                            .join(' · ')
                          return (
                            <button
                              key={r.id}
                              onClick={() => openChild(def.table, r)}
                              className="w-full text-left px-2.5 py-1.5 rounded-lg border border-[#E8EDF8] hover:border-[#9DBBEA] hover:bg-[#F7F9FF] transition flex items-center justify-between gap-2"
                            >
                              <span className="min-w-0">
                                <span className="block text-xs text-[#2A2035] truncate">{String(label)}</span>
                                {secondary && <span className="block text-[10px] text-[#2A2035]/45 truncate">{secondary}</span>}
                              </span>
                              <span className="text-[#325099]/40 text-[11px] shrink-0">↗</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {def.note && <p className="text-[10px] text-[#2A2035]/35 mt-1">{def.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

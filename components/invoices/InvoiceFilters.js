'use client'
import { useEffect, useRef, useState } from 'react'

/*
 * Invoice filtering in two layers, so adding a dimension never adds a card:
 *
 *  - QUEUES (the cards): where each invoice sits in the workflow — what to do
 *    with it next. One queue at a time; click again to go back to All.
 *  - FACETS (the dropdowns under them): everything else — stage, email, payment,
 *    Xero, payment method. Pick any number; options in one facet widen (OR),
 *    different facets narrow (AND). Every option shows how many invoices it
 *    would leave, given everything else that is selected.
 *
 * Voided invoices are out of every view unless Stage → Voided is picked: they
 * are settled history, and counting them as unpaid or unsent would mislead.
 */

const isVoided = (i) => i.status === 'voided'
const isSent = (i) => i.delivery_status === 'sent'

// `warn(inv)` is passed in: warnings need the page's own lookups.
export const QUEUES = [
  { id: 'all',       label: 'All',              test: () => true },
  { id: 'approve',   label: 'To approve',       test: (i) => i.status === 'draft',
    hint: 'Drafts waiting for approval' },
  { id: 'send',      label: 'To send',          test: (i) => i.status !== 'draft' && !isSent(i) && i.payment_status !== 'paid',
    hint: 'Approved but not emailed yet' },
  { id: 'awaiting',  label: 'Awaiting',         test: (i) => isSent(i) && i.payment_status === 'unpaid',
    hint: 'Emailed, not paid, not yet due' },
  { id: 'overdue',   label: 'Overdue',          test: (i) => i.payment_status === 'overdue', alert: 'text-red-600' },
  { id: 'paid',      label: 'Paid',             test: (i) => i.payment_status === 'paid', tone: 'text-[#065F46]' },
  { id: 'attention', label: 'Warnings',         test: (i, warn) => warn(i).length > 0, alert: 'text-[#92400E]',
    hint: 'Invoices with a warning to resolve' },
]

export const FACETS = [
  { id: 'stage', label: 'Stage', options: [
    { id: 'draft',    label: 'Draft',    test: (i) => i.status === 'draft' },
    { id: 'approved', label: 'Approved', test: (i) => i.status === 'approved' },
    { id: 'in_xero',  label: 'In Xero',  test: (i) => i.status === 'synced_to_xero' },
    { id: 'voided',   label: 'Voided',   test: isVoided },
  ] },
  { id: 'email', label: 'Email', options: [
    { id: 'sent',     label: 'Invoice sent',     test: isSent },
    { id: 'unsent',   label: 'Invoice not sent', test: (i) => !isSent(i) },
    { id: 'reminded', label: 'Reminder sent',    test: (i) => !!i.reminder_sent_at },
    { id: 'receipt',  label: 'Receipt sent',     test: (i) => !!i.receipt_sent_at },
  ] },
  { id: 'payment', label: 'Payment', options: [
    { id: 'unpaid',  label: 'Unpaid',  test: (i) => i.payment_status === 'unpaid' },
    { id: 'overdue', label: 'Overdue', test: (i) => i.payment_status === 'overdue' },
    { id: 'paid',    label: 'Paid',    test: (i) => i.payment_status === 'paid' },
  ] },
  { id: 'xero', label: 'Xero', options: [
    { id: 'synced',   label: 'In Xero',    test: (i) => !!i.xero_invoice_id },
    // Same rule as the card badge: drafts and cash invoices are never pushed.
    { id: 'unsynced', label: 'Not synced', test: (i) => !i.xero_invoice_id && i.status !== 'draft' && !isVoided(i) && i.payment_method !== 'cash' },
    { id: 'cash',     label: 'Cash · not in Xero', test: (i) => !i.xero_invoice_id && i.payment_method === 'cash' },
  ] },
  { id: 'method', label: 'Method', options: [
    { id: 'bank', label: 'Bank transfer', test: (i) => i.payment_method !== 'cash' },
    { id: 'cash', label: 'Cash',          test: (i) => i.payment_method === 'cash' },
  ] },
]

export const SORTS = [
  { id: 'number',    label: 'Invoice number' },
  { id: 'attention', label: 'Most urgent first' },
  { id: 'family',    label: 'Family A–Z' },
  { id: 'amount',    label: 'Amount, high to low' },
  { id: 'due',       label: 'Due date' },
]

const optTest = (facetId, optId) =>
  FACETS.find((f) => f.id === facetId)?.options.find((o) => o.id === optId)?.test || (() => true)

const matchesSearch = (i, q) => {
  if (!q) return true
  const hay = [i.invoice_number, i.reference_code, i.parent_name, i.parent_email, ...(i.student_names || [])]
    .filter(Boolean).join(' ').toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

// Does `i` pass the selected facets? `skip` leaves one facet out — used to count
// what each of that facet's own options would show.
function passesFacets(i, sel, skip) {
  if (isVoided(i) && skip !== 'stage' && !(sel.stage || []).includes('voided')) return false
  for (const f of FACETS) {
    if (f.id === skip) continue
    const picked = sel[f.id] || []
    if (picked.length && !picked.some((o) => optTest(f.id, o)(i))) return false
  }
  return true
}

// Lower = more urgent: overdue, warnings, unsent, awaiting payment, drafts, paid, voided.
function urgency(i, warn) {
  if (isVoided(i)) return 9
  if (i.payment_status === 'overdue') return 0
  if (warn(i).length) return 1
  if (i.status !== 'draft' && !isSent(i) && i.payment_status !== 'paid') return 2
  if (i.payment_status === 'unpaid' && isSent(i)) return 3
  if (i.status === 'draft') return 4
  return 5
}

const SORT_FNS = {
  number:    () => (a, b) => String(a.invoice_number || '').localeCompare(String(b.invoice_number || '')),
  attention: (warn) => (a, b) => urgency(a, warn) - urgency(b, warn)
    || String(a.due_date || '').localeCompare(String(b.due_date || '')),
  family:    () => (a, b) => String(a.parent_name || '').localeCompare(String(b.parent_name || ''))
    || String((a.student_names || [])[0] || '').localeCompare(String((b.student_names || [])[0] || '')),
  amount:    () => (a, b) => (Number(b.total) || 0) - (Number(a.total) || 0),
  due:       () => (a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')),
}

/*
 * Everything the page needs from one pass: the sorted list to show, the count
 * behind each queue card, and the count behind each facet option.
 */
export function applyInvoiceFilters(invoices, { queue, sel, search, sort }, warn) {
  const q = QUEUES.find((x) => x.id === queue) || QUEUES[0]
  const inQueue = (i) => q.test(i, warn)
  const searched = invoices.filter((i) => matchesSearch(i, search))

  const faceted = searched.filter((i) => passesFacets(i, sel))
  const queueCounts = Object.fromEntries(QUEUES.map((x) => [x.id, faceted.filter((i) => x.test(i, warn)).length]))
  const list = faceted.filter(inQueue).sort(SORT_FNS[sort]?.(warn) || SORT_FNS.number())

  const optionCounts = {}
  for (const f of FACETS) {
    const pool = searched.filter((i) => inQueue(i) && passesFacets(i, sel, f.id))
    for (const o of f.options) optionCounts[`${f.id}.${o.id}`] = pool.filter(o.test).length
  }
  return { list, queueCounts, optionCounts }
}

export const activeFacetCount = (sel) => Object.values(sel).reduce((n, v) => n + (v?.length || 0), 0)

// ── UI ────────────────────────────────────────────────────────────────────────

const money = (n) => (Number(n) || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })

export function QueueCards({ queue, onQueue, counts, revenue, potential }) {
  return (
    <div className="grid grid-cols-4 lg:grid-cols-8 gap-2 md:gap-3 mb-3">
      {QUEUES.map((x) => {
        const n = counts[x.id] || 0
        const on = queue === x.id
        const cls = n > 0 && x.alert ? x.alert : x.tone || (x.id === 'all' ? 'text-[#062E63]' : 'text-[#325099]')
        return (
          <button key={x.id} title={x.hint || ''}
            onClick={() => onQueue(on && x.id !== 'all' ? 'all' : x.id)}
            className={`min-w-0 bg-white border rounded-xl px-1 md:px-3 py-2.5 md:py-3 text-center transition hover:border-[#325099]/40 cursor-pointer ${
              on ? 'border-[#325099] ring-2 ring-[#325099]/20' : 'border-[#DEE7FF]'}`}>
            <div className={`text-base md:text-lg font-bold tabular-nums truncate ${cls}`}>{n}</div>
            <div className="text-[9px] md:text-[10px] text-[#325099]/60 font-semibold mt-0.5 uppercase tracking-wide md:tracking-wider truncate">{x.label}</div>
          </button>
        )
      })}
      {/* Revenue = invoices past draft; Potential adds the drafts too, i.e. what
          the term brings in once every draft is approved. Voided never count. */}
      <div className="min-w-0 bg-white border border-[#DEE7FF] rounded-xl px-1 md:px-3 py-2.5 md:py-3 text-center cursor-default"
        title={`Revenue: approved, in-Xero and paid invoices this term.\nPotential: also counts drafts not yet approved.\nVoided invoices are never counted.`}>
        <div className="text-base md:text-lg font-bold tabular-nums truncate text-[#062E63]">${money(revenue)}</div>
        <div className="text-[9px] md:text-[10px] text-[#325099]/60 font-semibold mt-0.5 uppercase tracking-wide md:tracking-wider truncate">Revenue</div>
        {potential > revenue && (
          <div className="text-[9px] md:text-[10px] text-[#325099]/45 font-semibold mt-1 tabular-nums leading-tight">${money(potential)} potential</div>
        )}
      </div>
    </div>
  )
}

function FacetMenu({ facet, picked, counts, onToggle, onClear }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const labels = facet.options.filter((o) => picked.includes(o.id)).map((o) => o.label)
  const active = labels.length > 0
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 text-[11px] font-semibold border rounded-full px-3 py-1.5 transition max-w-[220px] ${
          active ? 'bg-[#062E63] text-white border-[#062E63]' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]/40'}`}>
        <span className="truncate">{facet.label}{active ? `: ${labels.length > 1 ? `${labels.length} selected` : labels[0]}` : ''}</span>
        {active
          ? <span role="button" aria-label={`Clear ${facet.label}`} onClick={(e) => { e.stopPropagation(); onClear() }} className="ml-0.5 opacity-70 hover:opacity-100">✕</span>
          : <span className="opacity-50">▾</span>}
      </button>
      {open && (
        <div className="absolute z-30 left-0 mt-1 min-w-[190px] bg-white border border-[#DEE7FF] rounded-xl shadow-lg py-1">
          {facet.options.map((o) => {
            const n = counts[`${facet.id}.${o.id}`] || 0
            const on = picked.includes(o.id)
            return (
              <label key={o.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-[#F0F4FF] ${!n && !on ? 'opacity-40' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => onToggle(o.id)} className="accent-[#325099]" />
                <span className="flex-1 text-[#062E63]">{o.label}</span>
                <span className="tabular-nums text-[#325099]/50">{n}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function FacetBar({ sel, setSel, counts, search, setSearch, sort, setSort, onClearAll, anyActive }) {
  const toggle = (fid, oid) => setSel((s) => {
    const cur = s[fid] || []
    return { ...s, [fid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid] }
  })
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative w-full md:w-56">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search family, student, invoice no."
          className="w-full border border-[#DEE7FF] rounded-full pl-3 pr-7 py-1.5 text-xs text-[#062E63] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/25" />
        {search && <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[#325099]/50 hover:text-[#325099]">✕</button>}
      </div>
      {FACETS.map((f) => (
        <FacetMenu key={f.id} facet={f} picked={sel[f.id] || []} counts={counts}
          onToggle={(oid) => toggle(f.id, oid)} onClear={() => setSel((s) => ({ ...s, [f.id]: [] }))} />
      ))}
      <label className="flex items-center gap-1 text-[11px] text-[#325099]/60 md:ml-auto">
        <span className="font-semibold">Sort</span>
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="border border-[#DEE7FF] rounded-full px-2.5 py-1.5 text-[11px] font-semibold text-[#325099] bg-white focus:outline-none">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {anyActive && (
        <button onClick={onClearAll} className="text-[11px] text-[#325099]/50 hover:text-[#325099] transition">✕ Clear all</button>
      )}
    </div>
  )
}

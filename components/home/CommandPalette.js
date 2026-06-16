'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { T_STUDENTS, T_CLASSES, T_INVOICES } from '../../lib/tables'
import { fmtMoney } from '../../lib/format'

/*
 * CommandPalette — a ⌘K / Ctrl-K quick-jump and lookup for directors. Searches
 * students, classes and invoices and either navigates to the record or shows
 * its key facts inline (handy where there's no dedicated detail page). Data is
 * lazy-loaded on first open and cached for the session, so it costs nothing
 * until used. Open it with ⌘K, Ctrl-K, or by dispatching window event
 * 'open-command-palette'.
 */

const STATUS_COLORS = {
  active: 'bg-emerald-100 text-emerald-700', trial: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700', unpaid: 'bg-rose-100 text-rose-700',
  partial: 'bg-amber-100 text-amber-700', overdue: 'bg-rose-100 text-rose-700',
}

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [data, setData] = useState(null)   // { students, classes, invoices } | null
  const inputRef = useRef(null)

  // Global open/close shortcuts + custom event from the hero button.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setOpen(o => !o); setQuery(''); setActive(0)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    const onOpen = () => { setOpen(true); setQuery(''); setActive(0) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-command-palette', onOpen) }
  }, [])

  // Lazy-load data the first time the palette opens.
  useEffect(() => {
    if (!open || data) return
    let cancelled = false
    ;(async () => {
      const [s, c, i] = await Promise.all([
        supabase.from(T_STUDENTS).select('id, full_name, year, school, status'),
        supabase.from(T_CLASSES).select('id, class_name, day_of_week, start_time, teacher, room'),
        supabase.from(T_INVOICES).select('id, invoice_number, total, status, payment_status').neq('status', 'voided'),
      ])
      if (cancelled) return
      setData({ students: s.data || [], classes: c.data || [], invoices: i.data || [] })
    })()
    return () => { cancelled = true }
  }, [open, data])

  // Focus the input whenever the palette opens.
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const results = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out = []
    for (const s of data.students) {
      if ((s.full_name || '').toLowerCase().includes(q) || (s.school || '').toLowerCase().includes(q)) {
        out.push({
          kind: 'student', id: s.id, title: s.full_name || 'Student',
          sub: [s.year ? `Year ${s.year}` : null, s.school].filter(Boolean).join(' · '),
          badge: s.status, href: '/tutor/students',
        })
      }
      if (out.length > 40) break
    }
    for (const c of data.classes) {
      if ((c.class_name || '').toLowerCase().includes(q) || (c.teacher || '').toLowerCase().includes(q)) {
        out.push({
          kind: 'class', id: c.id, title: c.class_name || 'Class',
          sub: [c.day_of_week, c.teacher, c.room].filter(Boolean).join(' · '),
          href: `/tutor/classes/${c.id}`,
        })
      }
    }
    for (const inv of data.invoices) {
      if (String(inv.invoice_number || '').toLowerCase().includes(q)) {
        out.push({
          kind: 'invoice', id: inv.id, title: `Invoice ${inv.invoice_number}`,
          sub: fmtMoney(inv.total),
          badge: inv.payment_status || inv.status, href: '/tutor/accounting/invoices',
        })
      }
    }
    return out.slice(0, 24)
  }, [query, data])

  if (!open) return null

  const go = (item) => {
    if (!item) return
    setOpen(false)
    router.push(item.href)
  }

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
  }

  const KIND = {
    student: { icon: '🧑‍🎓', label: 'Student' },
    class:   { icon: '📚', label: 'Class' },
    invoice: { icon: '🧾', label: 'Invoice' },
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-[#DEE7FF]">
          <span className="text-[#325099]">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={onInputKey}
            placeholder="Search students, classes, invoices…"
            className="flex-1 py-3.5 text-sm bg-transparent focus:outline-none text-[#2A2035]"
          />
          <kbd className="text-[10px] text-[#2A2035]/40 border border-[#DEE7FF] rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto py-2">
          {!data ? (
            <p className="px-4 py-6 text-center text-xs text-[#2A2035]/40 animate-pulse">Loading directory…</p>
          ) : !query.trim() ? (
            <p className="px-4 py-6 text-center text-xs text-[#2A2035]/40">Type a name, class or invoice number…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-[#2A2035]/40">No matches for “{query}”.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.kind}-${r.id}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition ${i === active ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8FAFF]'}`}
              >
                <span className="text-base shrink-0">{KIND[r.kind].icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-[#2A2035] truncate">{r.title}</span>
                  {r.sub && <span className="block text-[11px] text-[#2A2035]/50 truncate">{r.sub}</span>}
                </span>
                {r.badge && (
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[r.badge] || 'bg-slate-100 text-slate-600'}`}>{r.badge}</span>
                )}
                <span className="text-[9px] uppercase tracking-wider text-[#2A2035]/30 shrink-0">{KIND[r.kind].label}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

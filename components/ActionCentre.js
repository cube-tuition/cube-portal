'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getAuthProfile } from '../lib/getProfile'
import { runActionChecks } from '../lib/actionCentre'
import { markCadenceDone } from '../lib/emailCadence'

/*
 * ActionCentre — "what needs my attention" boxes for directors, shown at the
 * top of /tutor. One card per category (Operations, Invoices, …); each card
 * has its own severity summary and all-clear state. Self-gating: renders
 * nothing for tutors.
 *
 * To add a category: tag checks with a section name in lib/actionCentre.js
 * and add it to SECTIONS below.
 */

const SECTIONS = [
  { id: 'Operations', icon: '⚙️', title: 'Operations' },
  { id: 'Invoices',   icon: '🧾', title: 'Invoices' },
  { id: 'Emails',     icon: '📧', title: 'Emails', clearText: 'No campaign due this week — see the cadence on the Emails page.' },
]

const SEV = {
  red:   { label: 'Act now',       chip: 'bg-rose-100 text-rose-700 border-rose-200',     dot: 'bg-rose-500' },
  amber: { label: 'This week',     chip: 'bg-amber-100 text-amber-700 border-amber-200',  dot: 'bg-amber-400' },
  blue:  { label: 'Worth knowing', chip: 'bg-blue-100 text-blue-700 border-blue-200',     dot: 'bg-blue-400' },
}

function SectionCard({ section, items, loading, onDone }) {
  const reds = items.filter(i => i.severity === 'red').length
  const clear = !loading && items.length === 0
  return (
    <div className={`bg-white rounded-2xl border overflow-hidden flex flex-col ${reds ? 'border-rose-200' : 'border-[#DEE7FF]'}`}>
      <div className={`flex items-center justify-between px-4 py-3 ${reds ? 'bg-rose-50/60' : 'bg-[#F8FAFF]'} border-b border-[#F0F4FF]`}>
        <p className="text-xs font-bold text-[#062E63]">{section.icon} {section.title}</p>
        {reds > 0
          ? <span className="text-[9px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full">{reds} act now</span>
          : clear
            ? <span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">✓ clear</span>
            : items.length > 0
              ? <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">{items.length} item{items.length === 1 ? '' : 's'}</span>
              : null}
      </div>
      {loading && items.length === 0 ? (
        <p className="px-4 py-4 text-xs text-[#2A2035]/40 animate-pulse">Checking…</p>
      ) : clear ? (
        <p className="px-4 py-4 text-xs text-[#2A2035]/40">{section.clearText || 'Nothing needs your attention here.'}</p>
      ) : (
        <div className="divide-y divide-[#F0F4FF]">
          {items.map((item, i) => (
            <Link key={i} href={item.href} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-[#F8FAFF] transition group">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEV[item.severity].dot}`} />
              <span className="text-base shrink-0">{item.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-[#2A2035]">
                  {!item.done && <span className="text-[#062E63] font-bold">{item.count} </span>}{item.label}
                </span>
                <span className="block text-[11px] text-[#2A2035]/45 truncate">{item.detail}</span>
              </span>
              {item.done && (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDone(item.done) }}
                  className="text-[10px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 px-2 py-1 rounded-full hover:bg-emerald-100 transition shrink-0"
                  title="Mark as sent — hides this for the rest of the term"
                >✓ Done</button>
              )}
              <span className="text-[#325099] text-xs shrink-0 opacity-0 group-hover:opacity-100 transition">{item.done ? 'Open →' : 'Fix →'}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ActionCentre() {
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const { items, generatedAt } = await runActionChecks()
      setItems(items); setGeneratedAt(generatedAt)
    } catch (e) { setError(e.message || 'Checks failed') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    getAuthProfile().then(({ role }) => {
      if (role === 'admin' || role === 'director') { setVisible(true); load() }
    })
  }, [])

  if (!visible) return null

  const totalReds = items.filter(i => i.severity === 'red').length

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-[#062E63]">
          ⚡ Action Centre
          {!loading && (totalReds > 0
            ? <span className="text-rose-600 font-semibold text-xs ml-2">{totalReds} item{totalReds === 1 ? '' : 's'} need{totalReds === 1 ? 's' : ''} action now</span>
            : items.length === 0
              ? <span className="text-emerald-700 font-semibold text-xs ml-2">all clear</span>
              : null)}
        </p>
        <div className="flex items-center gap-3">
          {generatedAt && <span className="text-[10px] text-[#2A2035]/35">checked {generatedAt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</span>}
          <button onClick={load} disabled={loading} className="text-[11px] font-semibold text-[#325099] hover:underline disabled:opacity-40">
            {loading ? 'Checking…' : '↻ Refresh'}
          </button>
        </div>
      </div>
      {error && <p className="mb-3 px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700">{error}</p>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {SECTIONS.map(section => (
          <SectionCard
            key={section.id}
            section={section}
            items={items.filter(i => (i.section ?? 'Operations') === section.id)}
            loading={loading}
            onDone={async ({ termId, rowKey }) => { if (termId) { await markCadenceDone(termId, rowKey); load() } }}
          />
        ))}
      </div>
    </div>
  )
}

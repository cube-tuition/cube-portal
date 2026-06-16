'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

/*
 * TrialFunnel — director home widget. A mini-CRM view of the trial pipeline:
 * counts per stage, follow-ups overdue, trials booked this week, and a recent
 * conversion rate. Read-only; links through to /tutor/trials. Self-gating data
 * fetch on mount (small table — trial_submissions).
 */

const STAGES = [
  { key: 'new',             label: 'New',          color: 'bg-[#DEE7FF]', text: 'text-[#325099]' },
  { key: 'contacted',       label: 'Contacted',    color: 'bg-[#C7D7FF]', text: 'text-[#27406E]' },
  { key: 'trial_scheduled', label: 'Trial booked', color: 'bg-[#FDE8B5]', text: 'text-[#92400E]' },
  { key: 'enrolled',        label: 'Enrolled',     color: 'bg-[#BBF3D0]', text: 'text-[#065F46]' },
]

const DAY_MS = 86400000

function startOfWeek(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const diff = (x.getDay() + 6) % 7 // Monday = 0
  x.setDate(x.getDate() - diff)
  return x
}

export default function TrialFunnel() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('trial_submissions')
        .select('id, status, submitted_at, contacted_at, trial_date, student_name')
      if (cancelled) return
      if (error) { setError(error.message); setRows([]) }
      else setRows(data || [])
    })()
    return () => { cancelled = true }
  }, [])

  if (rows === null) {
    return <WidgetShell title="Trial pipeline"><p className="text-xs text-[#2A2035]/40 animate-pulse py-8 text-center">Loading…</p></WidgetShell>
  }

  const now = new Date()
  const counts = Object.fromEntries(STAGES.map(s => [s.key, 0]))
  for (const r of rows) if (counts[r.status] !== undefined) counts[r.status]++
  const maxCount = Math.max(1, ...STAGES.map(s => counts[s.key]))

  // Follow-ups overdue: new (>2 days, never contacted) or contacted (>3 days, still stuck).
  const followUps = rows.filter(r => {
    if (r.status === 'new') {
      const age = (now - new Date(r.submitted_at || now)) / DAY_MS
      return !r.contacted_at && age > 2
    }
    if (r.status === 'contacted') {
      const since = r.contacted_at ? (now - new Date(r.contacted_at)) / DAY_MS : 99
      return since > 3
    }
    return false
  }).length

  // Trials booked for this week (not declined/enrolled yet).
  const ws = startOfWeek(now)
  const we = new Date(ws.getTime() + 7 * DAY_MS)
  const trialsThisWeek = rows.filter(r => {
    if (!r.trial_date) return false
    const d = new Date(r.trial_date + 'T00:00:00')
    return d >= ws && d < we && r.status !== 'declined'
  }).length

  // Conversion over the last 90 days: enrolled / decided (enrolled + declined).
  const cutoff = new Date(now.getTime() - 90 * DAY_MS)
  const recent = rows.filter(r => r.submitted_at && new Date(r.submitted_at) >= cutoff)
  const recentEnrolled = recent.filter(r => r.status === 'enrolled').length
  const recentDecided  = recent.filter(r => r.status === 'enrolled' || r.status === 'declined').length
  const conversion = recentDecided > 0 ? Math.round((recentEnrolled / recentDecided) * 100) : null

  return (
    <WidgetShell
      title="Trial pipeline"
      eyebrow="Growth"
      action={<Link href="/tutor/trials" className="text-[11px] font-semibold text-[#325099] hover:underline">All trials →</Link>}
    >
      {/* Funnel stages */}
      <div className="space-y-2 mb-4">
        {STAGES.map(s => (
          <Link key={s.key} href="/tutor/trials" className="flex items-center gap-3 group">
            <span className="w-24 shrink-0 text-[11px] font-medium text-[#2A2035]/70">{s.label}</span>
            <span className="flex-1 h-5 rounded-full bg-[#F1F5FF] overflow-hidden relative">
              <span className={`absolute inset-y-0 left-0 ${s.color} rounded-full transition-all group-hover:brightness-95`} style={{ width: `${(counts[s.key] / maxCount) * 100}%`, minWidth: counts[s.key] ? '1.5rem' : 0 }} />
            </span>
            <span className={`w-7 shrink-0 text-right text-sm font-bold tabular-nums ${s.text}`}>{counts[s.key]}</span>
          </Link>
        ))}
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[#F0F4FF]">
        <Stat label="Follow-ups due" value={followUps} tone={followUps > 0 ? 'red' : 'ok'} href="/tutor/trials" />
        <Stat label="Trials this wk" value={trialsThisWeek} tone="neutral" href="/tutor/trials" />
        <Stat label="Conversion 90d" value={conversion === null ? '—' : `${conversion}%`} tone="neutral" href="/tutor/trials" />
      </div>
      {error && <p className="mt-2 text-[10px] text-rose-500">Couldn’t load trials: {error}</p>}
    </WidgetShell>
  )
}

function Stat({ label, value, tone, href }) {
  const toneCls = tone === 'red' ? 'text-rose-600' : tone === 'ok' ? 'text-emerald-700' : 'text-[#2A2035]'
  return (
    <Link href={href} className="rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] px-3 py-2 hover:border-[#BACBFF] transition block">
      <p className="text-[9px] tracking-[0.15em] uppercase text-[#325099]/70 font-semibold truncate">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${toneCls}`}>{value}</p>
    </Link>
  )
}

// Shared card shell so the home widgets all match.
export function WidgetShell({ title, eyebrow, action, children }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          {eyebrow && <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">{eyebrow}</p>}
          <h2 className="text-lg font-semibold text-[#2A2035] font-display">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

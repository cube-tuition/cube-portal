'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { CAMPAIGN_LABELS } from '../../../../lib/emailLogLabels'

/*
 * Sent emails — /tutor/emails/sent (directors)
 *
 * Every bulk email the portal has sent, one row per family, grouped by
 * campaign (sent_emails). Answers "did the Nguyens get the holiday email?"
 * without searching the office inbox: type a name or address to see every
 * campaign that reached them.
 */
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })

export default function SentEmailsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})   // campaign id → expanded
  const [showTests, setShowTests] = useState(false)

  useEffect(() => {
    getAuthProfile().then(async ({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)
      const { data } = await supabase.from('sent_emails')
        .select('id, sent_at, campaign_id, campaign, subject, to_email, to_name, status, error, is_test, meta')
        .order('sent_at', { ascending: false }).limit(5000)
      setRows(data || [])
    })
  }, [router])

  const query = q.trim().toLowerCase()
  const campaigns = useMemo(() => {
    const groups = new Map()
    for (const r of rows || []) {
      if (r.is_test && !showTests) continue
      if (query && !`${r.to_name || ''} ${r.to_email || ''} ${r.subject || ''}`.toLowerCase().includes(query)) continue
      const g = groups.get(r.campaign_id) || { id: r.campaign_id, campaign: r.campaign, subject: r.subject, sent_at: r.sent_at, is_test: r.is_test, rows: [] }
      g.rows.push(r)
      if (r.sent_at > g.sent_at) g.sent_at = r.sent_at
      groups.set(r.campaign_id, g)
    }
    return [...groups.values()].sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1))
  }, [rows, query, showTests])

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-4xl mx-auto px-4 pt-5 pb-24 md:px-6 md:pt-10">
        <Link href="/tutor/emails" className="text-xs font-semibold text-[#325099] hover:underline">← Emails</Link>
        <div className="mt-2 mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Sent emails</h1>
            <p className="text-sm text-[#325099]/60 mt-1">Every bulk email, one row per family. The office inbox gets one summary per campaign instead of a copy of each.</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-[#2A2035]/60 select-none">
            <input type="checkbox" checked={showTests} onChange={e => setShowTests(e.target.checked)} className="accent-[#325099]" /> Show test sends
          </label>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a family, an address or a subject…"
          className="w-full bg-white border border-[#DEE7FF] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#325099] mb-5" />

        {rows === null ? (
          <p className="text-sm text-[#2A2035]/40 animate-pulse">Loading…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-[#2A2035]/45 bg-white border border-[#DEE7FF] rounded-2xl px-5 py-8 text-center">
            {query ? 'No sends match.' : 'Nothing recorded yet — bulk emails sent from now on appear here.'}
          </p>
        ) : (
          <div className="space-y-3">
            {campaigns.map(g => {
              const sent = g.rows.filter(r => r.status === 'sent').length
              const failed = g.rows.length - sent
              const expanded = !!open[g.id] || !!query
              return (
                <div key={g.id} className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
                  <button onClick={() => setOpen(o => ({ ...o, [g.id]: !o[g.id] }))} className="w-full text-left px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-[#FBFCFF]">
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-[#DEE7FF] text-[#325099] px-2 py-0.5 rounded-full">{CAMPAIGN_LABELS[g.campaign] || g.campaign}</span>
                    {g.is_test && <span className="text-[10px] font-bold uppercase tracking-wider bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 rounded-full">Test</span>}
                    <span className="text-sm font-semibold text-[#062E63] flex-1 min-w-[12rem] truncate">{g.subject}</span>
                    <span className="text-xs text-[#2A2035]/50">{fmtWhen(g.sent_at)}</span>
                    <span className="text-xs font-semibold text-[#166534]">{sent} sent</span>
                    {failed > 0 && <span className="text-xs font-semibold text-[#991B1B]">{failed} failed</span>}
                    <span className="text-xs text-[#325099]">{expanded ? '▾' : '▸'}</span>
                  </button>
                  {expanded && (
                    <div className="border-t border-[#F0F4FF] divide-y divide-[#F6F8FF]">
                      {g.rows.map(r => (
                        <div key={r.id} className="px-5 py-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
                          <span className={`w-4 font-bold ${r.status === 'sent' ? 'text-[#166534]' : 'text-[#991B1B]'}`}>{r.status === 'sent' ? '✓' : '✗'}</span>
                          <span className="font-semibold text-[#2A2035] min-w-[9rem]">{r.to_name || '—'}</span>
                          <span className="text-[#2A2035]/60">{r.to_email || 'no address'}</span>
                          {r.meta?.students && <span className="text-[#2A2035]/45">{r.meta.students}</span>}
                          {r.meta?.invoice && <span className="text-[#2A2035]/45">{r.meta.invoiceAttached ? `invoice ${r.meta.invoice} attached` : `invoice ${r.meta.invoice} not attached`}</span>}
                          {r.error && <span className="text-[#991B1B]">{r.error}</span>}
                          <span className="ml-auto text-[#2A2035]/35">{fmtWhen(r.sent_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

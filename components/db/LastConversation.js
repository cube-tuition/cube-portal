'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { normalisePhone, formatPhone } from '../../lib/phone'
import { fmtTime } from '../../lib/useSmsInbox'

/*
 * LastConversation — the tail of a family's text thread on the office number,
 * shown inside the Families view of the database explorer. Reads the same
 * sms_messages rows the Messages inbox shows, for every guardian number on
 * file, and links through to that thread in Admin › Messages.
 *
 * `people`: [{ name, phone }] — guardians (and optionally the student) whose
 * numbers make up the family's conversation.
 */
const LIMIT = 5

export default function LastConversation({ people }) {
  const numbers = []
  for (const p of people || []) {
    const e = normalisePhone(p.phone)
    if (e && !numbers.some(n => n.phone === e)) numbers.push({ phone: e, name: p.name })
  }
  const key = numbers.map(n => n.phone).join(',')
  const [rows, setRows] = useState(null)   // null = loading

  useEffect(() => {
    if (!key) return   // nothing to load; the render below handles the no-number case
    let dead = false
    ;(async () => {
      const { data } = await supabase.from('sms_messages')
        .select('id, direction, phone, body, status, sent_by, created_at')
        .in('phone', key.split(','))
        .order('created_at', { ascending: false })
        .limit(LIMIT)
      if (!dead) setRows((data || []).reverse())
    })()
    const ch = supabase.channel(`family-sms:${key}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sms_messages' }, (p) => {
        const m = p.new
        if (m && key.split(',').includes(m.phone)) setRows(rs => [...(rs || []), m].slice(-LIMIT))
      })
      .subscribe()
    return () => { dead = true; supabase.removeChannel(ch) }
  }, [key])

  const nameFor = (phone) => numbers.find(n => n.phone === phone)?.name || formatPhone(phone)
  const threadHref = (phone) => `/tutor/admin/messages?phone=${encodeURIComponent(phone)}`

  if (!numbers.length) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-[#DEE7FF] px-4 py-3 text-[11px] text-[#2A2035]/40 italic">
        No phone number on file for this family, so there is no text thread to show.
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-[#E8EDF8] overflow-hidden">
      {rows === null ? (
        <p className="px-4 py-3 text-[11px] text-[#2A2035]/40 animate-pulse">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-3 text-[11px] text-[#2A2035]/40 italic">No texts with this family yet.</p>
      ) : (
        <div className="px-3 py-2.5 space-y-1.5">
          {rows.map(m => {
            const out = m.direction === 'out'
            return (
              <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${out ? 'bg-[#062E63] text-white rounded-br-sm' : 'bg-[#F0F4FF] text-[#2A2035] rounded-bl-sm'}`}>
                  <p className="text-[12px] leading-snug whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`text-[9px] mt-0.5 ${out ? 'text-white/60' : 'text-[#2A2035]/40'}`}>
                    {out ? (m.sent_by || 'CUBE') : nameFor(m.phone)} · {fmtTime(m.created_at)}
                    {out && m.status && ['failed', 'undelivered'].includes(m.status) ? ' · not delivered' : ''}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="border-t border-[#F0F4FF] px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
        {numbers.map(n => (
          <Link key={n.phone} href={threadHref(n.phone)} className="text-[11px] font-semibold text-[#325099] hover:underline">
            💬 {rows?.some(m => m.phone === n.phone) ? 'Open chat' : 'Start chat'} with {n.name || formatPhone(n.phone)} →
          </Link>
        ))}
      </div>
    </div>
  )
}

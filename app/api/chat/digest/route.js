import { createClient } from '@supabase/supabase-js'
import { requireCronSecret } from '../../../../lib/apiAuth'
import { PORTAL_BCC } from '../../../../lib/emailConfig'

/*
 * GET /api/chat/digest — daily (Vercel cron, 8am Sydney). Every staff member
 * with unread chat messages gets one email listing them by channel, so
 * nothing waits unseen for someone who does not open the portal that day.
 */
export const dynamic = 'force-dynamic'
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function GET(request) {
  const auth = requireCronSecret(request)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const [{ data: tutors }, { data: directors }, { data: members }, { data: reads }, { data: chans }] = await Promise.all([
    admin.from('tutors').select('id, full_name, email, active'),
    admin.from('directors').select('id, full_name, email'),
    admin.from('chat_members').select('channel_id, user_id'),
    admin.from('chat_reads').select('channel_id, user_id, last_read_at'),
    admin.from('chat_channels').select('id, kind, name'),
  ])
  const staff = [...(directors || []), ...(tutors || []).filter(t => t.active !== false)].filter(s => s.email)
  const nameOf = Object.fromEntries([...(tutors || []), ...(directors || [])].map(s => [s.id, s.full_name]))
  const chanById = Object.fromEntries((chans || []).map(c => [c.id, c]))
  const readAt = {}
  for (const r of reads || []) readAt[`${r.channel_id}:${r.user_id}`] = r.last_read_at
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.cubetuition.com.au').replace(/\/+$/, '')
  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const { data: msgs } = await admin.from('chat_messages').select('channel_id, sender_id, sender_name, body, created_at')
    .is('deleted_at', null).gte('created_at', since).order('created_at')
  let sent = 0
  for (const s of staff) {
    const myChans = (members || []).filter(m => m.user_id === s.id).map(m => m.channel_id)
    const sections = []
    for (const cid of myChans) {
      const last = readAt[`${cid}:${s.id}`] || '1970-01-01'
      const unread = (msgs || []).filter(m => m.channel_id === cid && m.sender_id !== s.id && m.created_at > last)
      if (!unread.length) continue
      const c = chanById[cid]
      const label = c?.kind === 'dm' ? (nameOf[unread[0].sender_id] || 'Direct message') : `#${c?.name || 'channel'}`
      sections.push({ cid, label, unread })
    }
    if (!sections.length) continue
    const total = sections.reduce((n, x) => n + x.unread.length, 0)
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#2A2035;max-width:560px">
      <p style="margin:0 0 12px">Hi ${esc((s.full_name || '').split(' ')[0])}, you have <strong>${total} unread message${total === 1 ? '' : 's'}</strong> in the staff chat.</p>
      ${sections.map(x => `<p style="margin:14px 0 4px;font-weight:700;color:#062E63">${esc(x.label)} · ${x.unread.length}</p>
        ${x.unread.slice(-3).map(m => `<div style="background:#F0F4FF;border-radius:10px;padding:8px 12px;margin:4px 0"><span style="color:#325099;font-weight:600">${esc(m.sender_name)}</span> · ${esc(m.body.slice(0, 200))}</div>`).join('')}
        <p style="margin:4px 0 0"><a href="${site}/tutor/chat?c=${x.cid}" style="color:#325099;font-weight:600">Open →</a></p>`).join('')}
      <p style="margin:18px 0 0;font-size:12px;color:#888">You get this once a day while messages are unread.</p></div>`
    if (!process.env.RESEND_API_KEY) continue
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || 'CUBE Tuition <admin@cubetuition.com.au>', to: [s.email], bcc: [PORTAL_BCC],
          subject: `${total} unread in the staff chat`, html }),
      })
      sent++
    } catch (e) { console.warn('[chat/digest]', s.email, e.message) }
  }
  return Response.json({ sent })
}

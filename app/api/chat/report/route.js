import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../lib/apiAuth'
import { sendPushToAll } from '../../../../lib/push'

/*
 * POST /api/chat/report  { messageId, reason? }
 *
 * Reports a message in a student conversation. Any signed-in member of the
 * conversation can (a student, a teacher, a director): the report is saved as
 * the caller — chat_report_message checks they're in the conversation — and
 * the directors get a push straight away. Directors resolve it in the thread.
 */
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const auth = await requireApiRole(req)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const messageId = String(body?.messageId || '')
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return Response.json({ error: 'messageId is required' }, { status: 400 })
  const reason = String(body?.reason || '').trim().slice(0, 500)

  // As the caller, so the database decides whether they may report it.
  const token = req.headers.get('authorization').slice(7)
  const asUser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  })
  const { data: reportId, error } = await asUser.rpc('chat_report_message', { p_message: messageId, p_reason: reason })
  if (error) return Response.json({ error: error.message }, { status: 400 })

  // What the directors need to see it: who said it, where, and the words.
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: msg } = await admin.from('chat_messages').select('sender_name, body, channel_id, chat_channels(name, kind, class_id)').eq('id', messageId).maybeSingle()
  const where = msg?.chat_channels?.class_id ? msg.chat_channels.name : 'a student thread'
  const said = String(msg?.body || '').replace(/\[\[(img|file):[^\]]*\]\]/g, '📎').slice(0, 120)
  const pushed = await sendPushToAll({
    title: `⚑ Message reported — ${where}`,
    body: [`${msg?.sender_name || 'Someone'}: “${said || '…'}”`, reason && `Reason: ${reason}`].filter(Boolean).join('\n'),
    url: '/tutor/admin/messages', tag: `chat-report-${reportId}`,
  }).then(r => r?.sent ?? 0).catch(() => 0)

  return Response.json({ ok: true, reportId, pushed })
}

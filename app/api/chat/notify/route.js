import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../lib/apiAuth'
import { sendPushToUsers } from '../../../../lib/push'

/*
 * POST /api/chat/notify { messageId }
 * After a message is sent: push everyone else in the conversation — the
 * other person of a DM, the teacher and other directors of a CUBE thread,
 * every member of a channel. Staff-only; the message must be the caller's.
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director', 'tutor'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    const { messageId } = await request.json()
    if (!messageId) return Response.json({ error: 'Missing messageId' }, { status: 400 })
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data: msg } = await admin.from('chat_messages').select('id, channel_id, sender_id, sender_name, body, as_cube').eq('id', messageId).maybeSingle()
    if (!msg || msg.sender_id !== auth.user.id) return Response.json({ error: 'Not your message' }, { status: 403 })
    const [{ data: chan }, { data: members }, { data: tutors }, { data: directors }] = await Promise.all([
      admin.from('chat_channels').select('id, kind, name').eq('id', msg.channel_id).maybeSingle(),
      admin.from('chat_members').select('user_id').eq('channel_id', msg.channel_id),
      admin.from('tutors').select('id, full_name'),
      admin.from('directors').select('id, full_name'),
    ])
    const memberIds = new Set((members || []).map(m => m.user_id))
    // Everyone in the conversation but the sender. (Channels used to push only
    // the people @mentioned, which meant most channel messages went unnoticed.)
    const staffIds = new Set([...(tutors || []), ...(directors || [])].map(s => s.id))
    const recipients = [...memberIds].filter(id => id !== msg.sender_id && staffIds.has(id))
    if (!recipients.length) return Response.json({ sent: 0 })
    const from = msg.as_cube ? 'CUBE' : (msg.sender_name || 'New message')
    const title = (chan?.kind === 'dm' || chan?.kind === 'cube_dm') ? from : `#${chan?.name || 'channel'} · ${from}`.trim()
    const preview = msg.body.replace(/\[\[img:[^\]]+\]\]/g, '📷 image').trim() || '📷 image'
    const { sent } = await sendPushToUsers(recipients, { title, body: preview.slice(0, 140), url: `/tutor/chat?c=${msg.channel_id}`, tag: `chat:${msg.channel_id}` })
    return Response.json({ sent })
  } catch (err) {
    console.error('[chat/notify]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../lib/apiAuth'
import { notifyChatMessage } from '../../../../lib/chatNotify'

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
    return Response.json(await notifyChatMessage(admin, msg))
  } catch (err) {
    console.error('[chat/notify]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

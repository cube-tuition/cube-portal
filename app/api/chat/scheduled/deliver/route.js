import { createClient } from '@supabase/supabase-js'
import { notifyChatMessage } from '../../../../../lib/chatNotify'

/*
 * GET /api/chat/scheduled/deliver — posts every scheduled chat message that is
 * due (chat_scheduled_messages.send_at has passed), then pushes it like a
 * message sent by hand.
 *
 * Called once a minute by the database's pg_cron job "chat-scheduled-delivery"
 * (migrations/20261014_chat_scheduled_messages_cron.sql). It needs no secret:
 * it only ever acts on messages whose time has come, so an extra call simply
 * delivers them a little sooner than the next tick would have.
 *
 * Each row is claimed (sent_at set) before it is posted, so two overlapping
 * calls never send the same message twice. At delivery the sender must still
 * be allowed to post there — the same rules as chat_messages_send — or the row
 * is closed with an error instead.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date().toISOString()
  const { data: due, error } = await admin.from('chat_scheduled_messages')
    .select('id, channel_id, sender_id, sender_name, body, as_cube')
    .is('sent_at', null).lte('send_at', now).order('send_at').limit(50)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  let delivered = 0
  for (const s of due || []) {
    // Claim it: only one caller gets the row back.
    const { data: claimed } = await admin.from('chat_scheduled_messages')
      .update({ sent_at: new Date().toISOString() }).eq('id', s.id).is('sent_at', null).select('id')
    if (!claimed?.length) continue
    const fail = (msg) => admin.from('chat_scheduled_messages').update({ error: msg }).eq('id', s.id)
    try {
      const [{ data: member }, { data: chan }, { data: director }] = await Promise.all([
        admin.from('chat_members').select('user_id').eq('channel_id', s.channel_id).eq('user_id', s.sender_id).maybeSingle(),
        admin.from('chat_channels').select('id, directors_only').eq('id', s.channel_id).maybeSingle(),
        admin.from('directors').select('id').eq('id', s.sender_id).maybeSingle(),
      ])
      if (!chan) { await fail('The conversation no longer exists.'); continue }
      if (!member) { await fail('You are no longer in this conversation.'); continue }
      if ((chan.directors_only || s.as_cube) && !director) { await fail('Only directors can post here.'); continue }
      const { data: msg, error: insErr } = await admin.from('chat_messages')
        .insert({ channel_id: s.channel_id, sender_id: s.sender_id, sender_name: s.as_cube ? 'CUBE' : s.sender_name, body: s.body, as_cube: s.as_cube })
        .select('id, channel_id, sender_id, sender_name, body, as_cube').single()
      if (insErr) { await fail(insErr.message); continue }
      await admin.from('chat_scheduled_messages').update({ sent_message_id: msg.id }).eq('id', s.id)
      delivered++
      try { await notifyChatMessage(admin, msg) } catch (e) { console.error('[chat/scheduled] push', e) }
    } catch (e) {
      console.error('[chat/scheduled]', e)
      await fail(e.message || 'Delivery failed.')
    }
  }
  return Response.json({ due: due?.length || 0, delivered })
}

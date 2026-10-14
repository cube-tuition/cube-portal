import { sendPushToUsers } from './push'

/*
 * Push a just-posted chat message to everyone else in its conversation — the
 * other person of a DM, the teacher and other directors of a CUBE thread,
 * every member of a channel — skipping members who muted it (unless
 * @mentioned), quiet channels, and student-audience channels. Server only:
 * `admin` is a service-role client. Used by /api/chat/notify (a message sent
 * now) and /api/chat/scheduled/deliver (a scheduled one going out).
 * Returns { sent } or { skipped }.
 */
export async function notifyChatMessage(admin, msg) {
  const [{ data: chan }, { data: members }, { data: tutors }, { data: directors }] = await Promise.all([
    admin.from('chat_channels').select('id, kind, name, quiet, audience').eq('id', msg.channel_id).maybeSingle(),
    admin.from('chat_members').select('user_id, muted').eq('channel_id', msg.channel_id),
    admin.from('tutors').select('id, full_name'),
    admin.from('directors').select('id, full_name'),
  ])
  // Student channels are directors-only until published: no pushes to anyone.
  if (chan?.audience === 'students') return { skipped: 'students audience' }
  const memberIds = new Set((members || []).map(m => m.user_id))
  // Everyone in the conversation but the sender — except members who muted
  // the channel, who still hear about it when they are @mentioned.
  const staff = [...(tutors || []), ...(directors || [])]
  const staffIds = new Set(staff.map(s => s.id))
  const mutedIds = new Set((members || []).filter(m => m.muted).map(m => m.user_id))
  const mentioned = new Set(staff.filter(s => s.full_name && msg.body.includes('@' + s.full_name)).map(s => s.id))
  // A quiet channel (set by a director) behaves as if everyone had muted it.
  const recipients = [...memberIds].filter(id => id !== msg.sender_id && staffIds.has(id) && ((!mutedIds.has(id) && !chan?.quiet) || mentioned.has(id)))
  if (!recipients.length) return { sent: 0 }
  const from = msg.as_cube ? 'CUBE' : (msg.sender_name || 'New message')
  const title = (chan?.kind === 'dm' || chan?.kind === 'cube_dm') ? from : `#${chan?.name || 'channel'} · ${from}`.trim()
  const preview = msg.body.replace(/\[\[img:[^\]]+\]\]/g, '📷 image').trim() || '📷 image'
  const { sent } = await sendPushToUsers(recipients, { title, body: preview.slice(0, 140), url: `/tutor/chat?c=${msg.channel_id}`, tag: `chat:${msg.channel_id}` })
  return { sent }
}

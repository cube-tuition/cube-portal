import { sendPushToUsers } from './push'

/*
 * Push a just-posted chat message to everyone else in its conversation — the
 * other person of a DM, the teacher and other directors of a CUBE thread,
 * every member of a channel — skipping members who muted it (unless
 * @mentioned) and quiet channels. Server only: `admin` is a service-role
 * client. Used by /api/chat/notify (a message sent now) and
 * /api/chat/scheduled/deliver (a scheduled one going out).
 *
 * Student messaging (a channel with audience 'students'): the students in
 * the conversation hear about it too, and everyone is sent to the page that
 * shows it — directors to the Messages inbox, teachers to the staff chat,
 * students to /chat. Returns { sent } or { skipped }.
 *
 * A message sent as CUBE never pushes the directors: it came from one of them,
 * so the other director doesn't need a notification for their own side.
 */
export async function notifyChatMessage(admin, msg) {
  const [{ data: chan }, { data: members }, { data: tutors }, { data: directors }] = await Promise.all([
    admin.from('chat_channels').select('id, kind, name, quiet, audience').eq('id', msg.channel_id).maybeSingle(),
    admin.from('chat_members').select('user_id, muted').eq('channel_id', msg.channel_id),
    admin.from('tutors').select('id, full_name'),
    admin.from('directors').select('id, full_name'),
  ])
  const memberIds = new Set((members || []).map(m => m.user_id))
  const forStudents = chan?.audience === 'students'
  // Everyone in the conversation but the sender — except members who muted
  // the channel, who still hear about it when they are @mentioned.
  const staff = [...(tutors || []), ...(directors || [])]
  const tutorIds = new Set((tutors || []).map(t => t.id))
  const directorIds = new Set((directors || []).map(d => d.id))
  const staffIds = new Set(staff.map(s => s.id))
  const mutedIds = new Set((members || []).filter(m => m.muted).map(m => m.user_id))
  const mentioned = new Set(staff.filter(s => s.full_name && msg.body.includes('@' + s.full_name)).map(s => s.id))
  // A quiet channel (set by a director) behaves as if everyone had muted it.
  const hears = (id) => id !== msg.sender_id && ((!mutedIds.has(id) && !chan?.quiet) || mentioned.has(id))
  const recipients = [...memberIds].filter(id => (staffIds.has(id) || forStudents) && hears(id)
    && !(msg.as_cube && directorIds.has(id)))
  if (!recipients.length) return { sent: 0 }
  const from = msg.as_cube ? 'CUBE' : (msg.sender_name || 'New message')
  const isDm = chan?.kind === 'dm' || chan?.kind === 'cube_dm'
  const title = isDm ? from : `${forStudents ? '' : '#'}${chan?.name || 'channel'} · ${from}`.trim()
  const preview = msg.body.replace(/\[\[img:[^\]]+\]\]/g, '📷 image').replace(/\[\[file:[^\]]+\]\]/g, '📎 file').trim() || '📷 image'
  const body = preview.slice(0, 140)
  const tag = `chat:${msg.channel_id}`
  // Each group is sent to the page that shows this conversation for them.
  const groups = [
    { ids: recipients.filter(id => directorIds.has(id)), url: forStudents ? '/messages' : `/tutor/chat?c=${msg.channel_id}` },
    { ids: recipients.filter(id => tutorIds.has(id)), url: `/tutor/chat?c=${msg.channel_id}` },
    { ids: recipients.filter(id => !staffIds.has(id)), url: `/chat?c=${msg.channel_id}` },
  ]
  let sent = 0
  for (const g of groups) {
    if (!g.ids.length) continue
    const res = await sendPushToUsers(g.ids, { title, body, url: g.url, tag })
    sent += res.sent || 0
  }
  return { sent }
}

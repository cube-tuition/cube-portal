import { supabase } from './supabase'
import { T_CHAT_CHANNELS, T_CHAT_MEMBERS, T_CHAT_MESSAGES, T_CHAT_READS, T_TUTORS, T_ADMINS } from './tables'

/*
 * Staff chat — client helpers shared by the chat page and the nav badge.
 * Everything goes through RLS: a member sees a channel's messages, nobody
 * else does. See migrations/20260930_staff_chat.sql.
 */

export const PAGE_SIZE = 200

/** Everyone who can be messaged: tutors (active) and directors. */
export async function loadStaffDirectory() {
  const [{ data: t }, { data: d }] = await Promise.all([
    supabase.from(T_TUTORS).select('id, full_name, active').order('full_name'),
    supabase.from(T_ADMINS).select('id, full_name').order('full_name'),
  ])
  const list = [
    ...(d || []).map(x => ({ id: x.id, full_name: x.full_name, role: 'director' })),
    ...(t || []).filter(x => x.active !== false).map(x => ({ id: x.id, full_name: x.full_name, role: 'tutor' })),
  ]
  return list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
}

/** Channels the caller can see, with their membership and, for DMs, the other person. */
export async function loadChannels(meId) {
  const [{ data: chans }, { data: mems }] = await Promise.all([
    supabase.from(T_CHAT_CHANNELS).select('id, kind, name, dm_key, created_by, created_at').order('name'),
    supabase.from(T_CHAT_MEMBERS).select('channel_id, user_id'),
  ])
  const membersOf = {}
  for (const m of mems || []) (membersOf[m.channel_id] ||= []).push(m.user_id)
  return (chans || []).map(c => ({
    ...c,
    members: membersOf[c.id] || [],
    mine: (membersOf[c.id] || []).includes(meId),
    otherId: c.kind === 'dm' ? (membersOf[c.id] || []).find(u => u !== meId) || null : null,
  }))
}

export async function loadMessages(channelId, { before = null, limit = PAGE_SIZE } = {}) {
  let q = supabase.from(T_CHAT_MESSAGES).select('*').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(limit)
  if (before) q = q.lt('created_at', before)
  const { data, error } = await q
  if (error) throw error
  return (data || []).reverse()
}

export async function sendMessage({ channelId, senderId, senderName, body }) {
  const text = String(body || '').trim()
  if (!text) return null
  const { data, error } = await supabase.from(T_CHAT_MESSAGES)
    .insert({ channel_id: channelId, sender_id: senderId, sender_name: senderName || '', body: text }).select('*').single()
  if (error) throw error
  return data
}
export async function editMessage(id, body) {
  const { error } = await supabase.from(T_CHAT_MESSAGES).update({ body: String(body || '').trim(), edited_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
export async function deleteMessage(id) {
  const { error } = await supabase.from(T_CHAT_MESSAGES).update({ deleted_at: new Date().toISOString(), body: '' }).eq('id', id)
  if (error) throw error
}

export async function markRead(channelId, userId) {
  await supabase.from(T_CHAT_READS).upsert({ channel_id: channelId, user_id: userId, last_read_at: new Date().toISOString() }, { onConflict: 'channel_id,user_id' })
}
/** { channelId: unread } for the caller. */
export async function loadUnread() {
  const { data } = await supabase.rpc('chat_unread_counts')
  const out = {}
  for (const r of data || []) out[r.channel_id] = Number(r.n) || 0
  return out
}
export async function createChannel(name) {
  const { data, error } = await supabase.rpc('chat_create_channel', { p_name: name })
  if (error) throw error
  return data
}
export async function openDm(otherId) {
  const { data, error } = await supabase.rpc('chat_open_dm', { p_other: otherId })
  if (error) throw error
  return data
}
export async function renameChannel(channelId, name) {
  const { error } = await supabase.rpc('chat_rename_channel', { p_channel: channelId, p_name: name })
  if (error) throw error
}
export async function deleteChannel(channelId) {
  const { error } = await supabase.rpc('chat_delete_channel', { p_channel: channelId })
  if (error) throw error
}
export async function joinChannel(channelId, userId) {
  const { error } = await supabase.from(T_CHAT_MEMBERS).insert({ channel_id: channelId, user_id: userId })
  if (error && error.code !== '23505') throw error
}
export async function leaveChannel(channelId, userId) {
  const { error } = await supabase.from(T_CHAT_MEMBERS).delete().eq('channel_id', channelId).eq('user_id', userId)
  if (error) throw error
}

// ── Rendering ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Message text → safe HTML: links, **bold**, _italic_, `code`, @mentions. */
export function renderBody(text, staffNames = []) {
  let h = esc(text)
  h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer" class="underline text-[#325099]">${u}</a>`)
  h = h.replace(/`([^`\n]+)`/g, '<code class="px-1 rounded bg-[#F0F4FF] text-[12px]">$1</code>')
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<em>$2</em>')
  for (const name of [...staffNames].sort((a, b) => b.length - a.length)) {
    if (!name) continue
    h = h.split('@' + esc(name)).join(`<span class="font-semibold text-[#062E63] bg-[#DEE7FF] rounded px-1">@${esc(name)}</span>`)
  }
  return h.replace(/\n/g, '<br/>')
}
/** Names @mentioned in a body, from the staff list. */
export function mentionedIds(body, staff = []) {
  const t = String(body || '')
  return staff.filter(s => s.full_name && t.includes('@' + s.full_name)).map(s => s.id)
}

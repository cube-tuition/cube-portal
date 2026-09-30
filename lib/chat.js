import { supabase } from './supabase'
import { uploadQbankImage, qbankImageUrl } from './qbank'
import { T_CHAT_CHANNELS, T_CHAT_MEMBERS, T_CHAT_MESSAGES, T_CHAT_READS, T_CHAT_REACTIONS, T_TUTORS, T_ADMINS } from './tables'

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
    supabase.from(T_CHAT_CHANNELS).select('id, kind, name, dm_key, created_by, is_default, directors_only, created_at').order('name'),
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
/** When each member of a channel last read it → { userId: ISO time }. */
export async function loadReads(channelId) {
  const { data, error } = await supabase.from(T_CHAT_READS).select('user_id, last_read_at').eq('channel_id', channelId)
  if (error) throw error
  const out = {}
  for (const r of data || []) out[r.user_id] = r.last_read_at
  return out
}

/** Directors only may post in an announcement channel (directors flip this). */
export async function setDirectorsOnly(channelId, on) {
  const { error } = await supabase.rpc('chat_set_directors_only', { p_channel: channelId, p_on: on })
  if (error) throw error
}

export async function renameChannel(channelId, name) {
  const { error } = await supabase.rpc('chat_rename_channel', { p_channel: channelId, p_name: name })
  if (error) throw error
}
export async function deleteChannel(channelId) {
  const { error } = await supabase.rpc('chat_delete_channel', { p_channel: channelId })
  if (error) throw error
}
export async function addMember(channelId, userId) {
  const { error } = await supabase.rpc('chat_add_member', { p_channel: channelId, p_user: userId })
  if (error) throw error
}
export async function removeMember(channelId, userId) {
  const { error } = await supabase.rpc('chat_remove_member', { p_channel: channelId, p_user: userId })
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

// ── Reactions ─────────────────────────────────────────────────────────────────
export const QUICK_EMOJI = ['👍', '✅', '❤️', '😂', '🎉', '👀', '🙏', '🔥']
/** { messageId: [{ emoji, user_id }] } for the given messages. */
export async function loadReactions(messageIds) {
  if (!messageIds?.length) return {}
  const { data } = await supabase.from(T_CHAT_REACTIONS).select('message_id, user_id, emoji').in('message_id', messageIds)
  const out = {}
  for (const r of data || []) (out[r.message_id] ||= []).push({ emoji: r.emoji, user_id: r.user_id })
  return out
}
export async function toggleReaction(messageId, userId, emoji, on) {
  const { error } = on
    ? await supabase.from(T_CHAT_REACTIONS).insert({ message_id: messageId, user_id: userId, emoji })
    : await supabase.from(T_CHAT_REACTIONS).delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji)
  if (error && error.code !== '23505') throw error
}

// ── Search ────────────────────────────────────────────────────────────────────
// Words match against the message text; "from:name" narrows to a sender.
// RLS keeps it to channels the caller is in.
export async function searchMessages(query, { limit = 60 } = {}) {
  let q = String(query || '').trim()
  let sender = null
  q = q.replace(/\bfrom:("[^"]+"|\S+)/gi, (_, who) => { sender = who.replace(/^"|"$/g, ''); return '' }).trim()
  if (!q && !sender) return []
  let req = supabase.from(T_CHAT_MESSAGES).select('id, channel_id, sender_id, sender_name, body, created_at').is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(limit)
  if (q) req = req.textSearch('body', q, { type: 'websearch', config: 'english' })
  if (sender) req = req.ilike('sender_name', `%${sender}%`)
  const { data, error } = await req
  if (error) throw error
  return data || []
}

// ── Files ─────────────────────────────────────────────────────────────────────
// Any other file (a PDF, a marked paper) travels the same way as an image,
// referenced as [[file:URL|name|bytes]] and shown as a chip.
export const FILE_RE = /\[\[file:(https?:\/\/[^\]\s|]+)\|([^\]|]*)\|(\d*)\]\]/g
export async function uploadChatFile(file, channelId) {
  if (!file) throw new Error('No file')
  if (file.size > 20 * 1024 * 1024) throw new Error('Files must be under 20 MB.')
  const path = await uploadQbankImage(file, `chat/${channelId}`)
  return { url: qbankImageUrl(path), name: file.name || 'file', size: file.size || 0 }
}
export const fileMarker = ({ url, name, size }) => `[[file:${url}|${String(name).replace(/[|\]]/g, '')}|${size || ''}]]`
export const fmtBytes = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`

// ── Images ────────────────────────────────────────────────────────────────────
// An attached image is uploaded to the images bucket and referenced in the
// message body as [[img:URL]], so no schema change was needed and every copy
// of the page renders it the same way.
export const IMG_RE = /\[\[img:(https?:\/\/[^\]\s]+)\]\]/g
export async function uploadChatImage(file, channelId) {
  if (!file?.type?.startsWith('image/')) throw new Error('Only images can be attached.')
  if (file.size > 8 * 1024 * 1024) throw new Error('Images must be under 8 MB.')
  const path = await uploadQbankImage(file, `chat/${channelId}`)
  return qbankImageUrl(path)
}
export const imageMarker = (url) => `[[img:${url}]]`
/** Body with image markers replaced by a word, for previews and pushes. */
export const bodyPreview = (body) => String(body || '').replace(IMG_RE, '📷 image').replace(FILE_RE, (_, u, n) => `📎 ${n || 'file'}`).trim() || '📷 image'

// ── Rendering ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Message text → safe HTML: links, **bold**, _italic_, `code`, @mentions. */
export function renderBody(text, staffNames = []) {
  // Images first, kept out of the text passes behind placeholders.
  const imgs = [], files = []
  const withPh = String(text ?? '')
    .replace(IMG_RE, (_, url) => { imgs.push(url); return `\uE000${imgs.length - 1}\uE001` })
    .replace(FILE_RE, (_, url, name, size) => { files.push({ url, name, size: Number(size) || 0 }); return `\uE002${files.length - 1}\uE003` })
  let h = esc(withPh)
  h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer" class="underline text-[#325099]">${u}</a>`)
  h = h.replace(/`([^`\n]+)`/g, '<code class="px-1 rounded bg-[#F0F4FF] text-[12px]">$1</code>')
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<em>$2</em>')
  for (const name of [...staffNames].sort((a, b) => b.length - a.length)) {
    if (!name) continue
    h = h.split('@' + esc(name)).join(`<span class="font-semibold text-[#062E63] bg-[#DEE7FF] rounded px-1">@${esc(name)}</span>`)
  }
  h = h.replace(/\uE002(\d+)\uE003/g, (_, i) => { const f = files[i]; return `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 my-1 px-3 py-1.5 rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] text-[#062E63] no-underline"><span>📎</span><span class="font-semibold text-[13px]">${esc(f.name || 'file')}</span>${f.size ? `<span class="text-[11px] text-[#2A2035]/45">${fmtBytes(f.size)}</span>` : ''}</a>` })
  h = h.replace(/\uE000(\d+)\uE001/g, (_, i) => `<a href="${esc(imgs[i])}" target="_blank" rel="noopener noreferrer" class="block my-1"><img src="${esc(imgs[i])}" alt="" class="max-w-[360px] max-h-[320px] rounded-xl border border-[#DEE7FF] object-contain" /></a>`)
  return h.replace(/\n/g, '<br/>')
}
/** Names @mentioned in a body, from the staff list. */
export function mentionedIds(body, staff = []) {
  const t = String(body || '')
  return staff.filter(s => s.full_name && t.includes('@' + s.full_name)).map(s => s.id)
}

// ── Pins ──────────────────────────────────────────────────────────────────────
// A member's pinned channels, kept in portal_settings under their own key so
// they follow the person between devices. Order is the order they were pinned.
const pinsKey = (userId) => `chat_pins:${userId}`
const parsePins = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }
export async function loadPins(userId) {
  const { data } = await supabase.from('portal_settings').select('value').eq('key', pinsKey(userId)).maybeSingle()
  if (data?.value) return parsePins(data.value)
  try { return parsePins(localStorage.getItem(pinsKey(userId))) } catch { return [] }
}
export async function savePins(userId, ids) {
  // Always mirrored in this browser; the server copy makes it follow the person.
  try { localStorage.setItem(pinsKey(userId), JSON.stringify(ids)) } catch { /* storage blocked */ }
  await supabase.from('portal_settings').upsert({ key: pinsKey(userId), value: JSON.stringify(ids), updated_at: new Date().toISOString() })
}

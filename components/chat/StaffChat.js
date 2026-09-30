'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import {
  loadStaffDirectory, loadChannels, loadMessages, sendMessage, editMessage, deleteMessage,
  markRead, loadUnread, createChannel, openDm, joinChannel, leaveChannel, renderBody,
} from '../../lib/chat'

/*
 * StaffChat — the teachers' chat, embeddable: the full page at /tutor/chat
 * wraps it in the portal nav, and the directors' inboxes (web and phone)
 * show it behind a "Staff" tab beside the family texts.
 *
 * Channels on the left (open to every teacher; #staff has everyone), direct
 * messages below them, the conversation on the right. Messages arrive live
 * over realtime with the workbook's refetch-on-wake safety net; a DM or an
 * @mention also pushes to the other person's phone, and unread messages are
 * emailed once a day to anyone who has not been in.
 *
 * `me` = { id (auth uid), full_name, isAdmin }.
 */

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
const dayKey = (iso) => new Date(iso).toDateString()
const fmtDay = (iso) => {
  const d = new Date(iso), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}
const initials = (n) => (n || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase()
const AVATAR = ['#325099', '#7C3AED', '#047857', '#C2410C', '#BE185D', '#0E7490', '#A16207', '#4338CA']
const colorFor = (id) => AVATAR[[...String(id || '')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR.length]

export default function StaffChat({ me, initialChannel = '', className = 'h-[calc(100dvh-64px)]' }) {
  const [staff, setStaff] = useState([])
  const [channels, setChannels] = useState([])
  const [unread, setUnread] = useState({})
  const [active, setActive] = useState(initialChannel || '')
  const [messages, setMessages] = useState(null)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(null)  // message id being edited
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mention, setMention] = useState(null)  // { query, at } while typing an @name
  const [err, setErr] = useState('')
  const listRef = useRef(null)
  const taRef = useRef(null)
  const activeRef = useRef(active)
  useEffect(() => { activeRef.current = active }, [active])

  const staffById = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s])), [staff])
  const nameOf = useCallback((id) => staffById[id]?.full_name || 'Former staff', [staffById])
  const channelLabel = useCallback((c) => c.kind === 'dm' ? nameOf(c.otherId) : `#${c.name}`, [nameOf])

  const refreshChannels = useCallback(async (uid) => {
    const [cs, un] = await Promise.all([loadChannels(uid), loadUnread()])
    setChannels(cs); setUnread(un)
    return cs
  }, [])

  // ── Boot ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!me?.id) return
    (async () => {
      const [dir, cs] = await Promise.all([loadStaffDirectory(), refreshChannels(me.id)])
      setStaff(dir)
      if (!activeRef.current) {
        const staffChan = cs.find(ch => ch.kind === 'channel' && ch.name === 'staff') || cs.find(ch => ch.mine)
        if (staffChan) { activeRef.current = staffChan.id; setActive(staffChan.id) }
      }
    })()
  }, [me?.id, refreshChannels])

  // ── Conversation ───────────────────────────────────────────────────────────
  const loadConversation = useCallback(async () => {
    if (!active || !me) return
    try { setMessages(await loadMessages(active)); setErr('') }
    catch (e) { setErr(e.message || 'Could not load messages'); setMessages([]) }
  }, [active, me])
  useEffect(() => { const t = setTimeout(loadConversation, 0); return () => clearTimeout(t) }, [loadConversation])
  const selectChannel = (id) => { if (id !== active) { setMessages(null); setEditing(null); setText('') } setActive(id); setSidebarOpen(false) }
  // Seen: whenever this conversation is open and its messages are loaded.
  useEffect(() => {
    if (!active || !me || messages === null) return
    markRead(active, me.id).then(() => setUnread(u => (u[active] ? { ...u, [active]: 0 } : u)))
  }, [active, me, messages])
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [messages])

  // Live: every message insert/update. Ours for the open conversation, and
  // the unread map for everything else.
  useEffect(() => {
    if (!me) return
    const ch = supabase.channel(`chat:${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, (p) => {
        const r = p.new
        if (!r) return
        if (r.channel_id === activeRef.current) {
          setMessages(ms => {
            if (!ms) return ms
            const i = ms.findIndex(m => m.id === r.id)
            if (i >= 0) { const n = ms.slice(); n[i] = r; return n }
            return [...ms, r]
          })
        } else if (p.eventType === 'INSERT' && r.sender_id !== me.id) {
          setUnread(u => ({ ...u, [r.channel_id]: (u[r.channel_id] || 0) + 1 }))
          // A DM from someone new appears in the list only after a refresh.
          setChannels(cs => (cs.some(c => c.id === r.channel_id) ? cs : cs)); refreshChannels(me.id)
        }
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') { loadConversation(); refreshChannels(me.id) } })
    const onWake = () => { if (document.visibilityState === 'visible') { loadConversation(); refreshChannels(me.id) } }
    document.addEventListener('visibilitychange', onWake); window.addEventListener('focus', onWake); window.addEventListener('online', onWake)
    const beat = setInterval(onWake, 20000)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onWake); window.removeEventListener('focus', onWake); window.removeEventListener('online', onWake); clearInterval(beat) }
  }, [me, loadConversation, refreshChannels])

  // ── Actions ────────────────────────────────────────────────────────────────
  const current = channels.find(c => c.id === active) || null
  const send = async () => {
    const body = text.trim()
    if (!body || !current || !me) return
    setText(''); setMention(null)
    try {
      if (editing) { await editMessage(editing, body); setEditing(null); return }
      const m = await sendMessage({ channelId: current.id, senderId: me.id, senderName: me.full_name, body })
      setMessages(ms => (ms && !ms.some(x => x.id === m.id) ? [...ms, m] : ms))
      authedFetch('/api/chat/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: m.id }) }).catch(() => {})
    } catch (e) { setErr(e.message || 'Could not send'); setText(body) }
  }
  const onKey = (e) => {
    if (mention && (e.key === 'Enter' || e.key === 'Tab') && mentionMatches.length) { e.preventDefault(); pickMention(mentionMatches[0]); return }
    if (e.key === 'Escape') { setMention(null); if (editing) { setEditing(null); setText('') } }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }
  const onChange = (e) => {
    const v = e.target.value; setText(v)
    const upto = v.slice(0, e.target.selectionStart)
    const m = upto.match(/@([\w' -]{0,30})$/)
    setMention(m ? { query: m[1], at: upto.length - m[0].length } : null)
  }
  const mentionMatches = (() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return staff.filter(s => s.id !== me?.id && (!q || s.full_name.toLowerCase().includes(q))).slice(0, 6)
  })()
  const pickMention = (s) => {
    const ta = taRef.current
    const caret = ta ? ta.selectionStart : text.length
    const next = text.slice(0, mention.at) + '@' + s.full_name + ' ' + text.slice(caret)
    setText(next); setMention(null)
    requestAnimationFrame(() => { if (ta) { ta.focus(); const p = mention.at + s.full_name.length + 2; ta.setSelectionRange(p, p) } })
  }
  const startEdit = (m) => { setEditing(m.id); setText(m.body); taRef.current?.focus() }
  const remove = async (m) => { if (!confirm('Delete this message?')) return; try { await deleteMessage(m.id) } catch (e) { setErr(e.message) } }
  const newChannel = async () => {
    const name = prompt('Channel name (e.g. maths-team)')
    if (!name?.trim()) return
    const clean = name.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 40)
    if (!clean) return
    try { const id = await createChannel(clean); await refreshChannels(me.id); selectChannel(id) } catch (e) { setErr(e.message) }
  }
  const startDm = async (other) => {
    try { const id = await openDm(other.id); await refreshChannels(me.id); selectChannel(id) } catch (e) { setErr(e.message) }
  }
  const join = async (c) => { try { await joinChannel(c.id, me.id); await refreshChannels(me.id) } catch (e) { setErr(e.message) } }
  const leave = async (c) => { if (!confirm(`Leave #${c.name}?`)) return; try { await leaveChannel(c.id, me.id); await refreshChannels(me.id); if (active === c.id) setActive('') } catch (e) { setErr(e.message) } }

  if (!me) return null

  const open = channels.filter(c => c.kind === 'channel')
  const dms = channels.filter(c => c.kind === 'dm').sort((a, b) => (unread[b.id] || 0) - (unread[a.id] || 0) || nameOf(a.otherId).localeCompare(nameOf(b.otherId)))
  const others = staff.filter(s => s.id !== me.id)
  const staffNames = staff.map(s => s.full_name)
  const totalUnread = Object.values(unread).reduce((n, v) => n + v, 0)

  const Sidebar = (
    <aside className="w-64 shrink-0 bg-white border-r border-[#DEE7FF] flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-[#F0F4FF]">
        <p className="text-sm font-bold text-[#062E63]">Staff chat</p>
        <p className="text-[11px] text-[#2A2035]/45">{totalUnread ? `${totalUnread} unread` : 'All caught up'}</p>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 py-1">Channels</p>
          <button onClick={newChannel} className="text-[11px] font-semibold text-[#325099] hover:underline">+ New</button>
        </div>
        {open.map(c => (
          <button key={c.id} onClick={() => selectChannel(c.id)}
            className={`w-full text-left px-4 py-1.5 flex items-center gap-2 text-sm ${active === c.id ? 'bg-[#DEE7FF] text-[#062E63] font-semibold' : 'text-[#2A2035]/80 hover:bg-[#F8FAFF]'}`}>
            <span className={`truncate flex-1 ${!c.mine ? 'opacity-50' : ''}`}># {c.name}</span>
            {!c.mine && <span className="text-[10px] text-[#325099]">join</span>}
            {unread[c.id] > 0 && <span className="text-[10px] font-bold bg-[#B23A3A] text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{unread[c.id]}</span>}
          </button>
        ))}
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 px-3 pt-4 pb-1">Direct messages</p>
        {dms.map(c => (
          <button key={c.id} onClick={() => selectChannel(c.id)}
            className={`w-full text-left px-4 py-1.5 flex items-center gap-2 text-sm ${active === c.id ? 'bg-[#DEE7FF] text-[#062E63] font-semibold' : 'text-[#2A2035]/80 hover:bg-[#F8FAFF]'}`}>
            <span className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0" style={{ background: colorFor(c.otherId) }}>{initials(nameOf(c.otherId))}</span>
            <span className="truncate flex-1">{nameOf(c.otherId)}</span>
            {unread[c.id] > 0 && <span className="text-[10px] font-bold bg-[#B23A3A] text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{unread[c.id]}</span>}
          </button>
        ))}
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 px-3 pt-4 pb-1">Everyone</p>
        {others.filter(s => !dms.some(c => c.otherId === s.id)).map(s => (
          <button key={s.id} onClick={() => startDm(s)} className="w-full text-left px-4 py-1.5 flex items-center gap-2 text-sm text-[#2A2035]/70 hover:bg-[#F8FAFF]">
            <span className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0" style={{ background: colorFor(s.id) }}>{initials(s.full_name)}</span>
            <span className="truncate flex-1">{s.full_name}</span>
            <span className="text-[10px] text-[#2A2035]/35">{s.role === 'director' ? 'director' : ''}</span>
          </button>
        ))}
      </div>
    </aside>
  )

  return (
    <div className={`flex flex-col bg-[#F8FAFF] ${className}`}>
      <div className="flex-1 min-h-0 flex">
        <div className="hidden md:flex h-full">{Sidebar}</div>
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex" onClick={() => setSidebarOpen(false)}>
            <div className="h-full" onClick={e => e.stopPropagation()}>{Sidebar}</div>
            <div className="flex-1 bg-black/30" />
          </div>
        )}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="px-4 py-3 bg-white border-b border-[#DEE7FF] flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden text-[#325099] text-lg">☰</button>
            {current ? (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#062E63] truncate">{channelLabel(current)}</p>
                  <p className="text-[11px] text-[#2A2035]/45 truncate">
                    {current.kind === 'dm' ? 'Direct message · only the two of you' : `${current.members.length} member${current.members.length === 1 ? '' : 's'} · ${current.members.map(nameOf).map(n => n.split(' ')[0]).join(', ')}`}
                  </p>
                </div>
                {current.kind === 'channel' && (current.mine
                  ? (current.name !== 'staff' && <button onClick={() => leave(current)} className="text-[11px] font-semibold text-[#2A2035]/40 hover:text-[#B23A3A]">Leave</button>)
                  : <button onClick={() => join(current)} className="text-xs font-semibold rounded-full px-3 py-1 bg-[#062E63] text-white">Join channel</button>)}
              </>
            ) : <p className="text-sm text-[#2A2035]/50">Pick a channel or a person.</p>}
          </div>
          {err && <p className="px-4 py-2 text-xs text-[#B23A3A] bg-rose-50 border-b border-rose-100">{err}</p>}

          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            {!current ? null : messages === null ? (
              <p className="text-xs text-[#2A2035]/40 text-center py-10 animate-pulse">Loading…</p>
            ) : !current.mine ? (
              <p className="text-sm text-[#2A2035]/50 text-center py-10">Join #{current.name} to read and post.</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-[#2A2035]/40 text-center py-10">Nothing here yet — say hello.</p>
            ) : messages.map((m, i) => {
              const prev = messages[i - 1]
              const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at)
              const grouped = !newDay && prev && prev.sender_id === m.sender_id && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60000
              const mine = m.sender_id === me.id
              return (
                <div key={m.id}>
                  {newDay && <div className="flex items-center gap-3 my-4"><div className="flex-1 h-px bg-[#DEE7FF]" /><span className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60">{fmtDay(m.created_at)}</span><div className="flex-1 h-px bg-[#DEE7FF]" /></div>}
                  <div className={`group flex gap-3 ${grouped ? 'mt-0.5' : 'mt-3'}`}>
                    <div className="w-8 shrink-0">
                      {!grouped && <span className="w-8 h-8 rounded-full text-[11px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(m.sender_id) }}>{initials(m.sender_name || nameOf(m.sender_id))}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      {!grouped && <p className="text-[12px] leading-tight"><span className="font-bold text-[#062E63]">{m.sender_name || nameOf(m.sender_id)}</span> <span className="text-[10px] text-[#2A2035]/40 ml-1">{fmtTime(m.created_at)}</span></p>}
                      {m.deleted_at
                        ? <p className="text-[13px] italic text-[#2A2035]/35">message deleted</p>
                        : <p className={`text-[14px] leading-relaxed text-[#2A2035] break-words ${editing === m.id ? 'bg-[#FFFBEB] rounded px-1 -mx-1' : ''}`} dangerouslySetInnerHTML={{ __html: renderBody(m.body, staffNames) + (m.edited_at ? ' <span class="text-[10px] text-[#2A2035]/35">(edited)</span>' : '') }} />}
                    </div>
                    {mine && !m.deleted_at && (
                      <div className="opacity-0 group-hover:opacity-100 flex items-start gap-2 text-[11px] shrink-0">
                        <button onClick={() => startEdit(m)} className="text-[#325099] hover:underline">Edit</button>
                        <button onClick={() => remove(m)} className="text-[#2A2035]/40 hover:text-[#B23A3A]">Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {current && current.mine && (
            <div className="relative px-4 pb-4 pt-2 bg-white border-t border-[#DEE7FF]">
              {mention && mentionMatches.length > 0 && (
                <div className="absolute bottom-full left-4 mb-1 bg-white border border-[#BACBFF] rounded-xl shadow-xl overflow-hidden w-64 z-10">
                  {mentionMatches.map((s, i) => (
                    <button key={s.id} onMouseDown={e => { e.preventDefault(); pickMention(s) }} className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${i === 0 ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8FAFF]'}`}>
                      <span className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(s.id) }}>{initials(s.full_name)}</span>{s.full_name}
                    </button>
                  ))}
                </div>
              )}
              {editing && <p className="text-[11px] text-[#92400E] mb-1">Editing your message · Esc to cancel</p>}
              <div className="flex items-end gap-2">
                <textarea ref={taRef} value={text} onChange={onChange} onKeyDown={onKey} rows={1}
                  placeholder={`Message ${channelLabel(current)} — Enter to send, Shift+Enter for a new line, @ to mention`}
                  className="flex-1 border border-[#DEE7FF] rounded-xl px-3.5 py-2.5 text-sm text-[#2A2035] resize-none max-h-40 focus:outline-none focus:border-[#325099]"
                  style={{ height: 'auto', minHeight: 42 }}
                  onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px' }} />
                <button onClick={send} disabled={!text.trim()} className="h-[42px] px-4 rounded-xl bg-[#062E63] text-white text-sm font-semibold hover:bg-[#325099] disabled:opacity-40">{editing ? 'Save' : 'Send'}</button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

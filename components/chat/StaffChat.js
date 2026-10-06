'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { fetchAllTerms, getCurrentTerm, getRegularEnrolmentTerm, weekOfTerm, formatTermRange } from '../../lib/terms'
import {
  loadStaffDirectory, loadChannels, loadMessages, sendMessage, editMessage, deleteMessage,
  markRead, loadUnread, createChannel, openDm, openCubeDm, joinChannel, leaveChannel, renameChannel, deleteChannel, addMember, removeMember, renderBody,
  loadPins, savePins, uploadChatImage, imageMarker, uploadChatFile, fileMarker,
  loadReactions, toggleReaction, QUICK_EMOJI, searchMessages, bodyPreview, loadReads, setDirectorsOnly,
  loadShortcuts, saveShortcuts, fillShortcut, SHORTCUT_VARS, BUILTIN_SHORTCUTS, loadTermClasses, classesTextFor,
} from '../../lib/chat'
import CubeLogo from '../CubeLogo'

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

// onConversationOpen(bool): fires when the phone layout switches between the
// channel list and a conversation, so a host can hide its own bottom bar
// while someone is typing in a thread.
export default function StaffChat({ me, initialChannel = '', className = 'h-[calc(100dvh-64px)]', onConversationOpen }) {
  const [staff, setStaff] = useState([])
  const [channels, setChannels] = useState([])
  const [unread, setUnread] = useState({})
  const [active, setActive] = useState(initialChannel || '')
  const [messages, setMessages] = useState(null)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(null)  // message id being edited
  // Phones: the channel list and the conversation are two screens; this picks
  // which one shows. Desktop shows both and ignores it.
  const [sidebarOpen, setSidebarOpen] = useState(!initialChannel)
  useEffect(() => { onConversationOpen?.(!sidebarOpen) }, [sidebarOpen])   // eslint-disable-line react-hooks/exhaustive-deps
  const [mention, setMention] = useState(null)  // { query, at } while typing an @name
  const [err, setErr] = useState('')
  const [deleting, setDeleting] = useState(null)  // { channel, step: 1|2, typed } while confirming a delete
  const [membersOpen, setMembersOpen] = useState(false)
  const [pins, setPins] = useState([])            // channel ids, in pin order
  const [uploading, setUploading] = useState(false)
  const [shortcuts, setShortcuts] = useState([])   // directors' canned messages [{ id, title, body }]
  const [shortcutPick, setShortcutPick] = useState(false)   // composer picker open
  const [shortcutEdit, setShortcutEdit] = useState(null)    // { id?, title, body } being edited
  const [bulk, setBulk] = useState(null)   // { sc, picked: [ids], preview: id, sending, done: { ok, failed } }
  const [termNow, setTermNow] = useState(null)
  const [nextTerm, setNextTerm] = useState(null)    // upcoming (or current) teaching term
  const [termClasses, setTermClasses] = useState([]) // its active classes, for {classes}
  const [reactions, setReactions] = useState({})   // messageId → [{ emoji, user_id }]
  const [reads, setReads] = useState({})           // userId → last_read_at for the open channel
  const [picker, setPicker] = useState(null)       // message id with the emoji picker open
  const [online, setOnline] = useState(new Set())  // user ids present right now
  const [typing, setTyping] = useState({})         // user id → channel id they are typing in
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)     // search results, or null when not searching
  const jumpRef = useRef('')                       // message id to scroll to after a search jump
  const presenceRef = useRef(null)
  const typingTimer = useRef(null)
  const fileRef = useRef(null)
  const listRef = useRef(null)
  // Keyboard opening/closing resizes the list (see lib/useKeyboardFit): stay at
  // the bottom so the latest messages remain in view above the reply box.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240
      if (nearBottom) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const taRef = useRef(null)
  const activeRef = useRef(active)
  // Directors post either as themselves or as "CUBE" (a shared voice): their
  // pick is remembered per browser. In a CUBE thread it is always CUBE.
  const [persona, setPersona] = useState(() => { try { return localStorage.getItem('cube:chat-persona') === 'cube' ? 'cube' : 'me' } catch { return 'me' } })
  const pickPersona = (p) => { setPersona(p); try { localStorage.setItem('cube:chat-persona', p) } catch { /* fine */ } }
  useEffect(() => { activeRef.current = active }, [active])

  const staffById = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s])), [staff])
  const nameOf = useCallback((id) => staffById[id]?.full_name || 'Former staff', [staffById])
  const isAdmin = !!me?.isAdmin
  const channelLabel = useCallback((c) => c.kind === 'dm' ? nameOf(c.otherId)
    : c.kind === 'cube_dm' ? (isAdmin ? `CUBE · ${nameOf(c.otherId)}` : 'CUBE') : `#${c.name}`, [nameOf, isAdmin])

  const refreshChannels = useCallback(async (uid) => {
    const [cs, un] = await Promise.all([loadChannels(uid), loadUnread()])
    setChannels(cs); setUnread(un)
    return cs
  }, [])

  // ── Boot ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!me?.id) return
    (async () => {
      const [dir, cs, pinned] = await Promise.all([loadStaffDirectory(), refreshChannels(me.id), loadPins(me.id)])
      setStaff(dir); setPins(pinned)
      if (isAdmin) {
        loadShortcuts().then(list => {
          // Seed the built-ins once; after that they are ordinary, editable rows.
          const missing = BUILTIN_SHORTCUTS.filter(b => !list.some(x => x.id === b.id))
          if (!missing.length) { setShortcuts(list); return }
          const next = [...list, ...missing]
          setShortcuts(next); saveShortcuts(next).catch(() => {})
        }).catch(() => {})
        fetchAllTerms().then(ts => {
          setTermNow(getCurrentTerm(ts))
          const nt = getRegularEnrolmentTerm(ts); setNextTerm(nt)
          if (nt) loadTermClasses(nt.id).then(setTermClasses).catch(() => {})
        }).catch(() => {})
      }
      if (!activeRef.current) {
        const staffChan = cs.find(ch => ch.is_default) || cs.find(ch => ch.kind === 'channel' && ch.mine)
        if (staffChan) { activeRef.current = staffChan.id; setActive(staffChan.id) }
      }
    })()
  }, [me?.id, isAdmin, refreshChannels])

  // ── Conversation ───────────────────────────────────────────────────────────
  const loadConversation = useCallback(async () => {
    if (!active || !me) return
    try {
      const ms = await loadMessages(active)
      setMessages(ms); setErr('')
      setReactions(await loadReactions(ms.map(m => m.id)).catch(() => ({})))
      setReads(await loadReads(active).catch(() => ({})))
    } catch (e) { setErr(e.message || 'Could not load messages'); setMessages([]) }
  }, [active, me])
  useEffect(() => { const t = setTimeout(loadConversation, 0); return () => clearTimeout(t) }, [loadConversation])
  const selectChannel = (id) => { if (id !== active) { setMessages(null); setEditing(null); setText('') } setActive(id); setSidebarOpen(false) }
  // Seen: whenever this conversation is open and its messages are loaded.
  useEffect(() => {
    if (!active || !me || messages === null) return
    markRead(active, me.id).then(() => setUnread(u => (u[active] ? { ...u, [active]: 0 } : u)))
  }, [active, me, messages])
  useEffect(() => {
    if (!listRef.current) return
    if (jumpRef.current) {
      const el = document.getElementById(`msg-${jumpRef.current}`)
      if (el) { jumpRef.current = ''; el.scrollIntoView({ block: 'center' }); el.animate?.([{ backgroundColor: '#FEF3C7' }, { backgroundColor: 'transparent' }], { duration: 2000 }); return }
    }
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reads' }, (p) => {
        const r = p.new
        if (r?.channel_id && r.channel_id === activeRef.current) setReads(rs => ({ ...rs, [r.user_id]: r.last_read_at }))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, (p) => {
        const r = p.new?.message_id ? p.new : p.old
        if (!r?.message_id) return
        setMessages(ms => {
          if (ms?.some(m => m.id === r.message_id)) loadReactions(ms.map(m => m.id)).then(setReactions)
          return ms
        })
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') { loadConversation(); refreshChannels(me.id) } })
    const onWake = () => { if (document.visibilityState === 'visible') { loadConversation(); refreshChannels(me.id) } }
    document.addEventListener('visibilitychange', onWake); window.addEventListener('focus', onWake); window.addEventListener('online', onWake)
    const beat = setInterval(onWake, 20000)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onWake); window.removeEventListener('focus', onWake); window.removeEventListener('online', onWake); clearInterval(beat) }
  }, [me, loadConversation, refreshChannels])

  // Presence: who is online, and who is typing where. One shared channel;
  // each person tracks their own row, everyone reads the sync.
  useEffect(() => {
    if (!me) return
    const ch = supabase.channel('chat-presence', { config: { presence: { key: me.id } } })
    const read = () => {
      const state = ch.presenceState()
      const on = new Set(), ty = {}
      for (const [uid, rows] of Object.entries(state)) {
        on.add(uid)
        const t = rows.find(r => r.typing)?.typing
        if (t && uid !== me.id) ty[uid] = t
      }
      setOnline(on); setTyping(ty)
    }
    ch.on('presence', { event: 'sync' }, read)
      .subscribe(async (status) => { if (status === 'SUBSCRIBED') await ch.track({ name: me.full_name, typing: null }) })
    presenceRef.current = ch
    return () => { presenceRef.current = null; supabase.removeChannel(ch) }
  }, [me])
  const setTypingIn = (channelId) => {
    presenceRef.current?.track({ name: me.full_name, typing: channelId })
    clearTimeout(typingTimer.current)
    if (channelId) typingTimer.current = setTimeout(() => presenceRef.current?.track({ name: me.full_name, typing: null }), 3000)
  }

  // Search across every channel you are in; results replace the conversation.
  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const t = setTimeout(() => searchMessages(q).then(setResults).catch(e => setErr(e.message)), 250)
    return () => clearTimeout(t)
  }, [query])
  const jumpTo = (m) => {
    setQuery(''); setResults(null); jumpRef.current = m.id
    if (m.channel_id !== active) { selectChannel(m.channel_id); return }
    // Same channel: the list is already rendered, so scroll now.
    setTimeout(() => {
      const el = document.getElementById(`msg-${m.id}`)
      if (el) { jumpRef.current = ''; el.scrollIntoView({ block: 'center' }); el.animate?.([{ backgroundColor: '#FEF3C7' }, { backgroundColor: 'transparent' }], { duration: 2000 }) }
    }, 0)
  }

  const react = async (m, emoji) => {
    const mine = (reactions[m.id] || []).some(r => r.user_id === me.id && r.emoji === emoji)
    setPicker(null)
    setReactions(rs => ({ ...rs, [m.id]: mine ? (rs[m.id] || []).filter(r => !(r.user_id === me.id && r.emoji === emoji)) : [...(rs[m.id] || []), { emoji, user_id: me.id }] }))
    try { await toggleReaction(m.id, me.id, emoji, !mine) } catch (e) { setErr(e.message) }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const current = channels.find(c => c.id === active) || null
  // Writing as CUBE: a director in CUBE mode, or anyone (a director) inside a CUBE thread.
  const cubeMode = !!me?.isAdmin && persona === 'cube'
  const asCube = !!me?.isAdmin && (cubeMode || current?.kind === 'cube_dm')
  const canPost = !!current && current.mine && (!current.directors_only || me.isAdmin)
  // Read receipts: each other member sits under the last message they have
  // seen, Slack-style, so a message with avatars beneath it is read that far.
  const seenBy = useMemo(() => {
    const out = {}
    if (!messages?.length || !current) return out
    for (const uid of current.members) {
      if (uid === me.id) continue
      const at = reads[uid]
      if (!at) continue
      let last = null
      for (const m of messages) { if (m.created_at <= at) last = m; else break }
      // Their own message needs no "seen" mark — they wrote it.
      if (last && last.sender_id !== uid) (out[last.id] ||= []).push(uid)
    }
    return out
  }, [messages, reads, current, me.id])
  const send = async () => {
    const body = text.trim()
    if (!body || !current || !me) return
    setText(''); setMention(null); setTypingIn(null)
    try {
      if (editing) { await editMessage(editing, body); setEditing(null); return }
      const m = await sendMessage({ channelId: current.id, senderId: me.id, senderName: me.full_name, body, asCube })
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
    if (current) setTypingIn(v ? current.id : null)
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
  // Attach an image: from the 📎 button, or pasted into the composer. It goes
  // out straight away as its own message, with whatever was typed above it.
  const attach = async (file) => {
    if (!file || !current || !me) return
    setUploading(true); setErr('')
    try {
      const marker = file.type?.startsWith('image/') ? imageMarker(await uploadChatImage(file, current.id)) : fileMarker(await uploadChatFile(file, current.id))
      const body = [text.trim(), marker].filter(Boolean).join('\n')
      setText('')
      const m = await sendMessage({ channelId: current.id, senderId: me.id, senderName: me.full_name, body, asCube })
      setMessages(ms => (ms && !ms.some(x => x.id === m.id) ? [...ms, m] : ms))
      authedFetch('/api/chat/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: m.id }) }).catch(() => {})
    } catch (e) { setErr(e.message || 'Could not attach the file') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const onPasteComposer = (e) => {
    const f = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile()
    if (f) { e.preventDefault(); attach(f) }
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
    try {
      const id = cubeMode && other.role === 'tutor' ? await openCubeDm(other.id) : await openDm(other.id)
      await refreshChannels(me.id); selectChannel(id)
    } catch (e) { setErr(e.message) }
  }
  const toggleAnnounce = async (c) => {
    try { await setDirectorsOnly(c.id, !c.directors_only); await refreshChannels(me.id) } catch (e) { setErr(e.message) }
  }

  // ── Shortcuts (directors) ─────────────────────────────────────────────────
  const shortcutVars = (recipientId) => {
    const other = recipientId ? nameOf(recipientId) : (current?.kind === 'dm' || current?.kind === 'cube_dm') ? nameOf(current.otherId) : ''
    const wk = termNow ? weekOfTerm(termNow) : null
    return {
      first: other.split(' ')[0] || '', recipient: other, me: cubeMode ? 'CUBE' : (me.full_name || '').split(' ')[0],
      channel: recipientId ? other : current ? channelLabel(current).replace(/^#/, '') : '',
      date: new Date().toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
      term: termNow ? `Term ${termNow.term_number} ${termNow.year}` : '', week: wk ? String(wk) : '',
      next_term: nextTerm ? `Term ${nextTerm.term_number} ${nextTerm.year}` : '', next_term_dates: nextTerm ? formatTermRange(nextTerm) : '',
      classes: other ? classesTextFor(other, termClasses) : '',
    }
  }
  const visibleShortcuts = shortcuts.filter(x => !x.hidden)
  const insertShortcut = (sc) => {
    const filled = fillShortcut(sc.body, shortcutVars())
    setText(t => (t.trim() ? `${t.replace(/\s+$/, '')}\n${filled}` : filled))
    setShortcutPick(false); setSidebarOpen(false)
    setTimeout(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px' } }, 0)
  }
  const persistShortcuts = async (next) => {
    const prev = shortcuts
    setShortcuts(next)
    try { await saveShortcuts(next) } catch (e) { setShortcuts(prev); setErr(e.message || 'Could not save shortcuts') }
  }
  const commitShortcut = async () => {
    const d = shortcutEdit
    if (!d?.title.trim() || !d?.body.trim()) return
    const row = { id: d.id || `sc_${Date.now().toString(36)}`, title: d.title.trim(), body: d.body }
    const next = d.id ? shortcuts.map(x => (x.id === d.id ? row : x)) : [...shortcuts, row]
    setShortcutEdit(null)
    await persistShortcuts(next)
  }
  const deleteShortcut = async (id) => {
    if (!confirm('Delete this shortcut?')) return
    setShortcutEdit(null)
    const builtin = BUILTIN_SHORTCUTS.some(b => b.id === id)
    await persistShortcuts(builtin ? shortcuts.map(x => (x.id === id ? { id, hidden: true } : x)) : shortcuts.filter(x => x.id !== id))
  }

  // Send one shortcut to several people at once: a DM each, filled in for them.
  const openBulk = (sc) => {
    const teachers = staff.filter(s => s.id !== me.id && s.role === 'tutor').map(s => s.id)
    setShortcutPick(false); setSidebarOpen(false)
    setBulk({ sc, picked: teachers, preview: teachers[0] || null, sending: false, done: null })
  }
  const sendBulk = async () => {
    if (!bulk || !bulk.picked.length || bulk.sending) return
    setBulk(b => ({ ...b, sending: true }))
    const ok = [], failed = []
    for (const uid of bulk.picked) {
      try {
        const channelId = cubeMode ? await openCubeDm(uid) : await openDm(uid)
        const m = await sendMessage({ channelId, senderId: me.id, senderName: me.full_name, body: fillShortcut(bulk.sc.body, shortcutVars(uid)), asCube: cubeMode })
        authedFetch('/api/chat/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: m.id }) }).catch(() => {})
        ok.push(uid)
      } catch { failed.push(uid) }
    }
    await refreshChannels(me.id)
    if (activeRef.current) loadConversation()
    setBulk(b => ({ ...b, sending: false, done: { ok, failed } }))
  }

  // Rename / delete: the channel's creator or a director (the server checks too).
  const canManage = (c) => c && c.kind === 'channel' && (c.created_by === me.id || me.isAdmin)
  const togglePin = async (id) => {
    const next = pins.includes(id) ? pins.filter(x => x !== id) : [...pins, id]
    setPins(next)
    try { await savePins(me.id, next) } catch (e) { setErr(e.message) }
  }
  const addTo = async (c, uid) => { try { await addMember(c.id, uid); await refreshChannels(me.id) } catch (e) { setErr(e.message) } }
  const removeFrom = async (c, uid) => { try { await removeMember(c.id, uid); await refreshChannels(me.id) } catch (e) { setErr(e.message) } }
  const rename = async (c) => {
    const name = prompt('New channel name', c.name)
    if (name == null) return
    const clean = name.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 40)
    if (!clean || clean === c.name) return
    try { await renameChannel(c.id, clean); await refreshChannels(me.id) } catch (e) { setErr(e.message) }
  }
  const confirmDelete = async () => {
    const d = deleting; if (!d || d.typed.trim() !== d.channel.name) return
    try { await deleteChannel(d.channel.id); setDeleting(null); await refreshChannels(me.id); if (active === d.channel.id) selectChannel('') }
    catch (e) { setErr(e.message); setDeleting(null) }
  }
  const join = async (c) => { try { await joinChannel(c.id, me.id); await refreshChannels(me.id) } catch (e) { setErr(e.message) } }
  const leave = async (c) => { if (!confirm(`Leave #${c.name}?`)) return; try { await leaveChannel(c.id, me.id); await refreshChannels(me.id); if (active === c.id) setActive('') } catch (e) { setErr(e.message) } }

  if (!me) return null

  const pinnedSet = new Set(pins)
  const pinned = pins.map(id => channels.find(c => c.id === id)).filter(c => c && c.mine)
  const open = channels.filter(c => c.kind === 'channel' && !pinnedSet.has(c.id))
  const dms = channels.filter(c => (c.kind === 'dm' || c.kind === 'cube_dm') && !pinnedSet.has(c.id)).sort((a, b) => (unread[b.id] || 0) - (unread[a.id] || 0) || channelLabel(a).localeCompare(channelLabel(b)))
  const Row = ({ c }) => (
    <div className={`group flex items-center pr-2 ${active === c.id ? 'bg-[#DEE7FF]' : 'hover:bg-[#F8FAFF]'}`}>
      <button onClick={() => selectChannel(c.id)} className={`flex-1 min-w-0 text-left pl-4 py-2.5 md:py-1.5 flex items-center gap-2 text-sm ${active === c.id ? 'text-[#062E63] font-semibold' : 'text-[#2A2035]/80'}`}>
        {c.kind === 'dm'
          ? <span className="relative shrink-0"><span className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(c.otherId) }}>{initials(nameOf(c.otherId))}</span>{online.has(c.otherId) && <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#10b981] ring-1 ring-white" />}</span>
          : c.kind === 'cube_dm'
          ? <span className="w-5 h-5 rounded-full bg-[#062E63] text-white flex items-center justify-center shrink-0"><CubeLogo className="h-3 w-auto" /></span>
          : null}
        <span className={`truncate flex-1 ${c.kind === 'channel' && !c.mine ? 'opacity-50' : ''}`}>{c.kind === 'channel' ? `# ${c.name}` : channelLabel(c)}</span>
        {c.kind === 'channel' && !c.mine && <span className="text-[10px] text-[#325099]">join</span>}
        {unread[c.id] > 0 && <span className="text-[10px] font-bold bg-[#B23A3A] text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{unread[c.id]}</span>}
      </button>
      {c.mine && (
        <button onClick={() => togglePin(c.id)} title={pinnedSet.has(c.id) ? 'Unpin' : 'Pin'}
          className={`text-[11px] px-2 py-2 md:px-1 md:py-0 ${pinnedSet.has(c.id) ? 'opacity-70' : 'opacity-40 md:opacity-0 md:group-hover:opacity-60'} hover:!opacity-100`}>📌</button>
      )}
    </div>
  )
  const others = staff.filter(s => s.id !== me.id)
  const staffNames = staff.map(s => s.full_name)
  const totalUnread = Object.values(unread).reduce((n, v) => n + v, 0)

  const Sidebar = (
    <aside className="w-full md:w-64 shrink-0 bg-white md:border-r border-[#DEE7FF] flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-[#F0F4FF]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-[#062E63]">Staff chat</p>
          {isAdmin && (
            <div className="flex rounded-full border border-[#DEE7FF] overflow-hidden text-[10px] font-bold" title="Post as yourself, or as CUBE (a shared voice both directors use)">
              <button onClick={() => pickPersona('me')} className={`px-2 py-1 ${persona === 'me' ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>{(me.full_name || 'Me').split(' ')[0]}</button>
              <button onClick={() => pickPersona('cube')} className={`px-2 py-1 flex items-center gap-1 ${persona === 'cube' ? 'bg-[#062E63] text-white' : 'text-[#062E63]'}`}><CubeLogo className="h-2.5 w-auto" />CUBE</button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-[#2A2035]/45">{totalUnread ? `${totalUnread} unread` : 'All caught up'} · {online.size} online</p>
        <input value={query} onChange={e => { setQuery(e.target.value); if (!e.target.value.trim()) setResults(null) }} placeholder="Search messages… (from:name)"
          className="mt-2 w-full border border-[#DEE7FF] rounded-lg px-2.5 py-2 md:py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {pinned.length > 0 && (
          <>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 px-3 py-1">📌 Pinned</p>
            {pinned.map(c => <Row key={c.id} c={c} />)}
          </>
        )}
        <div className={`px-3 flex items-center justify-between ${pinned.length ? 'pt-3' : ''}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 py-1">Channels</p>
          <button onClick={newChannel} className="text-[11px] font-semibold text-[#325099] hover:underline">+ New</button>
        </div>
        {open.map(c => <Row key={c.id} c={c} />)}
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 px-3 pt-4 pb-1">Direct messages</p>
        {dms.map(c => <Row key={c.id} c={c} />)}
        {me.isAdmin && (
          <>
            <div className="px-3 flex items-center justify-between pt-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 py-1">⚡ Shortcuts</p>
              <button onClick={() => setShortcutEdit({ title: '', body: '' })} className="text-[11px] font-semibold text-[#325099] hover:underline">+ New</button>
            </div>
            {visibleShortcuts.length === 0 && <p className="px-4 py-1 text-[11px] text-[#2A2035]/40">Canned messages you send often. Only directors see these.</p>}
            {visibleShortcuts.map(sc => (
              <div key={sc.id} className="group/sc flex items-center gap-1 px-4 py-2 md:py-1 hover:bg-[#F8FAFF]">
                <button onClick={() => insertShortcut(sc)} disabled={!canPost} title={sc.body} className="flex-1 min-w-0 text-left text-sm text-[#2A2035]/80 truncate disabled:opacity-40">{sc.title}</button>
                <button onClick={() => openBulk(sc)} title="Send to several teachers at once" className="md:opacity-0 md:group-hover/sc:opacity-100 text-[11px] text-[#325099] hover:underline shrink-0">Send to…</button>
                <button onClick={() => setShortcutEdit({ ...sc })} className="md:opacity-0 md:group-hover/sc:opacity-100 text-[11px] text-[#325099] hover:underline shrink-0">Edit</button>
              </div>
            ))}
          </>
        )}
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 px-3 pt-4 pb-1">Everyone</p>
        {others.filter(s => !(cubeMode && s.role === 'director')).filter(s => !channels.some(c => c.kind === (cubeMode ? 'cube_dm' : 'dm') && c.otherId === s.id)).map(s => (
          <button key={s.id} onClick={() => startDm(s)} className="w-full text-left px-4 py-2.5 md:py-1.5 flex items-center gap-2 text-sm text-[#2A2035]/70 hover:bg-[#F8FAFF]">
            <span className="relative shrink-0"><span className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(s.id) }}>{initials(s.full_name)}</span>{online.has(s.id) && <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#10b981] ring-1 ring-white" />}</span>
            <span className="truncate flex-1">{s.full_name}</span>
            <span className="text-[10px] text-[#2A2035]/35">{s.role === 'director' ? 'director' : ''}</span>
          </button>
        ))}
      </div>
    </aside>
  )

  return (
    <div className={`flex flex-col bg-[#F8FAFF] ${className}`}>
      {bulk && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => !bulk.sending && setBulk(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl border border-[#DEE7FF] p-4 md:p-6 w-full md:w-[44rem] max-w-full max-h-[90dvh] flex flex-col" onClick={e => e.stopPropagation()}>
            <p className="text-lg font-bold text-[#062E63] mb-1">Send “{bulk.sc.title}” to…</p>
            <p className="text-xs text-[#2A2035]/50 mb-4">Each person gets their own direct message, filled in for them. Click a name to preview it.</p>
            {bulk.done ? (
              <div className="text-sm text-[#2A2035]/80">
                <p className="mb-2">✅ Sent to {bulk.done.ok.length} {bulk.done.ok.length === 1 ? 'person' : 'people'}{bulk.done.ok.length ? `: ${bulk.done.ok.map(nameOf).join(', ')}` : ''}.</p>
                {bulk.done.failed.length > 0 && <p className="text-[#B23A3A] mb-2">Could not send to: {bulk.done.failed.map(nameOf).join(', ')}.</p>}
                <div className="flex justify-end mt-4"><button onClick={() => setBulk(null)} className="text-sm font-semibold rounded-xl px-4 py-2 bg-[#062E63] text-white">Done</button></div>
              </div>
            ) : (
              <>
                <div className="flex flex-col md:flex-row gap-4 min-h-0 flex-1">
                  <div className="w-full md:w-56 shrink-0 flex flex-col min-h-0 max-md:max-h-[40dvh]">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60">Recipients · {bulk.picked.length}</p>
                      <div className="flex gap-2 text-[11px] font-semibold text-[#325099]">
                        <button onClick={() => setBulk(b => ({ ...b, picked: staff.filter(s => s.id !== me.id && s.role === 'tutor').map(s => s.id) }))} className="hover:underline">All teachers</button>
                        <button onClick={() => setBulk(b => ({ ...b, picked: [] }))} className="hover:underline">None</button>
                      </div>
                    </div>
                    <div className="overflow-y-auto border border-[#EEF2FB] rounded-xl divide-y divide-[#F0F4FF]">
                      {staff.filter(s => s.id !== me.id).map(s => {
                        const on = bulk.picked.includes(s.id)
                        return (
                          <div key={s.id} className={`flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer ${bulk.preview === s.id ? 'bg-[#F0F4FF]' : 'hover:bg-[#F8FAFF]'}`} onClick={() => setBulk(b => ({ ...b, preview: s.id }))}>
                            <input type="checkbox" checked={on} onClick={e => e.stopPropagation()} onChange={() => setBulk(b => ({ ...b, picked: on ? b.picked.filter(x => x !== s.id) : [...b.picked, s.id] }))} className="accent-[#062E63]" />
                            <span className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0" style={{ background: colorFor(s.id) }}>{initials(s.full_name)}</span>
                            <span className="truncate flex-1 text-[#2A2035]/80">{s.full_name}</span>
                            {s.role === 'director' && <span className="text-[10px] text-[#2A2035]/35">director</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col min-h-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 mb-1">Preview{bulk.preview ? ` · ${nameOf(bulk.preview)}` : ''}</p>
                    {bulk.preview
                      ? <div className="flex-1 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-[#2A2035] bg-[#F8FAFF] border border-[#EEF2FB] rounded-xl px-4 py-3" dangerouslySetInnerHTML={{ __html: renderBody(fillShortcut(bulk.sc.body, shortcutVars(bulk.preview)), staffNames) }} />
                      : <div className="flex-1 text-[13px] text-[#2A2035]/50 bg-[#F8FAFF] border border-[#EEF2FB] rounded-xl px-4 py-3">Pick a name to preview.</div>}
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <span className="flex-1" />
                  <button onClick={() => setBulk(null)} disabled={bulk.sending} className="text-sm font-semibold rounded-xl px-4 py-2 border border-[#DEE7FF] text-[#325099]">Cancel</button>
                  <button onClick={sendBulk} disabled={!bulk.picked.length || bulk.sending} className="text-sm font-semibold rounded-xl px-4 py-2 bg-[#062E63] text-white disabled:opacity-40">{bulk.sending ? 'Sending…' : `Send ${bulk.picked.length} message${bulk.picked.length === 1 ? '' : 's'}`}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {shortcutEdit && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setShortcutEdit(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl border border-[#DEE7FF] p-4 md:p-6 w-full md:w-[32rem] max-w-full max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="text-lg font-bold text-[#062E63] mb-1">{shortcutEdit.id ? 'Edit shortcut' : 'New shortcut'}</p>
            <p className="text-xs text-[#2A2035]/50 mb-4">A message you send often. Placeholders fill in from the open conversation.</p>
            <input autoFocus value={shortcutEdit.title} onChange={e => setShortcutEdit(d => ({ ...d, title: e.target.value }))} placeholder="Title, e.g. Marking due"
              className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm mb-2 focus:outline-none focus:border-[#325099]" />
            <textarea value={shortcutEdit.body} onChange={e => setShortcutEdit(d => ({ ...d, body: e.target.value }))} rows={5} placeholder={'Hi {first}, a reminder that marking for {term} week {week} is due Friday. Thanks! – {me}'}
              className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm resize-y focus:outline-none focus:border-[#325099]" />
            <div className="flex flex-wrap gap-1 mt-2 mb-4">
              {SHORTCUT_VARS.map(v => (
                <button key={v.key} onClick={() => setShortcutEdit(d => ({ ...d, body: `${d.body}{${v.key}}` }))} title={v.label + (v.hint ? ` (${v.hint})` : '')}
                  className="text-[11px] font-mono rounded-full px-2 py-0.5 bg-[#F0F4FF] text-[#325099] hover:bg-[#DEE7FF]">{`{${v.key}}`}</button>
              ))}
            </div>
            <div className="flex gap-2">
              {shortcutEdit.id && <button onClick={() => deleteShortcut(shortcutEdit.id)} className="text-sm font-semibold rounded-xl px-4 py-2 text-[#B23A3A] hover:bg-[#FEF2F2]">Delete</button>}
              <span className="flex-1" />
              <button onClick={() => setShortcutEdit(null)} className="text-sm font-semibold rounded-xl px-4 py-2 border border-[#DEE7FF] text-[#325099]">Cancel</button>
              <button onClick={commitShortcut} disabled={!shortcutEdit.title.trim() || !shortcutEdit.body.trim()} className="text-sm font-semibold rounded-xl px-4 py-2 bg-[#062E63] text-white disabled:opacity-40">Save</button>
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setDeleting(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl border border-[#DEE7FF] p-4 md:p-6 w-full md:w-[24rem] max-w-full" onClick={e => e.stopPropagation()}>
            {deleting.step === 1 ? (
              <>
                <p className="text-lg font-bold text-[#062E63] mb-2">Delete #{deleting.channel.name}?</p>
                <p className="text-sm text-[#2A2035]/70 mb-5">Every message in it goes too, for everyone. This cannot be undone.</p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleting(null)} className="flex-1 text-sm font-semibold rounded-xl px-4 py-2 border border-[#DEE7FF] text-[#325099]">Keep it</button>
                  <button onClick={() => setDeleting(d => ({ ...d, step: 2 }))} className="flex-1 text-sm font-semibold rounded-xl px-4 py-2 bg-[#B23A3A] text-white">Continue</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-[#062E63] mb-2">Type the channel name to confirm</p>
                <p className="text-sm text-[#2A2035]/70 mb-3">Type <span className="font-mono font-semibold">{deleting.channel.name}</span> to delete it.</p>
                <input autoFocus value={deleting.typed} onChange={e => setDeleting(d => ({ ...d, typed: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }}
                  className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm font-mono mb-4 focus:outline-none focus:border-[#B23A3A]" placeholder={deleting.channel.name} />
                <div className="flex gap-2">
                  <button onClick={() => setDeleting(null)} className="flex-1 text-sm font-semibold rounded-xl px-4 py-2 border border-[#DEE7FF] text-[#325099]">Cancel</button>
                  <button onClick={confirmDelete} disabled={deleting.typed.trim() !== deleting.channel.name} className="flex-1 text-sm font-semibold rounded-xl px-4 py-2 bg-[#B23A3A] text-white disabled:opacity-40">Delete channel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        <div className={`${sidebarOpen ? 'flex' : 'hidden'} md:flex h-full w-full md:w-auto`}>{Sidebar}</div>
        <main className={`${sidebarOpen ? 'hidden md:flex' : 'flex'} flex-1 min-w-0 flex-col`}>
          <div className="px-3 md:px-4 py-2.5 md:py-3 bg-white border-b border-[#DEE7FF] flex flex-wrap items-center gap-x-3 gap-y-1">
            <button onClick={() => setSidebarOpen(true)} aria-label="Back to the list"
              className="md:hidden w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-[#325099] text-2xl active:bg-[#EEF3FF]">‹</button>
            {current ? (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#062E63] truncate">{channelLabel(current)}</p>
                  <p className="text-[11px] text-[#2A2035]/45 truncate">
                    {current.kind === 'dm' ? 'Direct message · only the two of you' : current.kind === 'cube_dm' ? (isAdmin ? `CUBE inbox with ${nameOf(current.otherId)} · every director sees this thread` : 'Direct message with CUBE') : `${current.members.length} member${current.members.length === 1 ? '' : 's'} · ${current.members.map(nameOf).map(n => n.split(' ')[0]).join(', ')}`}
                  </p>
                </div>
                {current.mine && (
                  <button onClick={() => togglePin(current.id)} title={pins.includes(current.id) ? 'Unpin' : 'Pin to the top of the list'}
                    className={`text-[11px] font-semibold hover:underline ${pins.includes(current.id) ? 'text-[#062E63]' : 'text-[#325099]'}`}>
                    {pins.includes(current.id) ? '📌 Pinned' : '📌 Pin'}
                  </button>
                )}
                {current.kind === 'channel' && (
                  <button onClick={() => setMembersOpen(o => !o)} className={`text-[11px] font-semibold ${membersOpen ? 'text-[#062E63]' : 'text-[#325099]'} hover:underline`}>Members</button>
                )}
                {current.kind === 'channel' && current.directors_only && !me.isAdmin && (
                  <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-[#FFF7E6] text-[#92400E]">📣 Directors post</span>
                )}
                {current.kind === 'channel' && me.isAdmin && (
                  <button onClick={() => toggleAnnounce(current)} title="Only directors can post in an announcement channel"
                    className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${current.directors_only ? 'bg-[#FFF7E6] text-[#92400E]' : 'bg-[#F0F4FF] text-[#325099]'}`}>
                    📣 {current.directors_only ? 'Directors post' : 'Everyone posts'}
                  </button>
                )}
                {canManage(current) && (
                  <>
                    <button onClick={() => rename(current)} className="text-[11px] font-semibold text-[#325099] hover:underline">Rename</button>
                    {!current.is_default && <button onClick={() => setDeleting({ channel: current, step: 1, typed: '' })} className="text-[11px] font-semibold text-[#2A2035]/40 hover:text-[#B23A3A]">Delete</button>}
                  </>
                )}
                {current.kind === 'channel' && (current.mine
                  ? (!current.is_default && <button onClick={() => leave(current)} className="text-[11px] font-semibold text-[#2A2035]/40 hover:text-[#B23A3A]">Leave</button>)
                  : <button onClick={() => join(current)} className="text-xs font-semibold rounded-full px-3 py-1 bg-[#062E63] text-white">Join channel</button>)}
              </>
            ) : <p className="text-sm text-[#2A2035]/50">Pick a channel or a person.</p>}
          </div>
          {err && <p className="px-4 py-2 text-xs text-[#B23A3A] bg-rose-50 border-b border-rose-100">{err}</p>}
          {membersOpen && current?.kind === 'channel' && (() => {
            const manage = canManage(current)
            const inChan = new Set(current.members)
            const outside = staff.filter(s => !inChan.has(s.id))
            return (
              <div className="px-4 py-3 bg-[#FBFCFF] border-b border-[#DEE7FF]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-[#062E63]">Members · {current.members.length}</p>
                  {current.is_default && <p className="text-[10px] text-[#2A2035]/45">Everyone on staff is in this channel.</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {current.members.map(uid => (
                    <span key={uid} className="inline-flex items-center gap-1.5 text-[11px] bg-white border border-[#DEE7FF] rounded-full pl-1 pr-2 py-0.5">
                      <span className="w-4 h-4 rounded-full text-[8px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(uid) }}>{initials(nameOf(uid))}</span>
                      {nameOf(uid)}{uid === me.id ? ' (you)' : ''}{online.has(uid) && <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" title="Online" />}
                      {manage && !current.is_default && uid !== me.id && <button onClick={() => removeFrom(current, uid)} title="Remove from channel" className="text-[#2A2035]/35 hover:text-[#B23A3A] ml-0.5">✕</button>}
                    </span>
                  ))}
                </div>
                {manage && outside.length > 0 && (
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-semibold text-[#325099]/70">Add:</span>
                    {outside.map(s => (
                      <button key={s.id} onClick={() => addTo(current, s.id)} className="text-[11px] font-semibold text-[#325099] border border-dashed border-[#BACBFF] rounded-full px-2 py-0.5 hover:bg-[#EEF4FF]">+ {s.full_name}</button>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            {results !== null ? (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#325099]/60 mb-2">{results.length ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'No messages match'} · <button onClick={() => { setQuery(''); setResults(null) }} className="normal-case tracking-normal text-[#325099] hover:underline">clear</button></p>
                {results.map(m => {
                  const c = channels.find(x => x.id === m.channel_id)
                  return (
                    <button key={m.id} onClick={() => jumpTo(m)} className="w-full text-left rounded-xl border border-[#EEF2FB] bg-white px-3 py-2 mb-1.5 hover:border-[#325099]">
                      <p className="text-[11px] text-[#2A2035]/45"><span className="font-semibold text-[#062E63]">{c ? channelLabel(c) : 'channel'}</span> · {m.sender_name} · {fmtDay(m.created_at)} {fmtTime(m.created_at)}</p>
                      <p className="text-sm text-[#2A2035] line-clamp-2">{bodyPreview(m.body)}</p>
                    </button>
                  )
                })}
              </div>
            ) : !current ? null : messages === null ? (
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
                  <div id={`msg-${m.id}`} className={`group relative flex gap-3 rounded-lg px-1 -mx-1 py-0.5 hover:bg-[#F8FAFF] ${grouped ? 'mt-2' : 'mt-4'}`}
                    onClick={(e) => { if (e.target.closest('a, button') || !window.matchMedia('(max-width: 767px)').matches) return; setPicker(picker === m.id ? null : m.id) }}>
                    <div className="w-8 shrink-0 flex items-start justify-end">
                      {grouped && <span className="hidden group-hover:block text-[9px] text-[#2A2035]/40 leading-[22px] pr-0.5">{fmtTime(m.created_at)}</span>}
                      {!grouped && (m.as_cube
                        ? <span className="w-8 h-8 rounded-full bg-[#062E63] text-white flex items-center justify-center"><CubeLogo className="h-4 w-auto" /></span>
                        : <span className="w-8 h-8 rounded-full text-[11px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(m.sender_id) }}>{initials(m.sender_name || nameOf(m.sender_id))}</span>)}
                    </div>
                    <div className="min-w-0 flex-1">
                      {!grouped && <p className="text-[12px] leading-tight"><span className="font-bold text-[#062E63]">{m.as_cube ? 'CUBE' : (m.sender_name || nameOf(m.sender_id))}</span>{m.as_cube && isAdmin && <span className="text-[10px] text-[#2A2035]/40 ml-1">via {nameOf(m.sender_id).split(' ')[0]}</span>} <span className="text-[10px] text-[#2A2035]/40 ml-1">{fmtTime(m.created_at)}</span></p>}
                      {m.deleted_at
                        ? <p className="text-[13px] italic text-[#2A2035]/35">message deleted</p>
                        : <p className={`text-[14px] leading-relaxed text-[#2A2035] break-words ${editing === m.id ? 'bg-[#FFFBEB] rounded px-1 -mx-1' : ''}`} dangerouslySetInnerHTML={{ __html: renderBody(m.body, staffNames) + (m.edited_at ? ' <span class="text-[10px] text-[#2A2035]/35">(edited)</span>' : '') }} />}
                      {(() => {
                        const rs = reactions[m.id] || []
                        if (!rs.length || m.deleted_at) return null
                        const byEmoji = {}
                        for (const r of rs) (byEmoji[r.emoji] ||= []).push(r.user_id)
                        return (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.entries(byEmoji).map(([emoji, uids]) => (
                              <button key={emoji} onClick={() => react(m, emoji)} title={uids.map(nameOf).join(', ')}
                                className={`text-[12px] rounded-full px-2 py-0.5 border ${uids.includes(me.id) ? 'bg-[#DEE7FF] border-[#325099] text-[#062E63]' : 'bg-white border-[#DEE7FF] text-[#2A2035]/70 hover:border-[#325099]'}`}>
                                {emoji} <span className="text-[11px] font-semibold">{uids.length}</span>
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                      {seenBy[m.id] && (
                        <div className="flex items-center gap-1 mt-1" title={`Seen by ${seenBy[m.id].map(nameOf).join(', ')}`}>
                          <span className="text-[10px] text-[#2A2035]/40">Seen</span>
                          {seenBy[m.id].slice(0, 6).map(uid => (
                            <span key={uid} className="w-4 h-4 rounded-full text-[8px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(uid) }}>{initials(nameOf(uid))}</span>
                          ))}
                          {seenBy[m.id].length > 6 && <span className="text-[10px] text-[#2A2035]/40">+{seenBy[m.id].length - 6}</span>}
                        </div>
                      )}
                    </div>
                    {!m.deleted_at && (
                      <div className={`absolute -top-3 right-2 ${picker === m.id ? 'flex' : 'hidden md:group-hover:flex'} items-center gap-0.5 bg-white border border-[#DEE7FF] rounded-full shadow-sm px-1 py-0.5 z-10`}>
                        {(picker === m.id ? QUICK_EMOJI : QUICK_EMOJI.slice(0, 4)).map(e => (
                          <button key={e} onClick={() => react(m, e)} className="text-[15px] leading-none w-7 h-7 rounded-full hover:bg-[#F0F4FF]" title={`React ${e}`}>{e}</button>
                        ))}
                        <button onClick={() => setPicker(picker === m.id ? null : m.id)} className="text-[11px] w-7 h-7 rounded-full text-[#325099] hover:bg-[#F0F4FF]" title="More">{picker === m.id ? '✕' : '＋'}</button>
                        {mine && (
                          <>
                            <button onClick={() => startEdit(m)} className="text-[11px] px-1.5 text-[#325099] hover:underline">Edit</button>
                            <button onClick={() => remove(m)} className="text-[11px] px-1.5 text-[#2A2035]/40 hover:text-[#B23A3A]">Delete</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {current && current.mine && (
            <div className="relative px-3 md:px-4 pt-2 bg-white border-t border-[#DEE7FF]" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              {mention && mentionMatches.length > 0 && (
                <div className="absolute bottom-full left-4 mb-1 bg-white border border-[#BACBFF] rounded-xl shadow-xl overflow-hidden w-64 max-w-[calc(100vw-2rem)] z-10">
                  {mentionMatches.map((s, i) => (
                    <button key={s.id} onMouseDown={e => { e.preventDefault(); pickMention(s) }} className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${i === 0 ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8FAFF]'}`}>
                      <span className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(s.id) }}>{initials(s.full_name)}</span>{s.full_name}
                    </button>
                  ))}
                </div>
              )}
              {(() => {
                const who = Object.entries(typing).filter(([, cid]) => cid === current.id).map(([uid]) => nameOf(uid).split(' ')[0])
                return who.length ? <p className="text-[11px] text-[#325099]/70 mb-1 h-4">{who.join(', ')} {who.length === 1 ? 'is' : 'are'} typing…</p> : <p className="h-4 mb-1" />
              })()}
              {editing && <p className="text-[11px] text-[#92400E] mb-1">Editing your message · Esc to cancel</p>}
              {asCube && !editing && <p className="text-[11px] text-[#062E63] mb-1">Sending as <b>CUBE</b>{current.kind !== 'cube_dm' ? ' · switch to your own name at the top of the list' : ''}</p>}
              {!canPost ? (
                <div className="rounded-xl border border-dashed border-[#DEE7FF] px-4 py-3 text-xs text-[#2A2035]/50">
                  📣 Only directors can post in {channelLabel(current)}. You can still react to messages.
                </div>
              ) : (
              <div className="flex items-end gap-2">
                {me.isAdmin && (
                  <div className="relative shrink-0">
                    <button onClick={() => setShortcutPick(o => !o)} title="Insert a shortcut"
                      className={`h-[42px] w-[42px] rounded-xl border text-lg ${shortcutPick ? 'border-[#325099] bg-[#F0F4FF]' : 'border-[#DEE7FF] hover:bg-[#F8FAFF]'}`}>⚡</button>
                    {shortcutPick && (
                      <div className="absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-1.5rem)] max-h-80 overflow-y-auto bg-white border border-[#DEE7FF] rounded-2xl shadow-xl p-1.5 z-20">
                        <div className="flex items-center justify-between px-2 py-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60">Shortcuts</p>
                          <button onClick={() => { setShortcutPick(false); setShortcutEdit({ title: '', body: '' }) }} className="text-[11px] font-semibold text-[#325099] hover:underline">+ New</button>
                        </div>
                        {visibleShortcuts.length === 0 && <p className="px-2 py-2 text-xs text-[#2A2035]/45">No shortcuts yet.</p>}
                        {visibleShortcuts.map(sc => (
                          <div key={sc.id} className="group/pk flex items-start rounded-lg hover:bg-[#F8FAFF]">
                            <button onClick={() => insertShortcut(sc)} className="flex-1 min-w-0 text-left px-2 py-1.5">
                              <p className="text-sm font-semibold text-[#062E63] truncate">{sc.title}</p>
                              <p className="text-[11px] text-[#2A2035]/50 line-clamp-2">{fillShortcut(sc.body, shortcutVars())}</p>
                            </button>
                            <button onClick={() => openBulk(sc)} title="Send to several teachers at once" className="shrink-0 px-2 py-1.5 text-[11px] text-[#325099] hover:underline">Send to…</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <input ref={fileRef} type="file" className="hidden" onChange={e => attach(e.target.files?.[0])} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach an image or a file (or paste an image)"
                  className="h-[42px] w-[42px] shrink-0 rounded-xl border border-[#DEE7FF] text-[#325099] hover:bg-[#F8FAFF] disabled:opacity-40 text-lg">{uploading ? '…' : '📎'}</button>
                <textarea ref={taRef} value={text} onChange={onChange} onKeyDown={onKey} onPaste={onPasteComposer} rows={1}
                  placeholder={typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? `Message ${channelLabel(current)}` : `Message ${channelLabel(current)} — Enter to send, Shift+Enter for a new line, @ to mention, 📎 for a file`}
                  className="flex-1 min-w-0 border border-[#DEE7FF] rounded-xl px-3.5 py-2.5 text-sm text-[#2A2035] resize-none max-h-40 focus:outline-none focus:border-[#325099]"
                  style={{ height: 'auto', minHeight: 42 }}
                  onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px' }} />
                <button onClick={send} disabled={!text.trim()} className="h-[42px] px-4 rounded-xl bg-[#062E63] text-white text-sm font-semibold hover:bg-[#325099] disabled:opacity-40">{editing ? 'Save' : 'Send'}</button>
              </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

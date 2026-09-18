'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { authedFetch } from './authedFetch'
import { normalisePhone, formatPhone } from './phone'
import { T_STUDENTS, T_PARENTS } from './tables'

/*
 * useSmsInbox — everything the Messages screens share: the texts and calls on
 * the office number, live updates, threads grouped by phone, the contact
 * names resolved from students.phone / guardians.phone, the family picker
 * options, marking a thread read, and sending a reply.
 *
 * Two screens use it: the admin page inside the portal (Admin › Messages) and
 * the standalone phone app at /messages. Keeping the logic here means a fix
 * lands in both.
 */

export const fmtTime = (iso) => {
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

export function useSmsInbox({ enabled }) {
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState([])
  const [calls, setCalls] = useState([])
  const [contacts, setContacts] = useState({})      // E.164 → { label, sub }
  const [people, setPeople] = useState([])          // picker options

  useEffect(() => {
    if (!enabled) return
    let dead = false
    ;(async () => {
      const [{ data: msgs }, { data: callRows }, { data: students }, { data: guardians }] = await Promise.all([
        supabase.from('sms_messages').select('*').order('created_at', { ascending: true }).limit(5000),
        supabase.from('phone_calls').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from(T_STUDENTS).select('id, full_name, phone, status'),
        supabase.from(T_PARENTS).select('id, full_name, phone, relationship, student_id').not('phone', 'is', null),
      ])
      if (dead) return
      const byStudent = Object.fromEntries((students || []).map((s) => [s.id, s]))
      // contacts: number → who it belongs to (names threads and alert emails)
      const map = {}
      ;(guardians || []).forEach((g) => {
        const e = normalisePhone(g.phone); if (!e) return
        const st = byStudent[g.student_id]
        const sub = st ? `${g.relationship || 'Guardian'} of ${st.full_name}` : (g.relationship || 'Guardian')
        map[e] = map[e] ? { ...map[e], sub: map[e].sub + ' · ' + sub } : { label: g.full_name, sub }
      })
      ;(students || []).forEach((s) => {
        const e = normalisePhone(s.phone); if (!e) return
        if (!map[e]) map[e] = { label: s.full_name, sub: `Student${s.status && s.status !== 'active' ? ` · ${s.status}` : ''}` }
      })
      // picker: one row per current student per number on file. A student with
      // no number at all is still listed, greyed, so the gap is visible.
      const opts = []
      const current = (students || []).filter((s) => ['active', 'trial', 'pending'].includes(s.status || 'active'))
      current.forEach((s) => {
        const tag = s.status && s.status !== 'active' ? ` · ${s.status}` : ''
        const rows = []
        ;(guardians || []).filter((g) => g.student_id === s.id).forEach((g) => {
          const e = normalisePhone(g.phone); if (!e) return
          rows.push({ value: e, label: `${s.full_name}${tag}`, sub: `${g.full_name} (${g.relationship || 'guardian'}) · ${formatPhone(e)}` })
        })
        const own = normalisePhone(s.phone)
        if (own) rows.push({ value: own, label: `${s.full_name}${tag}`, sub: `Student's own phone · ${formatPhone(own)}` })
        if (!rows.length) rows.push({ value: `none:${s.id}`, label: `${s.full_name}${tag}`, sub: 'No phone number on file — add one to the student or a guardian', disabled: true })
        opts.push(...rows)
      })
      setContacts(map)
      setPeople(opts.sort((a, b) => a.label.localeCompare(b.label) || (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0)))
      setMessages(msgs || [])
      setCalls(callRows || [])
      setLoaded(true)
    })()
    return () => { dead = true }
  }, [enabled])

  // Live: texts and calls arriving while the screen is open.
  useEffect(() => {
    if (!loaded) return
    const ch = supabase.channel('sms-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sms_messages' }, (payload) => {
        const row = payload.new
        if (!row?.id) return
        setMessages((prev) => prev.some((m) => m.id === row.id) ? prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)) : [...prev, row])
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'phone_calls' }, (payload) => {
        const row = payload.new
        if (!row?.id) return
        setCalls((prev) => prev.some((c) => c.id === row.id) ? prev.map((c) => (c.id === row.id ? { ...c, ...row } : c)) : [row, ...prev])
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loaded])

  const threads = useMemo(() => {
    const by = {}
    messages.forEach((m) => { (by[m.phone] ||= []).push(m) })
    return Object.entries(by).map(([phone, list]) => {
      const last = list[list.length - 1]
      return { phone, list, last, unread: list.filter((m) => m.direction === 'in' && !m.read_at).length, unanswered: last?.direction === 'in' }
    }).sort((a, b) => new Date(b.last?.created_at || 0) - new Date(a.last?.created_at || 0))
  }, [messages])

  const who = (phone) => contacts[phone]
  const nameOf = (phone) => contacts[phone]?.label || formatPhone(phone)

  // Opening a thread marks what the family sent as read.
  const markRead = async (phone) => {
    const ids = messages.filter((m) => m.phone === phone && m.direction === 'in' && !m.read_at).map((m) => m.id)
    if (!ids.length) return
    const now = new Date().toISOString()
    await supabase.from('sms_messages').update({ read_at: now }).in('id', ids)
    setMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, read_at: now } : m)))
  }

  // Sends from the office number; throws with a readable message on failure.
  const send = async (to, body) => {
    const res = await authedFetch('/api/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, body }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || `Send failed (${res.status})`)
    setMessages((prev) => prev.some((m) => m.id === json.message.id) ? prev : [...prev, json.message])
    return json.message
  }

  return { loaded, messages, calls, threads, contacts, people, who, nameOf, markRead, send }
}

'use client'
import { useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import { authedFetch } from '../../../../lib/authedFetch'
import { normalisePhone, formatPhone } from '../../../../lib/phone'
import { T_STUDENTS, T_PARENTS } from '../../../../lib/tables'
import TutorNav from '../../../../components/TutorNav'
import SearchSelectPopover from '../../../../components/SearchSelectPopover'

/*
 * Messages — /tutor/admin/messages (admin + director)
 *
 * Every text to and from the office number, grouped into a thread per phone
 * number. Names come from students.phone and guardians.phone, so a parent's
 * text shows as "Yeong A Lee · Mother of Jiwoo" rather than a bare number.
 * Opening a thread marks its incoming texts read; the "Unanswered" filter lists
 * threads whose last message came from the family. Live: new texts appear
 * without a refresh.
 */

const fmtTime = (iso) => {
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

export default function MessagesPage() {
  return <Suspense><MessagesInner /></Suspense>
}

function MessagesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [messages, setMessages] = useState([])
  const [contacts, setContacts] = useState({})      // E.164 → { label, sub }
  const [people, setPeople] = useState([])          // picker options for a new conversation
  const [selected, setSelected] = useState(() => normalisePhone(searchParams.get('phone') || '') || null)
  const [filter, setFilter] = useState('all')       // all | unanswered
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [newPop, setNewPop] = useState(null)
  const [newNumber, setNewNumber] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)
      const [{ data: msgs }, { data: students }, { data: guardians }] = await Promise.all([
        supabase.from('sms_messages').select('*').order('created_at', { ascending: true }).limit(5000),
        supabase.from(T_STUDENTS).select('id, full_name, phone, status').not('phone', 'is', null),
        supabase.from(T_PARENTS).select('id, full_name, phone, relationship, student_id').not('phone', 'is', null),
      ])
      const byStudent = Object.fromEntries((students || []).map((s) => [s.id, s]))
      const map = {}, opts = []
      ;(guardians || []).forEach((g) => {
        const e = normalisePhone(g.phone); if (!e) return
        const st = byStudent[g.student_id]
        const sub = st ? `${g.relationship || 'Guardian'} of ${st.full_name}` : (g.relationship || 'Guardian')
        map[e] = map[e] ? { ...map[e], sub: map[e].sub + ' · ' + sub } : { label: g.full_name, sub }
        opts.push({ value: e, label: g.full_name, sub: `${sub} · ${formatPhone(e)}` })
      })
      ;(students || []).forEach((s) => {
        const e = normalisePhone(s.phone); if (!e) return
        if (!map[e]) map[e] = { label: s.full_name, sub: `Student${s.status && s.status !== 'active' ? ` · ${s.status}` : ''}` }
        opts.push({ value: e, label: s.full_name, sub: `Student · ${formatPhone(e)}` })
      })
      setContacts(map); setPeople(opts.sort((a, b) => a.label.localeCompare(b.label)))
      setMessages(msgs || [])
      setReady(true)
    })()
  }, [router])

  // Live: texts arriving while the page is open.
  useEffect(() => {
    if (!ready) return
    const ch = supabase.channel('sms-messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sms_messages' }, (payload) => {
        const row = payload.new
        if (!row?.id) return
        setMessages((prev) => prev.some((m) => m.id === row.id) ? prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)) : [...prev, row])
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [ready])

  const threads = useMemo(() => {
    const by = {}
    messages.forEach((m) => { (by[m.phone] ||= []).push(m) })
    if (selected && !by[selected]) by[selected] = []
    return Object.entries(by).map(([phone, list]) => {
      const last = list[list.length - 1]
      return { phone, list, last, unread: list.filter((m) => m.direction === 'in' && !m.read_at).length, unanswered: last?.direction === 'in' }
    }).sort((a, b) => new Date(b.last?.created_at || 0) - new Date(a.last?.created_at || 0))
  }, [messages, selected])
  const shown = filter === 'unanswered' ? threads.filter((t) => t.unanswered) : threads
  const thread = threads.find((t) => t.phone === selected)

  // Opening a thread marks what the family sent as read.
  useEffect(() => {
    if (!thread) return
    const ids = thread.list.filter((m) => m.direction === 'in' && !m.read_at).map((m) => m.id)
    if (!ids.length) return
    const now = new Date().toISOString()
    supabase.from('sms_messages').update({ read_at: now }).in('id', ids).then(() => {
      setMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, read_at: now } : m)))
    })
  }, [thread])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [selected, messages.length])

  const send = async () => {
    const body = draft.trim()
    if (!body || !selected || sending) return
    setSending(true); setError('')
    try {
      const res = await authedFetch('/api/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: selected, body }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Send failed (${res.status})`)
      setMessages((prev) => prev.some((m) => m.id === json.message.id) ? prev : [...prev, json.message])
      setDraft('')
    } catch (e) { setError(e.message) }
    finally { setSending(false) }
  }

  const startNew = (phone) => { const e = normalisePhone(phone); if (!e) return; setSelected(e); setNewPop(null); setNewNumber(''); setFilter('all') }

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  const totalUnread = threads.reduce((s, t) => s + t.unread, 0)
  const who = (phone) => contacts[phone]

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={true} />
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-12">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Messages</h1>
            <p className="text-sm text-[#325099]/60 mt-1">Texts to and from the office number.{totalUnread ? ` ${totalUnread} unread.` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden text-xs">
              <button onClick={() => setFilter('all')} className={`px-3 py-1.5 font-semibold ${filter === 'all' ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>All</button>
              <button onClick={() => setFilter('unanswered')} className={`px-3 py-1.5 font-semibold border-l border-[#DEE7FF] ${filter === 'unanswered' ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>
                Unanswered{threads.filter((t) => t.unanswered).length ? ` (${threads.filter((t) => t.unanswered).length})` : ''}
              </button>
            </div>
            <button onClick={(e) => setNewPop(e.currentTarget.getBoundingClientRect())}
              className="px-3.5 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition">+ New text</button>
          </div>
        </div>

        <div className="grid md:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
          {/* Threads */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] overflow-hidden">
            {shown.length === 0 ? (
              <p className="text-sm text-[#2A2035]/45 px-5 py-10 text-center">{filter === 'unanswered' ? 'Nothing waiting for a reply.' : 'No texts yet. When a family texts the office number it appears here.'}</p>
            ) : shown.map((t) => {
              const c = who(t.phone)
              return (
                <button key={t.phone} onClick={() => setSelected(t.phone)}
                  className={`w-full text-left px-4 py-3 border-b border-[#F0F4FF] last:border-b-0 transition ${selected === t.phone ? 'bg-[#EEF3FF]' : 'hover:bg-[#F8FAFF]'}`}>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold text-[#062E63]">{c?.label || formatPhone(t.phone)}</span>
                    {t.last && <span className="text-[10px] text-[#2A2035]/40 shrink-0">{fmtTime(t.last.created_at)}</span>}
                    {t.unread > 0 && <span className="text-[10px] font-bold bg-[#325099] text-white rounded-full px-1.5 py-0.5 shrink-0">{t.unread}</span>}
                  </div>
                  {c?.sub && <p className="text-[11px] text-[#2A2035]/45 truncate">{c.sub}</p>}
                  {t.last && <p className={`text-xs truncate mt-0.5 ${t.unanswered ? 'text-[#2A2035]' : 'text-[#2A2035]/50'}`}>{t.last.direction === 'out' ? 'You: ' : ''}{t.last.body}</p>}
                </button>
              )
            })}
          </div>

          {/* Conversation */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] flex flex-col" style={{ minHeight: 'calc(100vh - 220px)' }}>
            {!thread ? (
              <p className="text-sm text-[#2A2035]/45 px-6 py-16 text-center">Pick a conversation, or start a new text.</p>
            ) : (
              <>
                <div className="px-5 py-3 border-b border-[#F0F4FF]">
                  <p className="text-sm font-bold text-[#062E63]">{who(thread.phone)?.label || formatPhone(thread.phone)}</p>
                  <p className="text-[11px] text-[#2A2035]/45">{who(thread.phone)?.sub ? `${who(thread.phone).sub} · ` : ''}{formatPhone(thread.phone)}</p>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2" style={{ maxHeight: 'calc(100vh - 340px)' }}>
                  {thread.list.length === 0 && <p className="text-xs text-[#2A2035]/40 text-center py-6">No messages yet with this number.</p>}
                  {thread.list.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.direction === 'out' ? 'bg-[#325099] text-white rounded-br-md' : 'bg-[#F0F4FF] text-[#2A2035] rounded-bl-md'}`}>
                        {m.body}
                        <div className={`text-[10px] mt-1 ${m.direction === 'out' ? 'text-white/65' : 'text-[#2A2035]/40'}`}>
                          {fmtTime(m.created_at)}{m.direction === 'out' && m.sent_by ? ` · ${m.sent_by}` : ''}
                          {m.direction === 'out' && (m.status === 'failed' || m.status === 'undelivered') ? ` · not delivered${m.error ? ` (${m.error})` : ''}` : ''}
                          {m.direction === 'out' && m.status === 'delivered' ? ' · delivered' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
                <div className="border-t border-[#F0F4FF] px-4 py-3">
                  {error && <p className="text-xs text-[#DC2626] mb-2">{error}</p>}
                  <div className="flex gap-2 items-end">
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Type a text…"
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
                      className="flex-1 border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#325099] resize-none" />
                    <button onClick={send} disabled={sending || !draft.trim()}
                      className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-40">{sending ? 'Sending…' : 'Send'}</button>
                  </div>
                  <p className="text-[10px] text-[#2A2035]/35 mt-1.5">Sent from the office number as {profile?.full_name}. ⌘↵ to send.</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {newPop && (
        <div className="fixed inset-0 z-40" onMouseDown={() => setNewPop(null)}>
          <div className="fixed bg-white border border-[#BACBFF] rounded-xl shadow-2xl p-3 w-[320px]" style={{ top: newPop.bottom + 6, left: Math.max(8, newPop.right - 320) }} onMouseDown={(e) => e.stopPropagation()}>
            <p className="text-[11px] font-semibold text-[#2A2035]/50 mb-1.5">Text a number</p>
            <div className="flex gap-1.5">
              <input value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="04xx xxx xxx" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') startNew(newNumber) }}
                className="flex-1 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#325099]" />
              <button onClick={() => startNew(newNumber)} className="px-3 rounded-lg bg-[#325099] text-white text-xs font-semibold">Open</button>
            </div>
            <p className="text-[11px] font-semibold text-[#2A2035]/50 mt-3 mb-1.5">or pick a family</p>
            <PeoplePicker people={people} onPick={startNew} />
          </div>
        </div>
      )}
    </div>
  )
}

function PeoplePicker({ people, onPick }) {
  const [pop, setPop] = useState(null)
  return (
    <>
      <button onClick={(e) => setPop(e.currentTarget.getBoundingClientRect())}
        className="w-full text-left border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-sm text-[#2A2035]/60 hover:border-[#325099]">Search students and parents…</button>
      {pop && <SearchSelectPopover anchor={pop} options={people} currentValue={null} placeholder="Name…" onSelect={(v) => { setPop(null); onPick(v) }} onClose={() => setPop(null)} />}
    </>
  )
}

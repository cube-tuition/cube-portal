'use client'
import { useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getAuthProfile } from '../../lib/getProfile'
import { useSmsInbox, fmtTime } from '../../lib/useSmsInbox'
import { normalisePhone, formatPhone } from '../../lib/phone'
import PushEnable from '../../components/PushEnable'
import StaffChat from '../../components/chat/StaffChat'

/*
 * CUBE Messages — /messages (directors only — the 'admin' and 'director' roles; not tutors)
 *
 * The office number's texts, shaped like a messaging app: Chats / Calls / Staff
 * on a bottom tab bar, a chat list with avatars and previews, a ✎ button that
 * opens a full-screen contact list to start a new chat, and a conversation
 * with grouped bubbles, date separators and delivery ticks. Installable from
 * the browser's "Add to Home Screen" (see layout.js and manifest.webmanifest)
 * and, once the "Notify me" button is on, pushes a notification for every
 * incoming text, missed call and voicemail.
 *
 * Same data and logic as Admin › Messages inside the portal (lib/useSmsInbox);
 * this is just the phone-shaped face of it.
 */

const AVATAR = ['#325099', '#0E7490', '#7C3AED', '#B45309', '#15803D', '#BE185D', '#4338CA', '#0F766E']
const initials = (n) => (n || '?').split(/\s+/).map((p) => p[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()
const colorFor = (key) => AVATAR[[...String(key || '')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR.length]
const dayKey = (iso) => new Date(iso).toDateString()
const fmtDay = (iso) => {
  const d = new Date(iso), now = new Date(), y = new Date(); y.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
// Chat-list time: time today, weekday this week, else a short date.
const fmtListTime = (iso) => {
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  if (now - d < 6 * 86400000) return d.toLocaleDateString('en-AU', { weekday: 'short' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
const Avatar = ({ name, size = 'w-12 h-12 text-base' }) => (
  <span className={`${size} rounded-full text-white font-bold flex items-center justify-center shrink-0`} style={{ background: colorFor(name) }}>{initials(name)}</span>
)
// Delivery ticks on an outbound bubble, WhatsApp style.
const Ticks = ({ status }) => {
  if (status === 'failed' || status === 'undelivered') return <span className="text-[#FCA5A5] font-bold" title="Not delivered">!</span>
  if (status === 'delivered') return <span title="Delivered">✓✓</span>
  return <span title="Sent">✓</span>
}

export default function MessagesApp() {
  return <Suspense><MessagesAppInner /></Suspense>
}

function MessagesAppInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState(null)
  const [me, setMe] = useState(null)
  const [allowed, setAllowed] = useState(false)
  const [denied, setDenied] = useState(false)
  const [selected, setSelected] = useState(() => normalisePhone(searchParams.get('phone') || '') || null)
  const [view, setView] = useState(() => (searchParams.get('phone') ? 'thread' : 'list'))   // list | thread | new
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('texts')   // texts | calls | staff
  const [search, setSearch] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [staffInChat, setStaffInChat] = useState(false)   // Staff tab: a thread is open, so the tab bar hides
  const endRef = useRef(null)
  const inbox = useSmsInbox({ enabled: allowed })

  useEffect(() => {
    (async () => {
      const { user, profile, role } = await getAuthProfile()
      if (!user) { router.replace('/?next=/messages'); return }
      if (role !== 'admin' && role !== 'director') { setDenied(true); return }   // directors sign in as 'admin'; tutors are kept out
      setProfile(profile); setMe({ id: user.id, full_name: profile?.full_name || user.email, isAdmin: true }); setAllowed(true)
    })()
  }, [router])

  // iOS rubber-bands the whole web view when a drag has nowhere to go, which
  // drags the pinned bottom bar with it. Let a drag through only when a list
  // under the finger can still scroll that way; otherwise swallow it.
  useEffect(() => {
    let startY = 0
    const onStart = (e) => { startY = e.touches[0]?.clientY ?? 0 }
    const onMove = (e) => {
      if (e.touches.length !== 1) return
      const dy = e.touches[0].clientY - startY
      for (let el = e.target; el && el !== document.body; el = el.parentElement) {
        const st = getComputedStyle(el)
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1) {
          const atTop = el.scrollTop <= 0, atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
          if ((dy > 0 && !atTop) || (dy < 0 && !atBottom)) return
          break
        }
      }
      if (e.cancelable) e.preventDefault()
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    return () => { document.removeEventListener('touchstart', onStart); document.removeEventListener('touchmove', onMove) }
  }, [])

  const thread = inbox.threads.find((t) => t.phone === selected) || (selected ? { phone: selected, list: [], unread: 0 } : null)
  useEffect(() => { if (view === 'thread' && selected && inbox.loaded) inbox.markRead(selected) }, [view, selected, inbox.loaded, inbox.messages.length])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'thread') endRef.current?.scrollIntoView({ block: 'end' }) }, [view, selected, inbox.messages.length])

  const open = (phone) => { setSelected(phone); setView('thread'); setError(''); setContactSearch(''); window.history.replaceState(null, '', `/messages?phone=${encodeURIComponent(phone)}`) }
  const back = () => { setView('list'); window.history.replaceState(null, '', '/messages') }
  const send = async () => {
    const body = draft.trim()
    if (!body || !selected || sending) return
    setSending(true); setError('')
    try { await inbox.send(selected, body); setDraft('') } catch (e) { setError(e.message) } finally { setSending(false) }
  }

  // The New chat screen: every person with a number, grouped A–Z by their own
  // name (families first, then staff), filtered by the search box.
  const contactGroups = useMemo(() => {
    const q = contactSearch.trim().toLowerCase()
    const rows = inbox.people.filter((p) => !p.disabled).map((p) => ({ ...p, person: p.person || p.label || p.value }))
      .filter((p) => !q || `${p.person} ${p.student || ''} ${p.relation || ''} ${p.value}`.toLowerCase().includes(q))
    const families = rows.filter((p) => p.kind !== 'staff').sort((a, b) => a.person.localeCompare(b.person))
    const staff = rows.filter((p) => p.kind === 'staff').sort((a, b) => a.person.localeCompare(b.person))
    const byLetter = []
    families.forEach((p) => {
      const L = (p.person[0] || '#').toUpperCase()
      const g = byLetter[byLetter.length - 1]
      if (g && g.label === L) g.rows.push(p); else byLetter.push({ label: L, rows: [p] })
    })
    if (staff.length) byLetter.push({ label: 'Staff', rows: staff })
    return byLetter
  }, [inbox.people, contactSearch])

  if (denied) return (
    <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center px-6 text-center">
      <div><p className="text-lg font-bold text-[#062E63]">CUBE Messages</p><p className="text-sm text-[#2A2035]/55 mt-2">This app is for the directors, not tutors. <Link href="/tutor" className="text-[#325099] font-semibold">Back to the portal →</Link></p></div>
    </div>
  )
  if (!allowed || !inbox.loaded) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const totalUnread = inbox.threads.reduce((s, t) => s + t.unread, 0)
  const missed = inbox.calls.filter((c) => c.status === 'missed' || c.status === 'voicemail').length

  // ── new chat: full-screen contact list ──────────────────────────────────────
  if (view === 'new') {
    return (
      <div className="fixed inset-0 flex flex-col bg-[#F8FAFF]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <header className="shrink-0 bg-white border-b border-[#DEE7FF] px-3 pt-2 pb-2">
          <div className="flex items-center gap-1">
            <button onClick={back} className="w-10 h-10 rounded-full flex items-center justify-center text-[#325099] text-2xl active:bg-[#EEF3FF]" aria-label="Back">‹</button>
            <div className="flex-1 min-w-0">
              <p className="text-[17px] font-bold text-[#062E63]">New chat</p>
              <p className="text-[11px] text-[#2A2035]/45">{inbox.people.filter((p) => !p.disabled).length} contacts</p>
            </div>
          </div>
          <input value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} placeholder="Search name or student" autoFocus
            className="mt-2 w-full bg-[#F0F4FF] rounded-xl px-3.5 py-2 text-[15px] focus:outline-none" />
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {contactGroups.length === 0 && <p className="text-sm text-[#2A2035]/45 px-6 py-16 text-center">No one matches.</p>}
          {contactGroups.map((g) => (
            <div key={g.label}>
              <p className="sticky top-0 bg-[#F8FAFF] px-4 py-1 text-[11px] font-bold tracking-wider uppercase text-[#325099]/70">{g.label}</p>
              <ul className="bg-white divide-y divide-[#EEF1F6]">
                {g.rows.map((p) => (
                  <li key={`${p.value}-${p.student || ''}`}>
                    <button onClick={() => open(p.value)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 active:bg-[#EEF3FF]">
                      <Avatar name={p.person} size="w-11 h-11 text-sm" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-semibold text-[#2A2035] truncate">{p.person}</span>
                        <span className="block text-[12px] text-[#2A2035]/50 truncate">
                          {p.kind === 'staff' ? p.relation : p.kind === 'student' ? `Student${p.year ? ` · Year ${p.year}` : ''}` : `${p.relation} of ${p.student}${p.year ? ` · Year ${p.year}` : ''}`}
                        </span>
                      </span>
                      <span className="text-[11px] text-[#2A2035]/35 shrink-0">{formatPhone(p.value)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── thread view ─────────────────────────────────────────────────────────────
  if (view === 'thread' && thread) {
    const c = inbox.who(thread.phone)
    const context = c?.kind === 'guardian' ? `${c.sub}${c.year ? ` · Year ${c.year}` : ''}`
      : c?.kind === 'student' ? `Student${c.year ? ` · Year ${c.year}` : ''}`
      : c?.sub || ''
    return (
      <div className="fixed inset-0 flex flex-col bg-[#EEF3FB]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <header className="flex items-center gap-2 px-2 py-2 bg-white border-b border-[#DEE7FF] shrink-0">
          <button onClick={back} className="w-10 h-10 rounded-full flex items-center justify-center text-[#325099] text-2xl active:bg-[#EEF3FF]" aria-label="Back">‹</button>
          <Avatar name={c?.label || thread.phone} size="w-10 h-10 text-sm" />
          {/* Who this is — and, for a family, a tap through to the student's record. */}
          {c?.studentId ? (
            <Link href={`/tutor/database?student=${c.studentId}`} className="flex-1 min-w-0 active:opacity-70">
              <p className="text-[16px] font-bold text-[#062E63] truncate leading-tight">{c.label}</p>
              <p className="text-[12px] text-[#325099] truncate">{context} <span className="text-[#325099]/50">›</span></p>
            </Link>
          ) : (
            <div className="flex-1 min-w-0">
              <p className="text-[16px] font-bold text-[#062E63] truncate leading-tight">{c?.label || formatPhone(thread.phone)}</p>
              <p className="text-[12px] text-[#2A2035]/45 truncate">{context ? `${context} · ` : ''}{formatPhone(thread.phone)}</p>
            </div>
          )}
          <a href={`tel:${thread.phone}`} className="w-10 h-10 rounded-full flex items-center justify-center text-[#325099] text-lg active:bg-[#EEF3FF]" title="Call from this phone (shows your own number)">📞</a>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {thread.list.length === 0 && (
            <div className="text-center py-10">
              <Avatar name={c?.label || thread.phone} size="w-16 h-16 text-xl mx-auto" />
              <p className="text-sm font-semibold text-[#062E63] mt-3">{c?.label || formatPhone(thread.phone)}</p>
              <p className="text-xs text-[#2A2035]/45 mt-1">No texts yet. Say hello from the office number.</p>
            </div>
          )}
          {thread.list.map((m, i) => {
            const prev = thread.list[i - 1]
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at)
            const grouped = !newDay && prev && prev.direction === m.direction && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60000
            const out = m.direction === 'out'
            return (
              <div key={m.id}>
                {newDay && <div className="flex justify-center my-3"><span className="text-[11px] font-semibold text-[#325099]/70 bg-white/80 rounded-full px-3 py-0.5">{fmtDay(m.created_at)}</span></div>}
                <div className={`flex ${out ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-0.5' : 'mt-2'}`}>
                  <div className={`max-w-[80%] px-3 py-1.5 text-[15px] leading-snug whitespace-pre-wrap shadow-sm ${
                    out ? `bg-[#325099] text-white rounded-2xl ${grouped ? '' : 'rounded-tr-md'}` : `bg-white text-[#2A2035] rounded-2xl ${grouped ? '' : 'rounded-tl-md'}`}`}>
                    {m.body}
                    <span className={`float-right ml-2 mt-1.5 text-[10px] whitespace-nowrap ${out ? 'text-white/70' : 'text-[#2A2035]/40'}`}>
                      {fmtTime(m.created_at).replace(/^.*?(\d{1,2}:\d{2}\s?[ap]m)$/i, '$1')}
                      {out && <span className="ml-1"><Ticks status={m.status} /></span>}
                    </span>
                    {out && m.sent_by && !grouped && <span className="block text-[10px] text-white/55 clear-both">{m.sent_by.split(' ')[0]}</span>}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>
        <div className="shrink-0 bg-white border-t border-[#DEE7FF] px-3 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
          {error && <p className="text-xs text-[#DC2626] mb-1.5">{error}</p>}
          <div className="flex gap-2 items-end">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder="Message" enterKeyHint="send"
              onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px' }}
              className="flex-1 border border-[#DEE7FF] rounded-2xl px-3.5 py-2 text-[15px] focus:outline-none focus:border-[#325099] resize-none bg-[#F8FAFF]" />
            <button onClick={send} disabled={sending || !draft.trim()} className="w-10 h-10 rounded-full bg-[#325099] text-white text-lg flex items-center justify-center hover:bg-[#062E63] disabled:opacity-40" aria-label="Send">➤</button>
          </div>
        </div>
      </div>
    )
  }

  // ── list view (Chats / Calls / Staff behind a bottom tab bar) ───────────────
  const q = search.trim().toLowerCase()
  const threads = q ? inbox.threads.filter((t) => `${inbox.nameOf(t.phone)} ${t.phone} ${t.last?.body || ''}`.toLowerCase().includes(q)) : inbox.threads
  const tabButton = (id, icon, label, badge) => (
    <button key={id} onClick={() => setTab(id)} className={`flex-1 flex flex-col items-center gap-0.5 py-2 ${tab === id ? 'text-[#062E63]' : 'text-[#2A2035]/45'}`}>
      <span className="relative text-[22px] leading-none">{icon}
        {badge > 0 && <span className="absolute -top-1 -right-3 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DC2626] text-white text-[10px] font-bold flex items-center justify-center">{badge}</span>}
      </span>
      <span className={`text-[11px] ${tab === id ? 'font-bold' : 'font-semibold'}`}>{label}</span>
    </button>
  )

  return (
    <div className="fixed inset-0 flex flex-col bg-[#F8FAFF]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {tab !== 'staff' && (
        <header className="shrink-0 bg-white border-b border-[#DEE7FF] px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              {/* The inbox has no portal nav; this is the way back to the rest of it. */}
              <Link href="/tutor" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#325099]/70">‹ Portal</Link>
              <h1 className="text-[22px] font-bold text-[#062E63] leading-tight">{tab === 'texts' ? 'Chats' : 'Calls'}</h1>
            </div>
            <PushEnable />
          </div>
          {tab === 'texts' && (
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
              className="mt-2 w-full bg-[#F0F4FF] rounded-xl px-3.5 py-2 text-[15px] focus:outline-none" />
          )}
        </header>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain relative">
        {tab === 'staff' ? (
          me && <StaffChat me={me} className="h-full" onConversationOpen={setStaffInChat} />
        ) : tab === 'texts' ? (
          threads.length === 0 ? (
            <p className="text-sm text-[#2A2035]/45 px-6 py-16 text-center">{q ? 'No chats match.' : 'No chats yet. Tap ✎ to text a family.'}</p>
          ) : (
            <ul className="divide-y divide-[#EEF1F6] bg-white">
              {threads.map((t) => {
                const c = inbox.who(t.phone)
                const name = c?.label || formatPhone(t.phone)
                return (
                  <li key={t.phone}>
                    <button onClick={() => open(t.phone)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 active:bg-[#EEF3FF]">
                      <Avatar name={name} />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-baseline gap-2">
                          <span className={`flex-1 min-w-0 truncate text-[16px] ${t.unread ? 'font-bold text-[#062E63]' : 'font-semibold text-[#2A2035]'}`}>{name}</span>
                          <span className={`text-[11px] shrink-0 ${t.unread ? 'text-[#325099] font-semibold' : 'text-[#2A2035]/40'}`}>{t.last ? fmtListTime(t.last.created_at) : ''}</span>
                        </span>
                        <span className="flex items-center gap-2 mt-0.5">
                          <span className={`flex-1 min-w-0 truncate text-[13px] ${t.unread ? 'text-[#2A2035]' : 'text-[#2A2035]/55'}`}>
                            {t.last?.direction === 'out' && <span className="mr-1 text-[#2A2035]/40"><Ticks status={t.last.status} /></span>}
                            {t.last?.body}
                          </span>
                          {t.unread > 0 && <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[#325099] text-white text-[11px] font-bold flex items-center justify-center">{t.unread}</span>}
                        </span>
                        {c?.sub && <span className="block text-[11px] text-[#2A2035]/40 truncate">{c.sub}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        ) : (
          inbox.calls.length === 0 ? (
            <p className="text-sm text-[#2A2035]/45 px-6 py-16 text-center">No calls yet.</p>
          ) : (
            <ul className="divide-y divide-[#EEF1F6] bg-white">
              {inbox.calls.map((c) => {
                const who = inbox.who(c.phone)
                const name = who?.label || formatPhone(c.phone)
                const style = { answered: 'text-[#166534]', missed: 'text-[#991B1B]', voicemail: 'text-[#92400E]', ringing: 'text-[#4338CA]' }[c.status] || ''
                return (
                  <li key={c.id} className="px-4 py-2.5 flex items-start gap-3">
                    <Avatar name={name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="flex-1 min-w-0 truncate text-[16px] font-semibold text-[#2A2035]">{name}</span>
                        <span className="text-[11px] text-[#2A2035]/40 shrink-0">{fmtListTime(c.created_at)}</span>
                      </div>
                      <p className={`text-[12px] font-semibold ${style}`}>{c.status === 'answered' ? `↙ Answered${c.duration_s != null ? ` · ${Math.floor(c.duration_s / 60)}:${String(c.duration_s % 60).padStart(2, '0')}` : ''}` : c.status === 'voicemail' ? '✉ Voicemail' : c.status === 'missed' ? '↙ Missed' : 'Ringing…'}</p>
                      {c.transcript && <p className="mt-1 text-[13px] text-[#2A2035]/75 italic">“{c.transcript}”</p>}
                      <div className="flex gap-4 mt-1">
                        <button onClick={() => { setTab('texts'); open(c.phone) }} className="text-[12px] font-semibold text-[#325099]">Text back</button>
                        <a href={`tel:${c.phone}`} className="text-[12px] font-semibold text-[#325099]">Call back</a>
                        {c.recording_sid && <Link href={`/tutor/admin/messages?tab=calls`} className="text-[12px] font-semibold text-[#325099]">Play in portal</Link>}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )
        )}

        {/* New chat — the floating button, like a messaging app */}
        {tab === 'texts' && (
          <button onClick={() => setView('new')} aria-label="New chat"
            className="fixed right-4 w-14 h-14 rounded-2xl bg-[#325099] text-white text-2xl shadow-lg shadow-[#325099]/30 flex items-center justify-center active:scale-95 transition"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}>✎</button>
        )}
      </div>

      {/* The tab bar belongs to the list screens: inside a staff thread it goes away
          (otherwise it would stack above the keyboard with the reply box). */}
      {!(tab === 'staff' && staffInChat) && (
      <nav className="shrink-0 bg-white border-t border-[#DEE7FF] flex" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabButton('texts', '💬', 'Chats', totalUnread)}
        {tabButton('calls', '📞', 'Calls', missed)}
        {tabButton('staff', '👥', 'Staff', 0)}
      </nav>
      )}
    </div>
  )
}

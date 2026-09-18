'use client'
import { useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getAuthProfile } from '../../lib/getProfile'
import { useSmsInbox, fmtTime } from '../../lib/useSmsInbox'
import { normalisePhone, formatPhone } from '../../lib/phone'
import SearchSelectPopover from '../../components/SearchSelectPopover'
import PushEnable from '../../components/PushEnable'

/*
 * CUBE Messages — /messages (directors only — the 'admin' and 'director' roles; not tutors)
 *
 * The office number's texts as a phone app: a thread list, a full-screen
 * conversation with a reply box, and a picker to start a new text with a
 * family. Installable from the browser's "Add to Home Screen" (see layout.js
 * and manifest.webmanifest) and, once the "Notify me" button is on, pushes a
 * notification for every incoming text, missed call and voicemail.
 *
 * Same data and logic as Admin › Messages inside the portal (lib/useSmsInbox);
 * this is just the phone-shaped face of it.
 */

export default function MessagesApp() {
  return <Suspense><MessagesAppInner /></Suspense>
}

function MessagesAppInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState(null)
  const [allowed, setAllowed] = useState(false)
  const [denied, setDenied] = useState(false)
  const [selected, setSelected] = useState(() => normalisePhone(searchParams.get('phone') || '') || null)
  const [view, setView] = useState(() => (searchParams.get('phone') ? 'thread' : 'list'))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [pickPop, setPickPop] = useState(null)
  const [tab, setTab] = useState('texts')   // texts | calls
  const endRef = useRef(null)
  const inbox = useSmsInbox({ enabled: allowed })

  useEffect(() => {
    (async () => {
      const { user, profile, role } = await getAuthProfile()
      if (!user) { router.replace('/?next=/messages'); return }
      if (role !== 'admin' && role !== 'director') { setDenied(true); return }   // directors sign in as 'admin'; tutors are kept out
      setProfile(profile); setAllowed(true)
    })()
  }, [router])

  const thread = inbox.threads.find((t) => t.phone === selected) || (selected ? { phone: selected, list: [], unread: 0 } : null)
  useEffect(() => { if (view === 'thread' && selected && inbox.loaded) inbox.markRead(selected) }, [view, selected, inbox.loaded, inbox.messages.length])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'thread') endRef.current?.scrollIntoView({ block: 'end' }) }, [view, selected, inbox.messages.length])

  const open = (phone) => { setSelected(phone); setView('thread'); setError(''); setPickPop(null); window.history.replaceState(null, '', `/messages?phone=${encodeURIComponent(phone)}`) }
  const back = () => { setView('list'); window.history.replaceState(null, '', '/messages') }
  const send = async () => {
    const body = draft.trim()
    if (!body || !selected || sending) return
    setSending(true); setError('')
    try { await inbox.send(selected, body); setDraft('') } catch (e) { setError(e.message) } finally { setSending(false) }
  }

  if (denied) return (
    <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center px-6 text-center">
      <div><p className="text-lg font-bold text-[#062E63]">CUBE Messages</p><p className="text-sm text-[#2A2035]/55 mt-2">This app is for the directors, not tutors. <Link href="/tutor" className="text-[#325099] font-semibold">Back to the portal →</Link></p></div>
    </div>
  )
  if (!allowed || !inbox.loaded) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const totalUnread = inbox.threads.reduce((s, t) => s + t.unread, 0)
  const missed = inbox.calls.filter((c) => c.status === 'missed' || c.status === 'voicemail').length

  // ── thread view ─────────────────────────────────────────────────────────────
  if (view === 'thread' && thread) {
    const c = inbox.who(thread.phone)
    return (
      <div className="h-[100dvh] flex flex-col bg-[#F8FAFF]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <header className="flex items-center gap-2 px-3 py-2.5 bg-white border-b border-[#DEE7FF] shrink-0">
          <button onClick={back} className="w-9 h-9 rounded-full flex items-center justify-center text-[#325099] text-xl hover:bg-[#EEF3FF]" aria-label="Back">‹</button>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-[#062E63] truncate">{c?.label || formatPhone(thread.phone)}</p>
            <p className="text-[11px] text-[#2A2035]/45 truncate">{c?.sub ? `${c.sub} · ` : ''}{formatPhone(thread.phone)}</p>
          </div>
          <a href={`tel:${thread.phone}`} className="w-9 h-9 rounded-full flex items-center justify-center text-[#325099] hover:bg-[#EEF3FF]" title="Call from this phone (shows your own number)">📞</a>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
          {thread.list.length === 0 && <p className="text-xs text-[#2A2035]/40 text-center py-8">No messages yet with this number.</p>}
          {thread.list.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap ${m.direction === 'out' ? 'bg-[#325099] text-white rounded-br-md' : 'bg-white border border-[#E5ECFF] text-[#2A2035] rounded-bl-md'}`}>
                {m.body}
                <div className={`text-[10px] mt-1 ${m.direction === 'out' ? 'text-white/65' : 'text-[#2A2035]/40'}`}>
                  {fmtTime(m.created_at)}{m.direction === 'out' && m.sent_by ? ` · ${m.sent_by.split(' ')[0]}` : ''}
                  {m.direction === 'out' && (m.status === 'failed' || m.status === 'undelivered') ? ' · not delivered' : ''}
                </div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="shrink-0 bg-white border-t border-[#DEE7FF] px-3 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
          {error && <p className="text-xs text-[#DC2626] mb-1.5">{error}</p>}
          <div className="flex gap-2 items-end">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder="Text message" enterKeyHint="send"
              onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px' }}
              className="flex-1 border border-[#DEE7FF] rounded-2xl px-3.5 py-2 text-[15px] focus:outline-none focus:border-[#325099] resize-none bg-[#F8FAFF]" />
            <button onClick={send} disabled={sending || !draft.trim()} className="w-10 h-10 rounded-full bg-[#325099] text-white text-lg flex items-center justify-center hover:bg-[#062E63] disabled:opacity-40" aria-label="Send">➤</button>
          </div>
        </div>
      </div>
    )
  }

  // ── list view ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-[#F8FAFF]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="sticky top-0 z-10 bg-white border-b border-[#DEE7FF] px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-[#062E63]">Messages</h1>
            <p className="text-[11px] text-[#2A2035]/45">{profile?.full_name} · office number</p>
          </div>
          <div className="flex items-center gap-2">
            <PushEnable />
            <button onClick={(e) => setPickPop(e.currentTarget.getBoundingClientRect())} className="w-9 h-9 rounded-full bg-[#325099] text-white text-xl leading-none flex items-center justify-center" aria-label="New text">+</button>
          </div>
        </div>
        <div className="flex gap-1 mt-2">
          <button onClick={() => setTab('texts')} className={`px-3 py-1 rounded-full text-xs font-semibold ${tab === 'texts' ? 'bg-[#062E63] text-white' : 'bg-[#EEF3FF] text-[#062E63]'}`}>Texts{totalUnread ? ` · ${totalUnread}` : ''}</button>
          <button onClick={() => setTab('calls')} className={`px-3 py-1 rounded-full text-xs font-semibold ${tab === 'calls' ? 'bg-[#062E63] text-white' : 'bg-[#EEF3FF] text-[#062E63]'}`}>Calls{missed ? ` · ${missed} missed` : ''}</button>
        </div>
      </header>

      {tab === 'texts' ? (
        inbox.threads.length === 0 ? (
          <p className="text-sm text-[#2A2035]/45 px-6 py-16 text-center">No texts yet. Tap + to text a family.</p>
        ) : (
          <ul className="divide-y divide-[#EEF1F6] bg-white">
            {inbox.threads.map((t) => {
              const c = inbox.who(t.phone)
              return (
                <li key={t.phone}>
                  <button onClick={() => open(t.phone)} className="w-full text-left px-4 py-3 flex items-start gap-3 active:bg-[#EEF3FF]">
                    <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${t.unread ? 'bg-[#325099]' : 'bg-transparent'}`} />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className={`flex-1 min-w-0 truncate text-[15px] ${t.unread ? 'font-bold text-[#062E63]' : 'font-semibold text-[#2A2035]'}`}>{c?.label || formatPhone(t.phone)}</span>
                        <span className="text-[11px] text-[#2A2035]/40 shrink-0">{t.last ? fmtTime(t.last.created_at) : ''}</span>
                      </span>
                      {c?.sub && <span className="block text-[11px] text-[#2A2035]/45 truncate">{c.sub}</span>}
                      <span className={`block text-[13px] truncate mt-0.5 ${t.unread ? 'text-[#2A2035]' : 'text-[#2A2035]/55'}`}>{t.last?.direction === 'out' ? 'You: ' : ''}{t.last?.body}</span>
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
              const style = { answered: 'text-[#166534]', missed: 'text-[#991B1B]', voicemail: 'text-[#92400E]', ringing: 'text-[#4338CA]' }[c.status] || ''
              return (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="flex-1 min-w-0 truncate text-[15px] font-semibold text-[#2A2035]">{who?.label || formatPhone(c.phone)}</span>
                    <span className="text-[11px] text-[#2A2035]/40 shrink-0">{fmtTime(c.created_at)}</span>
                  </div>
                  <p className={`text-[12px] font-semibold ${style}`}>{c.status === 'answered' ? `Answered${c.duration_s != null ? ` · ${Math.floor(c.duration_s / 60)}:${String(c.duration_s % 60).padStart(2, '0')}` : ''}` : c.status === 'voicemail' ? 'Voicemail' : c.status === 'missed' ? 'Missed' : 'Ringing…'}</p>
                  {c.transcript && <p className="mt-1 text-[13px] text-[#2A2035]/75 italic">“{c.transcript}”</p>}
                  <div className="flex gap-3 mt-1.5">
                    <button onClick={() => { setTab('texts'); open(c.phone) }} className="text-[12px] font-semibold text-[#325099]">Text back</button>
                    <a href={`tel:${c.phone}`} className="text-[12px] font-semibold text-[#325099]">Call back</a>
                    {c.recording_sid && <Link href={`/tutor/admin/messages?tab=calls`} className="text-[12px] font-semibold text-[#325099]">Play in portal</Link>}
                  </div>
                </li>
              )
            })}
          </ul>
        )
      )}

      {pickPop && (
        <SearchSelectPopover anchor={{ ...pickPop, left: 12, bottom: pickPop.bottom }} options={inbox.people} currentValue={null} placeholder="Student or parent name…" maxHeight={520}
          onSelect={(v) => { if (String(v).startsWith('none:')) return; open(v) }} onClose={() => setPickPop(null)} />
      )}
    </div>
  )
}

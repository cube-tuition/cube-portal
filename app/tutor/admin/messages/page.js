'use client'
import { useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getAuthProfile } from '../../../../lib/getProfile'
import { authedFetch } from '../../../../lib/authedFetch'
import { useSmsInbox, fmtTime } from '../../../../lib/useSmsInbox'
import { normalisePhone, formatPhone } from '../../../../lib/phone'
import { recordPortalActivity, recordPageView } from '../../../../lib/activity'
import SearchSelectPopover from '../../../../components/SearchSelectPopover'
import PushEnable from '../../../../components/PushEnable'

/*
 * Messages — /tutor/admin/messages (admin + director)
 *
 * Every text to and from the office number, grouped into a thread per phone
 * number, plus the Calls tab. Names come from students.phone and
 * guardians.phone. Opening a thread marks its incoming texts read; the
 * "Unanswered" filter lists threads whose last message came from the family.
 * Live: new texts appear without a refresh. The data and logic live in
 * lib/useSmsInbox, shared with the standalone phone app at /messages.
 *
 * No portal nav: the ✉ button in the nav opens this in its own tab, and it is
 * meant to sit there like a mail client while you work elsewhere. It carries
 * its own way back for anyone who arrives from an alert email instead, and
 * records its own activity/page view, which the nav used to do for it.
 */

export default function MessagesPage() {
  return <Suspense><MessagesInner /></Suspense>
}

function MessagesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState(null)
  const [allowed, setAllowed] = useState(false)
  const [selected, setSelected] = useState(() => normalisePhone(searchParams.get('phone') || '') || null)
  const [tab, setTab] = useState(() => (searchParams.get('tab') === 'calls' ? 'calls' : 'texts'))
  const [filter, setFilter] = useState('all')       // all | unanswered
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [newPop, setNewPop] = useState(null)
  const [newNumber, setNewNumber] = useState('')
  const endRef = useRef(null)
  const inbox = useSmsInbox({ enabled: allowed })

  // The portal nav normally does this for every page; this one has no nav.
  useEffect(() => { recordPortalActivity() }, [])
  useEffect(() => { recordPageView('/tutor/admin/messages') }, [])

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile); setAllowed(true)
    })()
  }, [router])

  const threads = selected && !inbox.threads.some((t) => t.phone === selected)
    ? [{ phone: selected, list: [], last: null, unread: 0, unanswered: false }, ...inbox.threads]
    : inbox.threads
  const shown = filter === 'unanswered' ? threads.filter((t) => t.unanswered) : threads
  const thread = threads.find((t) => t.phone === selected)

  useEffect(() => { if (selected && inbox.loaded) inbox.markRead(selected) }, [selected, inbox.loaded, inbox.messages.length])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [selected, inbox.messages.length])

  const send = async () => {
    const body = draft.trim()
    if (!body || !selected || sending) return
    setSending(true); setError('')
    try { await inbox.send(selected, body); setDraft('') } catch (e) { setError(e.message) } finally { setSending(false) }
  }
  const startNew = (phone) => { if (String(phone).startsWith('none:')) return; const e = normalisePhone(phone); if (!e) return; setSelected(e); setNewPop(null); setNewNumber(''); setFilter('all'); setTab('texts') }

  if (!allowed || !inbox.loaded) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  const totalUnread = threads.reduce((s, t) => s + t.unread, 0)
  const who = inbox.who
  const missedCount = inbox.calls.filter((c) => c.status === 'missed' || c.status === 'voicemail').length

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-12">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <Link href="/tutor" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#325099]/70 hover:text-[#062E63] mb-1.5">
              <span aria-hidden="true">←</span>CUBE portal
            </Link>
            <h1 className="text-2xl font-bold text-[#062E63]">Messages</h1>
            <p className="text-sm text-[#325099]/60 mt-1">Texts and calls on the office number.{totalUnread ? ` ${totalUnread} unread text${totalUnread === 1 ? '' : 's'}.` : ''} <Link href="/messages" className="text-[#325099] hover:underline">Open the phone app →</Link></p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <PushEnable />
            <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden text-xs">
              <button onClick={() => setTab('texts')} className={`px-3 py-1.5 font-semibold ${tab === 'texts' ? 'bg-[#062E63] text-white' : 'text-[#062E63]'}`}>Texts</button>
              <button onClick={() => setTab('calls')} className={`px-3 py-1.5 font-semibold border-l border-[#DEE7FF] ${tab === 'calls' ? 'bg-[#062E63] text-white' : 'text-[#062E63]'}`}>Calls{missedCount ? ` (${missedCount} missed)` : ''}</button>
            </div>
            {tab === 'texts' && <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden text-xs">
              <button onClick={() => setFilter('all')} className={`px-3 py-1.5 font-semibold ${filter === 'all' ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>All</button>
              <button onClick={() => setFilter('unanswered')} className={`px-3 py-1.5 font-semibold border-l border-[#DEE7FF] ${filter === 'unanswered' ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>
                Unanswered{threads.filter((t) => t.unanswered).length ? ` (${threads.filter((t) => t.unanswered).length})` : ''}
              </button>
            </div>}
            <button onClick={(e) => setNewPop(e.currentTarget.getBoundingClientRect())}
              className="px-3.5 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition">+ New text</button>
          </div>
        </div>

        {tab === 'calls' && (
          <CallsPanel calls={inbox.calls} who={who} onText={(phone) => { setSelected(phone); setTab('texts') }} />
        )}
        {tab === 'texts' && <div className="grid md:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
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
        </div>}
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
            <PeoplePicker people={inbox.people} onPick={startNew} />
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
      {pop && <SearchSelectPopover anchor={pop} options={people} currentValue={null} placeholder="Student or parent name…" maxHeight={560} onSelect={(v) => { setPop(null); onPick(v) }} onClose={() => setPop(null)} />}
    </>
  )
}

const fmtDur = (secs) => `${Math.floor((secs || 0) / 60)}:${String((secs || 0) % 60).padStart(2, '0')}`
const CALL_STYLE = {
  answered:  { label: 'Answered',  bg: '#DCFCE7', fg: '#166534' },
  missed:    { label: 'Missed',    bg: '#FEE2E2', fg: '#991B1B' },
  voicemail: { label: 'Voicemail', bg: '#FEF3C7', fg: '#92400E' },
  ringing:   { label: 'Ringing…',  bg: '#EEF2FF', fg: '#4338CA' },
}

function CallsPanel({ calls, who, onText }) {
  if (!calls.length) return (
    <div className="bg-white rounded-2xl border border-[#F0F4FF] px-6 py-14 text-center text-sm text-[#2A2035]/45">
      No calls yet. Calls to the office number are forwarded to the office mobile and logged here, with voicemails when nobody answers.
    </div>
  )
  return (
    <div className="bg-white rounded-2xl border border-[#F0F4FF] divide-y divide-[#F0F4FF]">
      {calls.map((c) => {
        const st = CALL_STYLE[c.status] || CALL_STYLE.ringing
        const contact = who(c.phone)
        return (
          <div key={c.id} className="px-5 py-3.5">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#062E63] truncate">{contact?.label || formatPhone(c.phone)}</p>
                <p className="text-[11px] text-[#2A2035]/45 truncate">{contact?.sub ? `${contact.sub} · ` : ''}{formatPhone(c.phone)}</p>
              </div>
              <span className="text-[11px] text-[#2A2035]/45">
                {fmtTime(c.created_at)}
                {c.status === 'answered' && c.duration_s != null ? ` · ${fmtDur(c.duration_s)} talk` : ''}
                {c.status === 'voicemail' && c.recording_s != null ? ` · ${fmtDur(c.recording_s)} message` : ''}
              </span>
              {c.recording_sid && <VoicemailPlayer sid={c.recording_sid} />}
              <button onClick={() => onText(c.phone)} className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-2.5 py-1 hover:border-[#325099]">Text back</button>
            </div>
            {c.transcript && <p className="mt-2 text-sm text-[#2A2035]/80 bg-[#F8FAFF] rounded-xl px-3.5 py-2 italic">“{c.transcript}”</p>}
            {c.status === 'voicemail' && !c.transcript && <p className="mt-1.5 text-[11px] text-[#2A2035]/40">Transcript on its way — usually a minute or two.</p>}
          </div>
        )
      })}
    </div>
  )
}

// Twilio recordings need the account's credentials, so the audio comes through
// /api/voice/audio with the staff token — an <audio src> can't carry that header.
function VoicemailPlayer({ sid }) {
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = async () => {
    setBusy(true); setErr('')
    try {
      const res = await authedFetch(`/api/voice/audio?sid=${encodeURIComponent(sid)}`)
      if (!res.ok) throw new Error(`could not load (${res.status})`)
      setUrl(URL.createObjectURL(await res.blob()))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  if (url) return <audio controls autoPlay src={url} className="h-8" />
  return (
    <button onClick={load} disabled={busy} className="text-[11px] font-semibold text-white bg-[#325099] rounded-lg px-2.5 py-1 hover:bg-[#062E63] disabled:opacity-50">
      {busy ? 'Loading…' : err ? `▶ ${err}` : '▶ Play'}
    </button>
  )
}

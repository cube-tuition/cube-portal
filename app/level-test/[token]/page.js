'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import CubeLogo from '../../../components/CubeLogo'
import { fmtSlotDate, normaliseSlots, sameSlot, slotTime } from '../../../lib/levelTestInvite'

/*
 * /level-test/<token> — the parent's level test form, linked from the level
 * test invitation email. No login: the token is the key, checked by
 * /api/level-test-invite. Picking a time books the level test (it appears on
 * Monitoring → Level tests); "None of these suit" sends the times that do.
 * After booking, the same link shows the booking and lets them change it.
 *
 * /level-test/preview?d=… is what a staff test email links to: the same form
 * with the email's times, where nothing is saved.
 */

const decodePreview = (d) => {
  try {
    const b64 = String(d || '').replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(decodeURIComponent(escape(atob(b64))))
    return { firstName: '', slots: normaliseSlots(json?.s), booked: null, locked: false, note: '', responded: false }
  } catch { return null }
}

export default function LevelTestFormPage() {
  return <Suspense fallback={null}><LevelTestForm /></Suspense>
}

function LevelTestForm() {
  const { token } = useParams()
  const search = useSearchParams()
  const preview = token === 'preview'
  const [info, setInfo] = useState(() => (preview ? decodePreview(search.get('d')) : null))
  const [error, setError] = useState(() => (preview && !decodePreview(search.get('d')) ? 'This preview link is incomplete.' : null))
  const [pick, setPick] = useState(null)        // a slot, or 'none'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState(null)
  const [done, setDone] = useState(null)        // { action, booked } after submitting
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    if (preview) return undefined
    let alive = true
    fetch(`/api/level-test-invite/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) setError(j.error || 'This link could not be opened.')
        else { setInfo(j); setNote(j.note || '') }
      })
      .catch(() => { if (alive) setError('This link could not be opened.') })
    return () => { alive = false }
  }, [token, preview])

  // Their booked time, if it's still one of the offered times, starts selected.
  const slots = useMemo(() => info?.slots || [], [info])

  const submit = async () => {
    if (!pick || busy) return
    setFormErr(null)
    if (pick === 'none' && !note.trim()) { setFormErr('Please tell us which days and times would suit.'); return }
    if (preview) {
      const b = pick === 'none' ? null : pick
      setDone({ action: pick === 'none' ? 'note' : 'book', booked: b, preview: true })
      setInfo(i => ({ ...i, booked: b }))
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/level-test-invite/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pick === 'none' ? { none: true, note } : { slot: { date: pick.date, start: pick.start } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Something went wrong — please try again.')
      setDone(j)
      setInfo(i => ({ ...i, booked: j.booked, responded: true, note: pick === 'none' ? note : '' }))
      setChanging(false)
    } catch (e) {
      setFormErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const shell = (children) => (
    <div className="min-h-screen bg-[#F4F7FF] px-4 py-8 md:py-14 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <CubeLogo className="h-9 w-auto" />
          <span className="text-sm font-bold tracking-[0.3em] uppercase text-[#062E63]">CUBE Tuition</span>
        </div>
        {preview && (
          <div className="mb-4 bg-[#FEF3C7] border border-[#F59E0B] rounded-xl px-4 py-2.5 text-xs font-bold text-[#92400E] text-center">
            Preview — this is what the family sees. Nothing is booked from here.
          </div>
        )}
        {children}
      </div>
    </div>
  )

  if (error) return shell(
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 text-center">
      <p className="text-base font-bold text-[#062E63] mb-1">Link not found</p>
      <p className="text-sm text-[#2A2035]/60">{error}</p>
    </div>
  )
  if (!info) return shell(<p className="text-sm text-[#2A2035]/40 animate-pulse text-center py-10">Loading…</p>)

  const who = info.firstName || 'your child'
  const Who = info.firstName || 'Your child'
  const booked = info.booked

  const card = (s, big = false) => (
    <>
      <p className={`${big ? 'text-base' : 'text-sm'} font-bold text-[#062E63]`}>{fmtSlotDate(s.date)}</p>
      <p className="text-xs text-[#2A2035]/65 mt-0.5">{slotTime(s)}{s.room ? ` · ${s.room}` : ''}</p>
    </>
  )

  // Booked (now or before) and not changing it: show the booking.
  if (booked && !changing) return shell(
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#10B981] mb-2">✓ {done?.action === 'move' ? 'Time changed' : 'Booked'}</p>
        <h1 className="text-xl font-bold text-[#062E63] mb-3">{Who}&rsquo;s level test</h1>
        <div className="bg-[#F0F4FF] border border-[#DEE7FF] rounded-xl px-4 py-3">{card(booked, true)}</div>
        <p className="text-sm text-[#2A2035]/70 mt-4 leading-relaxed">
          {done?.preview ? 'In the real form, the family now gets a confirmation email.' : 'We’ve emailed you a confirmation.'}{' '}It&rsquo;s free of charge and takes about 45–60 minutes. Afterwards we&rsquo;ll send you a feedback report and recommend the right class.
        </p>
        {!info.locked && !done?.preview && (
          <button onClick={() => { setChanging(true); setPick(null); setDone(null) }}
            className="mt-4 text-xs font-semibold text-[#325099] hover:underline">Need a different time?</button>
        )}
      </div>
      <p className="text-[11px] text-center text-[#2A2035]/40">Questions? Just reply to our email.</p>
    </div>
  )

  if (done && !done.booked) return shell(
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#325099]/70 mb-2">Thank you</p>
      <h1 className="text-xl font-bold text-[#062E63] mb-2">We&rsquo;ll be in touch</h1>
      <p className="text-sm text-[#2A2035]/70 leading-relaxed">We&rsquo;ve passed on the times that suit you and will get back to you shortly with a time for {who}&rsquo;s level test.</p>
    </div>
  )

  return shell(
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
        <h1 className="text-xl md:text-2xl font-bold text-[#062E63]">{changing ? 'Choose a new time' : `Book ${info.firstName ? `${info.firstName}’s` : 'your'} level test`}</h1>
        <p className="text-sm text-[#2A2035]/70 mt-1.5 leading-relaxed">
          Free of charge, about 45–60 minutes. Afterwards we&rsquo;ll send you a feedback report and recommend the right class.
        </p>
        {info.responded && !booked && info.note && !changing && (
          <p className="text-xs text-[#325099] mt-3 bg-[#F0F4FF] rounded-lg px-3 py-2">You told us: &ldquo;{info.note}&rdquo; — you can still pick one of the times below.</p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#325099]/70 mb-3">Which time suits?</p>
        <div className="space-y-2">
          {slots.length === 0 && <p className="text-sm text-[#2A2035]/55">The suggested times have passed — tell us below what suits and we&rsquo;ll find a time.</p>}
          {slots.map(s => {
            const on = pick && pick !== 'none' && sameSlot(pick, s)
            const current = booked && sameSlot(booked, s)
            return (
              <button key={`${s.date} ${s.start}`} type="button" onClick={() => setPick(s)}
                className={`w-full text-left flex items-center gap-3 border rounded-xl px-4 py-3 transition ${on ? 'border-[#325099] bg-[#F0F4FF]' : 'border-[#DEE7FF] bg-white hover:border-[#325099]/50'}`}>
                <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${on ? 'border-[#325099] bg-[#325099] shadow-[inset_0_0_0_2px_white]' : 'border-[#C7D4F5]'}`} />
                <span className="flex-1 min-w-0">{card(s)}</span>
                {current && <span className="text-[10px] font-semibold text-[#10B981] shrink-0">current booking</span>}
              </button>
            )
          })}
          <button type="button" onClick={() => setPick('none')}
            className={`w-full text-left flex items-center gap-3 border rounded-xl px-4 py-3 transition ${pick === 'none' ? 'border-[#325099] bg-[#F0F4FF]' : 'border-[#DEE7FF] bg-white hover:border-[#325099]/50'}`}>
            <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${pick === 'none' ? 'border-[#325099] bg-[#325099] shadow-[inset_0_0_0_2px_white]' : 'border-[#C7D4F5]'}`} />
            <span className="text-sm font-semibold text-[#062E63]">None of these suit</span>
          </button>
          {pick === 'none' && (
            <div>
              <label className="block text-xs font-semibold text-[#2A2035]/70 mb-1 mt-1">Which days and times would work?</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000}
                placeholder="e.g. Weekdays after 4pm, or Saturday mornings"
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] resize-y" />
              {booked && <p className="text-[11px] text-[#B45309] mt-1">This cancels the current booking — we&rsquo;ll be in touch with a new time.</p>}
            </div>
          )}
        </div>

        {formErr && <p className="text-xs font-semibold text-[#B91C1C] mt-3">{formErr}</p>}
        <div className="mt-4 flex items-center gap-3">
          <button onClick={submit} disabled={!pick || busy}
            className="px-5 py-2.5 rounded-xl bg-[#062E63] text-white text-sm font-bold hover:bg-[#325099] transition disabled:opacity-40">
            {busy ? 'Saving…' : pick === 'none' ? 'Send' : changing ? 'Change time' : 'Book this time'}
          </button>
          {changing && <button onClick={() => { setChanging(false); setPick(null); setFormErr(null) }} className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035]">Keep current time</button>}
        </div>
      </div>
      <p className="text-[11px] text-center text-[#2A2035]/40">Questions? Just reply to our email.</p>
    </div>
  )
}

'use client'
import { Suspense, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import CubeLogo from '../../../components/CubeLogo'
import { normaliseSections, optionTitle, optionDetail } from '../../../lib/trialInvite'

/*
 * /trial/<token> — the family's trial class form, linked from the trial
 * invitation email (and the level test results email). No login: the token is
 * the key, checked by /api/trial-invite. Picking a class books the trial
 * straight away; an "other" option (a 1:1, …) is passed to CUBE to set up. "None of these suit"
 * sends the times that do. Afterwards the same link shows the booking and
 * lets them change it until the trial starts.
 *
 * /trial/preview?d=… is what a staff test email links to: the same form with
 * the email's classes, where nothing is saved.
 */

const decodePreview = (d) => {
  try {
    const b64 = String(d || '').replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(decodeURIComponent(escape(atob(b64))))
    return { firstName: '', sections: normaliseSections(json?.s).map(s => ({ ...s, picked: null, locked: false })), note: '', responded: false }
  } catch { return null }
}

export default function TrialFormPage() {
  return <Suspense fallback={null}><TrialForm /></Suspense>
}

function TrialForm() {
  const { token } = useParams()
  const search = useSearchParams()
  const preview = token === 'preview'
  const [info, setInfo] = useState(() => (preview ? decodePreview(search.get('d')) : null))
  const [error, setError] = useState(() => (preview && !decodePreview(search.get('d')) ? 'This preview link is incomplete.' : null))
  const [picks, setPicks] = useState({})          // submission id → option id
  const [none, setNone] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState(null)
  const [done, setDone] = useState(null)          // 'book' | 'move' | 'note'
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    if (preview) return undefined
    let alive = true
    fetch(`/api/trial-invite/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) setError(j.error || 'This link could not be opened.')
        else { setInfo(j); setNote(j.note || '') }
      })
      .catch(() => { if (alive) setError('This link could not be opened.') })
    return () => { alive = false }
  }, [token, preview])

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

  const sections = info.sections || []
  const multi = sections.length > 1
  const Who = info.firstName || 'Your child'
  const allPicked = sections.length > 0 && sections.every(s => s.picked)
  const open = sections.filter(s => !s.locked)

  const submit = async () => {
    if (busy) return
    setFormErr(null)
    if (none) {
      if (!note.trim()) { setFormErr('Please tell us which days and times would suit.'); return }
    } else if (!open.some(s => picks[s.submission_id])) { setFormErr('Please choose a class.'); return }
    if (preview) {
      setDone(none ? 'note' : 'book')
      setInfo(i => ({ ...i, sections: i.sections.map(s => ({ ...s, picked: s.options.find(o => o.id === picks[s.submission_id]) || s.picked })) }))
      setChanging(false)
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/trial-invite/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(none ? { none: true, note } : { picks }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Something went wrong — please try again.')
      setDone(j.action)
      if (!none) setInfo(i => ({ ...i, responded: true, sections: i.sections.map(s => ({ ...s, picked: s.options.find(o => o.id === picks[s.submission_id]) || s.picked })) }))
      setChanging(false)
    } catch (e) {
      setFormErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const optionCard = (o) => (
    <>
      <p className="text-sm font-bold text-[#062E63]">{optionTitle(o)}</p>
      {optionDetail(o) && <p className="text-xs text-[#2A2035]/65 mt-0.5">{optionDetail(o)}</p>}
    </>
  )

  // Booked and not changing: show the booking.
  if (allPicked && !changing && done !== 'note') return shell(
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#10B981] mb-2">✓ {done === 'move' ? 'Trial updated' : 'Trial booked'}</p>
        <h1 className="text-xl font-bold text-[#062E63] mb-3">{Who}&rsquo;s trial</h1>
        <div className="space-y-2">
          {sections.map(s => (
            <div key={s.submission_id} className="bg-[#F0F4FF] border border-[#DEE7FF] rounded-xl px-4 py-3">
              {multi && <p className="text-[11px] font-bold text-[#325099] mb-1">{s.label}</p>}
              {optionCard(s.picked)}
            </div>
          ))}
        </div>
        <p className="text-sm text-[#2A2035]/70 mt-4 leading-relaxed">
          {preview ? 'In the real form, the family now gets a confirmation email.' : 'We’ve emailed you a confirmation.'}{' '}
          The trial is two lessons, and you&rsquo;ll get a reminder the day before each one.
        </p>
        {open.length > 0 && !preview && (
          <button onClick={() => { setChanging(true); setPicks({}); setDone(null) }}
            className="mt-4 text-xs font-semibold text-[#325099] hover:underline">Need a different time?</button>
        )}
      </div>
      <p className="text-[11px] text-center text-[#2A2035]/40">Questions? Just reply to our email.</p>
    </div>
  )

  if (done === 'note') return shell(
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#325099]/70 mb-2">Thank you</p>
      <h1 className="text-xl font-bold text-[#062E63] mb-2">We&rsquo;ll be in touch</h1>
      <p className="text-sm text-[#2A2035]/70 leading-relaxed">We&rsquo;ve passed on the times that suit you and will get back to you shortly with a trial class for {info.firstName || 'your child'}.</p>
    </div>
  )

  return shell(
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
        <h1 className="text-xl md:text-2xl font-bold text-[#062E63]">{changing ? 'Choose a new time' : `Choose ${info.firstName ? `${info.firstName}’s` : 'your'} trial class`}</h1>
        <p className="text-sm text-[#2A2035]/70 mt-1.5 leading-relaxed">
          A trial is two lessons in one of our regular classes. Pick the time that suits — it&rsquo;s booked straight away and you&rsquo;ll get a confirmation email.
        </p>
        {info.responded && info.note && !allPicked && (
          <p className="text-xs text-[#325099] mt-3 bg-[#F0F4FF] rounded-lg px-3 py-2">You told us: &ldquo;{info.note}&rdquo; — you can still pick one of the classes below.</p>
        )}
      </div>

      {sections.map(s => (
        <div key={s.submission_id} className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
          <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#325099]/70 mb-3">{multi ? s.label : 'Which class suits?'}</p>
          {s.locked ? (
            <div className="bg-[#F0F4FF] border border-[#DEE7FF] rounded-xl px-4 py-3">
              {s.picked ? optionCard(s.picked) : <p className="text-sm text-[#2A2035]/60">This trial is already arranged.</p>}
              <p className="text-[11px] text-[#2A2035]/50 mt-1">This trial has started — reply to our email to change it.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {s.options.length === 0 && <p className="text-sm text-[#2A2035]/55">These times have passed — tell us below what suits and we&rsquo;ll find a class.</p>}
              {s.options.map(o => {
                const on = !none && picks[s.submission_id] === o.id
                return (
                  <button key={o.id} type="button" onClick={() => { setNone(false); setPicks(p => ({ ...p, [s.submission_id]: o.id })) }}
                    className={`w-full text-left flex items-center gap-3 border rounded-xl px-4 py-3 transition ${on ? 'border-[#325099] bg-[#F0F4FF]' : 'border-[#DEE7FF] bg-white hover:border-[#325099]/50'}`}>
                    <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${on ? 'border-[#325099] bg-[#325099] shadow-[inset_0_0_0_2px_white]' : 'border-[#C7D4F5]'}`} />
                    <span className="flex-1 min-w-0">{optionCard(o)}</span>
                    {s.picked?.id === o.id && <span className="text-[10px] font-semibold text-[#10B981] shrink-0">current booking</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}

      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
        <button type="button" onClick={() => { setNone(n => !n); setPicks({}) }}
          className={`w-full text-left flex items-center gap-3 border rounded-xl px-4 py-3 transition ${none ? 'border-[#325099] bg-[#F0F4FF]' : 'border-[#DEE7FF] bg-white hover:border-[#325099]/50'}`}>
          <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${none ? 'border-[#325099] bg-[#325099] shadow-[inset_0_0_0_2px_white]' : 'border-[#C7D4F5]'}`} />
          <span className="text-sm font-semibold text-[#062E63]">None of these suit</span>
        </button>
        {none && (
          <div>
            <label className="block text-xs font-semibold text-[#2A2035]/70 mb-1 mt-3">Which days and times would work?</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000}
              placeholder="e.g. Weekdays after 4pm, or Saturday mornings"
              className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] resize-y" />
          </div>
        )}
        {formErr && <p className="text-xs font-semibold text-[#B91C1C] mt-3">{formErr}</p>}
        <div className="mt-4 flex items-center gap-3">
          <button onClick={submit} disabled={busy}
            className="px-5 py-2.5 rounded-xl bg-[#062E63] text-white text-sm font-bold hover:bg-[#325099] transition disabled:opacity-40">
            {busy ? 'Saving…' : none ? 'Send' : changing ? 'Change trial' : 'Book trial'}
          </button>
          {changing && <button onClick={() => { setChanging(false); setPicks({}); setFormErr(null) }} className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035]">Keep current booking</button>}
        </div>
      </div>
      <p className="text-[11px] text-center text-[#2A2035]/40">Questions? Just reply to our email.</p>
    </div>
  )
}

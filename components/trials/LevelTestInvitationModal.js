'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { TEST_RECIPIENT } from '../../lib/emailConfig'
import EmailWording from './EmailWording'
import { subjectCode } from '../../lib/format'
import { fillTrialVars, firstWeekdayOnOrAfter } from '../../lib/trialInvitationEmail'
import {
  buildLevelTestInvitationEmailHtml, mergeLevelTestInvitationContent, matchLevelTests,
  normaliseSlots, testEnd, availabilitySlots, slotLabel,
} from '../../lib/levelTestInvite'

/*
 * Level test invitation — the alternative first email to a trial enquiry:
 * invite the student in to sit a level test before a class is chosen.
 *
 * Staff add a few suggested times; the email lists them and links to the
 * family's form (/level-test/<token>), where picking one books the level test
 * straight onto Monitoring → Level tests. The tests to sit default to the
 * exam-bank level tests for the student's year and subjects. The preview is
 * exactly what sends; a test email links to a preview of the form.
 */

const FIELDS = [
  { key: 'subject',      label: 'Subject line', rows: 1 },
  { key: 'greeting',     label: 'Greeting',     rows: 1 },
  { key: 'intro',        label: 'Welcome / thank you', rows: 4 },
  { key: 'details',      label: 'Details (one point per line)', rows: 3 },
  { key: 'timesHeading', label: 'Times heading', rows: 1 },
  { key: 'timesBody',    label: 'Times lead-in', rows: 2 },
  { key: 'buttonLabel',  label: 'Button', rows: 1 },
  { key: 'flexNote',     label: 'None-suit line', rows: 2 },
  { key: 'signoff',      label: 'Sign-off',     rows: 2 },
]

const isoDay = (offset = 0) => {
  const d = new Date(), pad = (n) => String(n).padStart(2, '0')
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const isoToday = () => isoDay(0)
const levelTestName = (t) => {
  const code = subjectCode(t.subject)
  return (t.year && code) ? `${t.year}.${code}. Level Test` : (t.title || 'Level test')
}
const emptySlot = () => ({ date: '', start: '', end: '', room: '' })

export default function LevelTestInvitationModal({ sub, onClose, onSent }) {
  const [tests, setTests]       = useState([])
  const [buildIds, setBuildIds] = useState([])
  const [invite, setInvite]     = useState(null)      // the saved invite, if one was sent before
  const [booking, setBooking]   = useState(null)      // its booked lesson
  const [slots, setSlots]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [edits, setEdits]       = useState({})
  const [sending, setSending]   = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)

  const parentName  = sub.parent_name || ''
  const parentEmail = sub.parent_email || ''
  const studentName = sub.student_name || ''
  const subjects    = Array.isArray(sub.subjects) ? sub.subjects : (sub.subjects ? [sub.subjects] : [])
  const year        = String(sub.student_year || '').replace(/\D/g, '')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [{ data: lts }, { data: inv }] = await Promise.all([
        supabase.from('booklet_builds').select('id, title, year, subject, updated_at').eq('doc_type', 'level_test').order('year').order('subject'),
        supabase.from('level_test_invites').select('*').eq('submission_id', sub.id).maybeSingle(),
      ])
      let lesson = null
      if (inv?.lesson_id) {
        const { data } = await supabase.from('lessons').select('id, lesson_date, start_time, end_time, room').eq('id', inv.lesson_id).maybeSingle()
        lesson = data
      }
      if (!alive) return
      setTests(lts || [])
      setInvite(inv || null)
      setBooking(lesson)
      setBuildIds(inv?.build_ids?.length ? inv.build_ids : matchLevelTests(lts || [], sub.student_year, subjects))
      // A resend starts from the times sent last; a first send from every
      // window of the family's availability (the next such day from tomorrow),
      // else next Saturday 10am (when most level tests run) — plus a blank row.
      const saved = normaliseSlots(inv?.slots).filter(s => s.date >= isoToday())
      const fromAvailability = availabilitySlots(sub.availability, isoDay(1))
      setSlots(saved.length
        ? saved.map(s => ({ ...s, end: s.end || '', room: s.room || '' }))
        : [...(fromAvailability.length
            ? fromAvailability
            : [{ date: firstWeekdayOnOrAfter(isoToday(), 'Saturday'), start: '10:00', end: testEnd('10:00'), room: '' }]), emptySlot()])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [sub.id])   // eslint-disable-line react-hooks/exhaustive-deps

  const content = useMemo(() => mergeLevelTestInvitationContent(edits), [edits])
  const vars    = useMemo(() => ({ parentName, studentName }), [parentName, studentName])
  const times   = useMemo(() => normaliseSlots(slots || []), [slots])
  const html    = useMemo(() => buildLevelTestInvitationEmailHtml(vars, times, '', content), [vars, times, content])
  const availability = Object.entries(sub.availability || {}).filter(([, w]) => Array.isArray(w) && w.length)

  const setSlot = (i, k, v) => setSlots(list => list.map((s, j) => {
    if (j !== i) return s
    const next = { ...s, [k]: v }
    // A new start time moves a default-length end with it.
    if (k === 'start' && (!s.end || s.end === testEnd(s.start))) next.end = testEnd(v)
    return next
  }))
  const toggleTest = (id) => setBuildIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))
  const yearTests = tests.filter(t => String(t.year) === year)
  const otherTests = tests.filter(t => String(t.year) !== year && buildIds.includes(t.id))

  const send = useCallback(async (test) => {
    setSending(true); setError(null); setResult(null)
    try {
      const res = await authedFetch('/api/send-level-test-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: sub.id, parentEmail, parentName, studentName, slots: times, buildIds, content, test }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Send failed (${res.status})`)
      setResult(test ? `Test sent to ${TEST_RECIPIENT} — its button opens a preview of the form` : `Sent to ${parentEmail}`)
      if (!test) onSent?.(json.sentAt, json.stamped)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }, [sub.id, parentEmail, parentName, studentName, times, buildIds, content, onSent])

  const FIELD = 'border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]'
  const bookedLabel = booking ? slotLabel({ date: booking.lesson_date, start: String(booking.start_time || '').slice(0, 5), end: booking.end_time ? String(booking.end_time).slice(0, 5) : null }) : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">

        <div className="flex items-start justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Level test invitation</p>
            <h2 className="text-sm font-bold text-[#062E63]">
              {studentName || 'Student'}
              <span className="font-normal text-[#2A2035]/50"> · Year {year || '?'} {subjects.join(' + ')}</span>
              {parentEmail
                ? <span className="font-normal text-[#2A2035]/50"> · to {parentName ? `${parentName}, ` : ''}{parentEmail}</span>
                : <span className="font-normal text-rose-500"> · no parent email on this trial</span>}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg shrink-0">×</button>
        </div>

        <div className="flex-1 overflow-y-auto grid md:grid-cols-2 gap-0 divide-x divide-[#F0F4FF] bg-[#F8FAFF]">
          <div className="px-6 py-5 space-y-4 bg-white">
            {loading ? <p className="text-xs text-[#2A2035]/40 py-6 text-center">Loading…</p> : (<>
              {invite && (
                <div className={`rounded-xl border px-3 py-2.5 text-[11px] ${booking ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-[#DEE7FF] bg-[#F8FAFF] text-[#2A2035]/70'}`}>
                  {booking
                    ? <><strong>Booked by the family:</strong> {bookedLabel}. Resending updates the times on their form; the booking stays unless they change it.</>
                    : invite.responded_at && invite.parent_note
                      ? <><strong>None of the times suited.</strong> They said: &ldquo;{invite.parent_note}&rdquo; — add times that fit and resend.</>
                      : <>Sent {invite.sent_at ? new Date(invite.sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''} — no time picked yet. Resending updates the times on the same form link.</>}
                </div>
              )}

              <div>
                <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Suggested times</p>
                <p className="text-[11px] text-[#2A2035]/50 mb-2">The family picks one on the form, which books it.</p>
                {availability.length > 0 && (
                  <p className="text-[11px] text-[#2A2035]/55 mb-2">
                    <span className="font-semibold text-[#325099]">Family&rsquo;s availability:</span>{' '}
                    {availability.map(([d, w]) => `${d} ${w.join(', ')}`).join(' · ')}
                  </p>
                )}
                <div className="space-y-1.5">
                  {(slots || []).map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 flex-wrap">
                      <input type="date" value={s.date} min={isoToday()} onChange={e => setSlot(i, 'date', e.target.value)} className={FIELD} />
                      <input type="time" value={s.start} step={900} onChange={e => setSlot(i, 'start', e.target.value)} className={`${FIELD} w-[6.5rem]`} />
                      <span className="text-[11px] text-[#2A2035]/40">to</span>
                      <input type="time" value={s.end} step={900} onChange={e => setSlot(i, 'end', e.target.value)} className={`${FIELD} w-[6.5rem]`} />
                      <input value={s.room} onChange={e => setSlot(i, 'room', e.target.value)} placeholder="Room" className={`${FIELD} w-20`} />
                      <button onClick={() => setSlots(list => list.filter((_, j) => j !== i))} title="Remove this time"
                        className="w-6 h-6 rounded-full text-[#2A2035]/35 hover:bg-[#F0F4FF] hover:text-rose-500 transition">×</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => setSlots(list => [...(list || []), emptySlot()])}
                  className="mt-2 text-[11px] font-semibold text-[#325099] hover:underline">+ Add a time</button>
              </div>

              <div>
                <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Level tests to sit</p>
                {yearTests.length === 0 && otherTests.length === 0 ? (
                  <p className="text-[11px] text-amber-700">No Year {year || '?'} level test in the exam bank yet — the booking is made without one; add it on Monitoring → Level tests.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {[...yearTests, ...otherTests].map(t => {
                      const on = buildIds.includes(t.id)
                      return (
                        <button key={t.id} onClick={() => toggleTest(t.id)}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${on ? 'bg-[#325099] text-white border-[#325099]' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`}>
                          {on ? '✓ ' : ''}{levelTestName(t)}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <EmailWording
                fields={FIELDS}
                values={content}
                onChange={(k, v) => setEdits(c => ({ ...c, [k]: v }))}
                onReset={() => setEdits({})}
                hint="{{parent_name}} and {{student_name}} fill in automatically."
              />
            </>)}
          </div>

          <div className="px-6 py-5 md:sticky md:top-0 md:self-start">
            <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Preview</p>
            <p className="text-[11px] text-[#2A2035]/50 mb-3">
              Subject: <span className="font-semibold text-[#2A2035]/70">{fillTrialVars(content.subject, vars)}</span>
            </p>
            <iframe title="Level test invitation preview" srcDoc={html} className="w-full h-[52vh] bg-white border border-[#DEE7FF] rounded-xl" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#F0F4FF] flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] min-w-0">
            {error  && <span className="text-rose-600 font-semibold">{error}</span>}
            {result && <span className="text-emerald-600 font-semibold">{result}</span>}
            {!error && !result && (
              <span className="text-[#2A2035]/45">
                {times.length ? `${times.length} time${times.length === 1 ? '' : 's'} offered.` : 'Add at least one time.'} Sending marks the card Contacted.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onClose} className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035] px-3 py-2">Close</button>
            <button onClick={() => send(true)} disabled={sending || loading || !parentEmail || !times.length}
              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] hover:border-[#325099] px-4 py-2 rounded-lg transition disabled:opacity-40"
              title={`Send this exact email to ${TEST_RECIPIENT} only`}>
              {sending ? 'Sending…' : 'Send test to me'}
            </button>
            <button onClick={() => send(false)} disabled={sending || loading || !parentEmail || !times.length}
              className="text-xs font-semibold bg-[#325099] text-white px-4 py-2 rounded-lg hover:bg-[#062E63] transition disabled:opacity-40"
              title={`Send to ${parentEmail}`}>
              {sending ? 'Sending…' : invite ? 'Resend invitation' : 'Send invitation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

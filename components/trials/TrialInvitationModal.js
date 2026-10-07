'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { TEST_RECIPIENT } from '../../lib/emailConfig'
import {
  DEFAULT_TRIAL_INVITATION_CONTENT, buildTrialInvitationEmailHtml, classTimeLabel,
  fillTrialVars, firstWeekdayOnOrAfter, fmtLessonDate, matchTrialClasses,
} from '../../lib/trialInvitationEmail'

/*
 * Trial invitation — the FIRST email to a trial family, composed per student
 * from the pipeline. Matches classes to the student's year + subject, ranks
 * them by the availability windows the family gave on the enquiry form, and
 * proposes the best fit with its next scheduled lesson date. Staff pick a
 * different proposal, tick which alternatives to include, and add a personal
 * note; the preview is exactly what sends.
 */

const FIELDS = [
  { key: 'subject',          label: 'Subject line', rows: 1 },
  { key: 'greeting',         label: 'Greeting',     rows: 1 },
  { key: 'intro',            label: 'Welcome / thank you', rows: 4 },
  { key: 'proposalHeading',  label: 'Proposal heading', rows: 1 },
  { key: 'proposalBody',     label: 'Proposal lead-in', rows: 3 },
  { key: 'alternativesNote', label: 'Alternatives lead-in', rows: 2 },
  { key: 'flexNote',         label: 'None-suit line', rows: 2 },
  { key: 'signoff',          label: 'Sign-off',     rows: 2 },
]

const FIT_LABEL = { 2: 'fits their availability', 1: 'right day, different time', 0: 'outside given availability' }
const FIT_STYLE = {
  2: 'bg-emerald-100 text-emerald-700',
  1: 'bg-amber-100 text-amber-700',
  0: 'bg-slate-100 text-slate-500',
}

export default function TrialInvitationModal({ sub, classes, term, onClose, onSent }) {
  const [matches, setMatches]   = useState([])      // scored classes + nextDate
  const [loading, setLoading]   = useState(true)
  const [proposalId, setProposalId] = useState(null)
  const [altIds, setAltIds]     = useState(new Set())
  const [content, setContent]   = useState(DEFAULT_TRIAL_INVITATION_CONTENT)
  const [showCopy, setShowCopy] = useState(false)
  const [sending, setSending]   = useState(false)
  const [result,  setResult]    = useState(null)
  const [error,   setError]     = useState(null)

  const parentName  = sub.parent_name || ''
  const studentName = sub.student_name || ''
  const parentEmail = sub.parent_email || ''
  const subject     = Array.isArray(sub.subjects) ? sub.subjects[0] : sub.subjects

  // Match + rank classes, then attach each one's next scheduled lesson.
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      const ranked = matchTrialClasses(
        { year: sub.student_year, subject, availability: sub.availability },
        classes || [],
      )
      const ids = ranked.map(c => c.id)
      let nextByClass = {}
      if (ids.length) {
        const today = new Date().toISOString().slice(0, 10)
        // Real scheduled lessons, not calendar arithmetic — respects term
        // boundaries. Makeups are student-specific sessions, not trial slots.
        const { data: lessons } = await supabase
          .from('lessons')
          .select('class_id, lesson_date')
          .in('class_id', ids)
          .gte('lesson_date', today)
          .or('is_makeup.is.null,is_makeup.eq.false')
          .order('lesson_date', { ascending: true })
        for (const l of lessons || []) {
          if (!(l.class_id in nextByClass)) nextByClass[l.class_id] = l.lesson_date
        }
      }
      if (!active) return
      // No generated lesson yet (next term's lessons are created closer to the
      // start) → fall back to the class's first weekday on/after term start.
      const today = new Date().toISOString().slice(0, 10)
      const from = term?.start_date && term.start_date > today ? term.start_date : today
      const withDates = ranked.map(c => ({
        ...c,
        nextDate: nextByClass[c.id] || firstWeekdayOnOrAfter(from, c.day_of_week),
      }))
      setMatches(withDates)
      setProposalId(withDates[0]?.id ?? null)
      setAltIds(new Set(withDates.slice(1, 4).map(c => c.id)))   // up to 3 alternatives by default
      setLoading(false)
    })()
    return () => { active = false }
  }, [sub.id, sub.student_year, subject, sub.availability, classes, term])

  const slotOf = useCallback((c) => c && ({
    className: c.class_name,
    day: c.day_of_week || '',
    time: classTimeLabel(c),
    date: fmtLessonDate(c.nextDate),
  }), [])

  const proposal     = useMemo(() => slotOf(matches.find(c => c.id === proposalId)), [matches, proposalId, slotOf])
  const alternatives = useMemo(
    () => matches.filter(c => c.id !== proposalId && altIds.has(c.id)).map(slotOf),
    [matches, proposalId, altIds, slotOf],
  )
  const vars = useMemo(() => ({ parentName, studentName }), [parentName, studentName])
  const html = useMemo(
    () => buildTrialInvitationEmailHtml(vars, proposal || null, alternatives, content),
    [vars, proposal, alternatives, content],
  )

  const send = useCallback(async (test) => {
    setSending(true); setError(null); setResult(null)
    try {
      const res = await authedFetch('/api/send-trial-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: sub.id, parentEmail, parentName, studentName, proposal, alternatives, content, test }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Send failed (${res.status})`)
      setResult(test ? `Test sent to ${TEST_RECIPIENT}` : `Sent to ${parentEmail}`)
      if (!test) onSent?.(json.stamped)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }, [sub.id, parentEmail, parentName, studentName, proposal, alternatives, content, onSent])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">

        <div className="flex items-start justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Trial invitation</p>
            <h2 className="text-sm font-bold text-[#062E63]">
              {studentName || 'Student'}
              <span className="font-normal text-[#2A2035]/50"> · Year {sub.student_year || '?'} {subject || ''}</span>
              {parentEmail
                ? <span className="font-normal text-[#2A2035]/50"> · to {parentName ? `${parentName}, ` : ''}{parentEmail}</span>
                : <span className="font-normal text-rose-500"> · no parent email on this trial</span>}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg shrink-0">×</button>
        </div>

        <div className="flex-1 overflow-y-auto grid md:grid-cols-2 gap-0 divide-x divide-[#F0F4FF]">
          {/* Left: class proposal + personal note + wording */}
          <div className="px-6 py-5 space-y-4">
            <div>
              <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Suggested class</p>
              <p className="text-[11px] text-[#2A2035]/50">
                Matched on year + subject, ranked by the availability the family gave. Pick the proposal; tick the times to offer as alternatives.
              </p>
            </div>

            {loading ? (
              <p className="text-xs text-[#2A2035]/40 py-6 text-center">Matching classes…</p>
            ) : matches.length === 0 ? (
              <div className="text-center py-8 px-4 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl">
                <p className="text-sm text-[#2A2035]/50">No Year {sub.student_year || '?'} {subject || ''} class found this term.</p>
                <p className="text-[11px] text-[#2A2035]/40 mt-1">The email can still go out with just the welcome and your note — or reply to the family manually.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {matches.map(c => (
                  <label key={c.id} className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition ${
                    proposalId === c.id ? 'border-[#325099] bg-[#F0F4FF]' : 'border-[#DEE7FF] bg-white hover:border-[#325099]/50'}`}>
                    <input type="radio" name="proposal" checked={proposalId === c.id}
                      onChange={() => setProposalId(c.id)} className="accent-[#325099]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#062E63] truncate">{c.class_name}</p>
                      <p className="text-[11px] text-[#2A2035]/60">
                        {c.day_of_week}s · {classTimeLabel(c)}
                        {c.nextDate ? <> · next lesson <span className="font-semibold">{fmtLessonDate(c.nextDate)}</span></> : <> · <span className="text-amber-600">no scheduled lesson found</span></>}
                      </p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${FIT_STYLE[c.fit]}`}>{FIT_LABEL[c.fit]}</span>
                    {proposalId !== c.id && (
                      <input type="checkbox" checked={altIds.has(c.id)} title="Offer as an alternative time"
                        onChange={e => setAltIds(prev => { const n = new Set(prev); e.target.checked ? n.add(c.id) : n.delete(c.id); return n })}
                        onClick={e => e.stopPropagation()} className="accent-[#325099]" />
                    )}
                  </label>
                ))}
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Personal note <span className="font-normal normal-case text-[#2A2035]/40">(optional — appears after the welcome)</span></label>
              <textarea
                value={content.personalNote}
                onChange={e => setContent(c => ({ ...c, personalNote: e.target.value }))}
                rows={3}
                placeholder={`Anything specific to ${studentName || 'this student'} — what you discussed on the phone, what to bring, parking…`}
                className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] resize-y"
              />
            </div>

            {/* Wording — collapsed by default; the defaults are usually fine. */}
            <div className="border border-[#DEE7FF] rounded-xl overflow-hidden">
              <button onClick={() => setShowCopy(s => !s)}
                className="w-full bg-[#F8FAFF] px-3 py-2 flex items-center justify-between text-xs font-bold text-[#062E63]">
                <span>Email wording</span>
                <span className="text-[#325099]/50">{showCopy ? '−' : '+'}</span>
              </button>
              {showCopy && (
                <div className="p-3 space-y-2.5">
                  <p className="text-[10px] text-[#2A2035]/45">
                    {'{{parent_name}}'} and {'{{student_name}}'} are filled in automatically. **bold** works.
                  </p>
                  {FIELDS.map(f => (
                    <div key={f.key}>
                      <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099]/70 mb-1">{f.label}</label>
                      <textarea
                        value={content[f.key]}
                        onChange={e => setContent(c => ({ ...c, [f.key]: e.target.value }))}
                        rows={f.rows}
                        className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] resize-y"
                      />
                    </div>
                  ))}
                  <button onClick={() => setContent(c => ({ ...DEFAULT_TRIAL_INVITATION_CONTENT, personalNote: c.personalNote }))}
                    className="text-[11px] font-semibold text-[#325099] hover:underline">Reset wording</button>
                </div>
              )}
            </div>
          </div>

          {/* Right: exactly what the parent receives */}
          <div className="px-6 py-5 bg-[#F8FAFF]">
            <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Preview</p>
            <p className="text-[11px] text-[#2A2035]/50 mb-3">
              Subject: <span className="font-semibold text-[#2A2035]/70">{fillTrialVars(content.subject, vars)}</span>
            </p>
            <iframe
              title="Trial invitation email preview"
              srcDoc={html}
              className="w-full h-[52vh] bg-white border border-[#DEE7FF] rounded-xl"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#F0F4FF] flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] min-w-0">
            {error   && <span className="text-rose-600 font-semibold">{error}</span>}
            {result  && <span className="text-emerald-600 font-semibold">{result}</span>}
            {!error && !result && (
              <span className="text-[#2A2035]/45">
                {proposal ? `Proposing ${proposal.className}${alternatives.length ? ` + ${alternatives.length} alternative${alternatives.length === 1 ? '' : 's'}` : ''}.` : 'No class proposal — welcome and note only.'}
                {' '}Sending marks the card Contacted.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onClose} className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035] px-3 py-2">Close</button>
            <button
              onClick={() => send(true)}
              disabled={sending || !parentEmail}
              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] hover:border-[#325099] px-4 py-2 rounded-lg transition disabled:opacity-40"
              title={`Send this exact email to ${TEST_RECIPIENT} only`}
            >
              {sending ? 'Sending…' : 'Send test to me'}
            </button>
            <button
              onClick={() => send(false)}
              disabled={sending || !parentEmail}
              className="text-xs font-semibold bg-[#325099] text-white px-4 py-2 rounded-lg hover:bg-[#062E63] transition disabled:opacity-40"
              title={`Send to ${parentEmail}`}
            >
              {sending ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

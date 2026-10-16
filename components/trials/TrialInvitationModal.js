'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { TEST_RECIPIENT } from '../../lib/emailConfig'
import {
  buildTrialInvitationEmailHtml, classTimeLabel, mergeTrialInvitationContent, joinNames,
  fillTrialVars, firstWeekdayOnOrAfter, fmtLessonDate, matchTrialClasses,
} from '../../lib/trialInvitationEmail'

/*
 * Trial invitation — the FIRST email to a trial family, composed per student
 * from the pipeline. Matches classes to the student's year + subject, ranks
 * them by the availability windows the family gave on the enquiry form, and
 * proposes the best fit with its next scheduled lesson date. Staff pick a
 * different proposal, tick which alternatives to include, and add a personal
 * note; the preview is exactly what sends.
 *
 * A family that asked about more than one trial (two subjects for one child,
 * or two children) gets ONE email: `related` is the family's other open
 * requests (same parent email). Each included request has its own suggested
 * class and alternatives and becomes its own section; sending marks them all.
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

export default function TrialInvitationModal({ sub, related = [], classes, term, onClose, onSent }) {
  // Every request this email could cover: the one opened, then the family's others.
  const candidates = useMemo(() => [sub, ...related.filter(r => r.id !== sub.id)], [sub, related])
  const [included, setIncluded] = useState(() => new Set([sub.id, ...related.filter(r => r.id !== sub.id && !r.invitation_sent_at).map(r => r.id)]))
  const [bySub, setBySub]       = useState({})      // sub id → scored classes + nextDate
  const [choice, setChoice]     = useState({})      // sub id → { proposalId, altIds: Set }
  const [loading, setLoading]   = useState(true)
  const [edits, setEdits]       = useState({})      // wording the user changed (else the defaults)
  const [showCopy, setShowCopy] = useState(false)
  const [sending, setSending]   = useState(false)
  const [result,  setResult]    = useState(null)
  const [error,   setError]     = useState(null)

  const subjectOf = (s) => (Array.isArray(s.subjects) ? s.subjects.join(', ') : s.subjects) || ''
  const firstSubjectOf = (s) => (Array.isArray(s.subjects) ? s.subjects[0] : s.subjects) || ''
  const parentName  = sub.parent_name || ''
  const parentEmail = sub.parent_email || ''
  const subs        = candidates.filter(s => included.has(s.id))
  const multi       = subs.length > 1
  const studentName = joinNames(subs.map(s => s.student_name)) || sub.student_name || ''
  const oneChild    = new Set(subs.map(s => (s.student_name || '').trim().toLowerCase())).size <= 1
  const content     = useMemo(() => mergeTrialInvitationContent(edits, multi), [edits, multi])
  const labelOf = useCallback((s) => (oneChild
    ? `${firstSubjectOf(s)} · Year ${s.student_year || '?'}`
    : `${s.student_name || 'Student'} — Year ${s.student_year || '?'} ${firstSubjectOf(s)}`), [oneChild])

  // Match + rank classes for every candidate request, then attach each class's
  // next scheduled lesson (one query for all of them).
  const candKey = candidates.map(s => `${s.id}:${s.student_year}:${firstSubjectOf(s)}`).join('|')
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      const ranked = Object.fromEntries(candidates.map(s => [s.id, matchTrialClasses(
        { year: s.student_year, subject: firstSubjectOf(s), availability: s.availability }, classes || [])]))
      const ids = [...new Set(Object.values(ranked).flat().map(c => c.id))]
      const nextByClass = {}
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
      const withDates = Object.fromEntries(Object.entries(ranked).map(([id, list]) => [id, list.map(c => ({
        ...c, nextDate: nextByClass[c.id] || firstWeekdayOnOrAfter(from, c.day_of_week),
      }))]))
      setBySub(withDates)
      setChoice(Object.fromEntries(Object.entries(withDates).map(([id, list]) => [id, {
        proposalId: list[0]?.id ?? null,
        altIds: new Set(list.slice(1, 4).map(c => c.id)),   // up to 3 alternatives by default
      }])))
      setLoading(false)
    })()
    return () => { active = false }
  }, [candKey, classes, term])   // eslint-disable-line react-hooks/exhaustive-deps

  const slotOf = useCallback((c) => c && ({
    className: c.class_name,
    day: c.day_of_week || '',
    time: classTimeLabel(c),
    date: fmtLessonDate(c.nextDate),
  }), [])
  const pick = useCallback((s) => {
    const list = bySub[s.id] || [], ch = choice[s.id] || { proposalId: null, altIds: new Set() }
    return {
      proposal: slotOf(list.find(c => c.id === ch.proposalId)) || null,
      alternatives: list.filter(c => c.id !== ch.proposalId && ch.altIds.has(c.id)).map(slotOf),
    }
  }, [bySub, choice, slotOf])
  const sections = useMemo(() => subs.map(s => ({ label: labelOf(s), ...pick(s) })), [subs, labelOf, pick])
  const { proposal, alternatives } = sections[0] || { proposal: null, alternatives: [] }
  const vars = useMemo(() => ({ parentName, studentName }), [parentName, studentName])
  const html = useMemo(
    () => buildTrialInvitationEmailHtml(vars, proposal || null, alternatives || [], content, multi ? sections : null),
    [vars, proposal, alternatives, content, multi, sections],
  )
  const setProposal = (sid, cid) => setChoice(m => ({ ...m, [sid]: { ...(m[sid] || { altIds: new Set() }), proposalId: cid } }))
  const toggleAlt = (sid, cid, on) => setChoice(m => {
    const cur = m[sid] || { proposalId: null, altIds: new Set() }
    const n = new Set(cur.altIds); on ? n.add(cid) : n.delete(cid)
    return { ...m, [sid]: { ...cur, altIds: n } }
  })

  const send = useCallback(async (test) => {
    setSending(true); setError(null); setResult(null)
    try {
      const res = await authedFetch('/api/send-trial-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionIds: subs.map(s => s.id), parentEmail, parentName, studentName,
          proposal, alternatives, sections: multi ? sections : null, content, test,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Send failed (${res.status})`)
      setResult(test ? `Test sent to ${TEST_RECIPIENT}` : `Sent to ${parentEmail}`)
      if (!test) onSent?.(subs.map(s => s.id), json.stampedIds || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }, [subs, parentEmail, parentName, studentName, proposal, alternatives, multi, sections, content, onSent])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">

        <div className="flex items-start justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Trial invitation</p>
            <h2 className="text-sm font-bold text-[#062E63]">
              {studentName || 'Student'}
              <span className="font-normal text-[#2A2035]/50"> · {oneChild ? `Year ${sub.student_year || '?'} ${subs.map(firstSubjectOf).join(' + ')}` : subs.map(s => `${(s.student_name || '').split(' ')[0]} ${firstSubjectOf(s)}`).join(' + ')}</span>
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
            {candidates.length > 1 && (
              <div className="rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] px-3 py-2.5">
                <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">In this email</p>
                <p className="text-[11px] text-[#2A2035]/50 mb-2">This family asked about more than one trial — send them together in one email.</p>
                <div className="space-y-1">
                  {candidates.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-xs text-[#2A2035] cursor-pointer">
                      <input type="checkbox" className="accent-[#325099]" checked={included.has(s.id)} disabled={s.id === sub.id}
                        onChange={e => setIncluded(prev => { const n = new Set(prev); e.target.checked ? n.add(s.id) : n.delete(s.id); return n })} />
                      <span className="font-semibold">{s.student_name || 'Student'}</span>
                      <span className="text-[#2A2035]/55">Year {s.student_year || '?'} {subjectOf(s)}</span>
                      {s.invitation_sent_at && <span className="text-[10px] text-[#325099]/70">· already invited</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Suggested class{multi ? 'es' : ''}</p>
              <p className="text-[11px] text-[#2A2035]/50">
                Matched on year + subject, ranked by the availability the family gave. Pick the proposal; tick the times to offer as alternatives.
              </p>
            </div>

            {loading ? (
              <p className="text-xs text-[#2A2035]/40 py-6 text-center">Matching classes…</p>
            ) : subs.map(s => {
              const list = bySub[s.id] || []
              const ch = choice[s.id] || { proposalId: null, altIds: new Set() }
              return (
                <div key={s.id} className="space-y-2">
                  {multi && <p className="text-xs font-bold text-[#062E63]">{labelOf(s)}</p>}
                  {list.length === 0 ? (
                    <div className="text-center py-6 px-4 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl">
                      <p className="text-sm text-[#2A2035]/50">No Year {s.student_year || '?'} {firstSubjectOf(s)} class found this term.</p>
                      <p className="text-[11px] text-[#2A2035]/40 mt-1">{multi ? 'This section will say you’ll be in touch with a time.' : 'The email can still go out with just the welcome and your note — or reply to the family manually.'}</p>
                    </div>
                  ) : list.map(c => (
                    <label key={c.id} className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition ${
                      ch.proposalId === c.id ? 'border-[#325099] bg-[#F0F4FF]' : 'border-[#DEE7FF] bg-white hover:border-[#325099]/50'}`}>
                      <input type="radio" name={`proposal-${s.id}`} checked={ch.proposalId === c.id}
                        onChange={() => setProposal(s.id, c.id)} className="accent-[#325099]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-[#062E63] truncate">{c.class_name}</p>
                        <p className="text-[11px] text-[#2A2035]/60">
                          {c.day_of_week}s · {classTimeLabel(c)}
                          {c.nextDate ? <> · next lesson <span className="font-semibold">{fmtLessonDate(c.nextDate)}</span></> : <> · <span className="text-amber-600">no scheduled lesson found</span></>}
                        </p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${FIT_STYLE[c.fit]}`}>{FIT_LABEL[c.fit]}</span>
                      {ch.proposalId !== c.id && (
                        <input type="checkbox" checked={ch.altIds.has(c.id)} title="Offer as an alternative time"
                          onChange={e => toggleAlt(s.id, c.id, e.target.checked)}
                          onClick={e => e.stopPropagation()} className="accent-[#325099]" />
                      )}
                    </label>
                  ))}
                </div>
              )
            })}

            <div>
              <label className="block text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Personal note <span className="font-normal normal-case text-[#2A2035]/40">(optional — appears after the welcome)</span></label>
              <textarea
                value={content.personalNote}
                onChange={e => setEdits(c => ({ ...c, personalNote: e.target.value }))}
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
                        onChange={e => setEdits(c => ({ ...c, [f.key]: e.target.value }))}
                        rows={f.rows}
                        className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] resize-y"
                      />
                    </div>
                  ))}
                  <button onClick={() => setEdits(c => ({ personalNote: c.personalNote || '' }))}
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
                {multi
                  ? `${subs.length} trials in one email: ${sections.map(x => x.proposal?.className || `${x.label} (no class yet)`).join(', ')}.`
                  : proposal ? `Proposing ${proposal.className}${alternatives.length ? ` + ${alternatives.length} alternative${alternatives.length === 1 ? '' : 's'}` : ''}.` : 'No class proposal — welcome and note only.'}
                {' '}Sending marks {multi ? 'each card' : 'the card'} Contacted.
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

'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { TEST_RECIPIENT } from '../../lib/emailConfig'
import { buildTrialOutcomeEmailHtml, DEFAULT_TRIAL_OUTCOME_CONTENT, fillTrialVars } from '../../lib/trialOutcomeEmail'

/*
 * Trial outcome email — composed per student from the trial pipeline.
 *
 * Pulls every trial lesson the student attended (attendance rows carrying the
 * tutor's trial_feedback, written in SessionMarker) and groups them by class.
 * The feedback was written for internal eyes, so it is editable here before it
 * goes to a parent; edits apply to this email only and never touch attendance.
 *
 * There is no hard "trial complete" gate — the lesson count is shown per class
 * (e.g. 2/2) and staff decide when to send.
 */

const EXPECTED_LESSONS = 2   // a standard CUBE trial — shown as "n/2", not enforced

const FIELDS = [
  { key: 'subject',         label: 'Subject line', rows: 1 },
  { key: 'greeting',        label: 'Greeting',     rows: 1 },
  { key: 'intro',           label: 'Intro',        rows: 4 },
  { key: 'feedbackHeading', label: 'Feedback heading', rows: 1 },
  { key: 'nextHeading',     label: 'Next-steps heading', rows: 1 },
  { key: 'nextBody',        label: 'Next steps',   rows: 3 },
  { key: 'optOutNote',      label: 'Opt-out line (kept subtle)', rows: 2 },
  { key: 'signoff',         label: 'Sign-off',     rows: 2 },
]

export default function TrialOutcomeModal({ sub, onClose, onSent }) {
  const [loading, setLoading] = useState(true)
  const [groups,  setGroups]  = useState([])          // [{ classId, subject, lessons:[{label, feedback, date}] }]
  const [content, setContent] = useState(DEFAULT_TRIAL_OUTCOME_CONTENT)
  const [showCopy, setShowCopy] = useState(false)
  const [sending, setSending] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState(null)

  const parentName  = sub.parent_name || ''
  const studentName = sub.student_name || ''
  const parentEmail = sub.parent_email || ''

  // Trial lessons for this student: attended sessions, oldest first, labelled
  // per class so a two-subject trial reads as two separate blocks.
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      if (!sub.converted_student_id) { if (active) { setGroups([]); setLoading(false) }; return }
      const { data: rows } = await supabase
        .from('attendance')
        .select('id, class_id, session_date, status, trial_feedback')
        .eq('student_id', sub.converted_student_id)
        .in('status', ['present', 'late'])
        .order('session_date', { ascending: true })
      const classIds = [...new Set((rows || []).map(r => r.class_id).filter(Boolean))]
      const { data: classRows } = classIds.length
        ? await supabase.from('classes').select('id, class_name').in('id', classIds)
        : { data: [] }
      const nameById = Object.fromEntries((classRows || []).map(c => [c.id, c.class_name]))

      const byClass = new Map()
      for (const r of rows || []) {
        if (!byClass.has(r.class_id)) byClass.set(r.class_id, [])
        byClass.get(r.class_id).push(r)
      }
      const built = [...byClass.entries()].map(([classId, list]) => ({
        classId,
        subject: nameById[classId] || 'Trial lessons',
        lessons: list.map((r, i) => ({
          label: `Lesson ${i + 1}`,
          date: r.session_date,
          feedback: r.trial_feedback || '',
        })),
      }))
      if (active) { setGroups(built); setLoading(false) }
    })()
    return () => { active = false }
  }, [sub.converted_student_id])

  const vars = useMemo(() => ({ parentName, studentName }), [parentName, studentName])
  const html = useMemo(
    () => buildTrialOutcomeEmailHtml(vars, groups, content),
    [vars, groups, content],
  )

  const setLesson = (gi, li, feedback) => setGroups(gs =>
    gs.map((g, i) => i !== gi ? g : { ...g, lessons: g.lessons.map((l, j) => j === li ? { ...l, feedback } : l) }))

  const withFeedback = groups.reduce((n, g) => n + g.lessons.filter(l => l.feedback.trim()).length, 0)

  const send = useCallback(async (test) => {
    setSending(true); setError(null); setResult(null)
    try {
      const res = await authedFetch('/api/send-trial-outcome-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentEmail, parentName, studentName, groups, content, test }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Send failed (${res.status})`)
      setResult(test ? `Test sent to ${TEST_RECIPIENT}` : `Sent to ${parentEmail}`)
      if (!test) onSent?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }, [parentEmail, parentName, studentName, groups, content, onSent])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">

        <div className="flex items-start justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Trial outcome email</p>
            <h2 className="text-sm font-bold text-[#062E63]">
              {studentName || 'Student'}
              {parentEmail
                ? <span className="font-normal text-[#2A2035]/50"> · to {parentName ? `${parentName}, ` : ''}{parentEmail}</span>
                : <span className="font-normal text-rose-500"> · no parent email on this trial</span>}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg shrink-0">×</button>
        </div>

        <div className="flex-1 overflow-y-auto grid md:grid-cols-2 gap-0 divide-x divide-[#F0F4FF]">
          {/* Left: the tutors' feedback, editable */}
          <div className="px-6 py-5 space-y-4">
            <div>
              <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Tutor feedback</p>
              <p className="text-[11px] text-[#2A2035]/50">
                Written after each trial lesson. Edit anything here before it goes to a parent — attendance records aren’t changed.
              </p>
            </div>

            {loading ? (
              <p className="text-xs text-[#2A2035]/40 py-6 text-center">Loading trial lessons…</p>
            ) : groups.length === 0 ? (
              <div className="text-center py-8 px-4 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl">
                <p className="text-sm text-[#2A2035]/50">No attended trial lessons found for this student.</p>
                <p className="text-[11px] text-[#2A2035]/40 mt-1">
                  Lessons appear here once they’re marked present in the session marker.
                </p>
              </div>
            ) : groups.map((g, gi) => (
              <div key={g.classId ?? gi} className="border border-[#DEE7FF] rounded-xl overflow-hidden">
                <div className="bg-[#F8FAFF] px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#062E63] truncate">{g.subject}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    g.lessons.length >= EXPECTED_LESSONS
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'}`}>
                    {g.lessons.length}/{EXPECTED_LESSONS} lessons
                  </span>
                </div>
                <div className="p-3 space-y-3">
                  {g.lessons.map((l, li) => (
                    <div key={li}>
                      <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099]/70 mb-1">
                        {l.label}{l.date ? <span className="font-normal text-[#2A2035]/35"> · {l.date}</span> : null}
                      </label>
                      <textarea
                        value={l.feedback}
                        onChange={e => setLesson(gi, li, e.target.value)}
                        rows={3}
                        placeholder="No feedback was written for this lesson — it will be left out of the email."
                        className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] resize-y"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

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
                  <button onClick={() => setContent(DEFAULT_TRIAL_OUTCOME_CONTENT)}
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
              title="Trial outcome email preview"
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
                {withFeedback} lesson{withFeedback === 1 ? '' : 's'} of feedback will be included.
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
              disabled={sending || !parentEmail || withFeedback === 0}
              className="text-xs font-semibold bg-[#325099] text-white px-4 py-2 rounded-lg hover:bg-[#062E63] transition disabled:opacity-40"
              title={withFeedback === 0 ? 'Add at least one lesson of feedback first' : `Send to ${parentEmail}`}
            >
              {sending ? 'Sending…' : 'Send to parent'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { TEST_RECIPIENT } from '../../lib/emailConfig'
import { buildTrialOutcomeEmailHtml, fillTrialVars, stageGroups, nextLessonText, TRIAL_EMAIL_STAGES } from '../../lib/trialOutcomeEmail'
import EmailWording from './EmailWording'

/*
 * Trial feedback emails — composed per student from the trial pipeline. One
 * composer, two stages:
 *   lesson1  each subject's FIRST trial lesson, plus the next trial lesson's
 *            date and time (prefilled, editable)
 *   outcome  each subject's SECOND trial lesson, plus how to continue
 *
 * Pulls every trial lesson the student attended (attendance rows carrying the
 * tutor's trial_feedback, written in SessionMarker) and groups them by class.
 * The feedback was written for internal eyes, so it is editable here before it
 * goes to a parent; edits apply to this email only and never touch attendance.
 *
 * There is no hard "trial complete" gate — the lesson count is shown per class
 * (e.g. 2/2) and staff decide when to send.
 */


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

// classId: one subject of a multi-subject trial — only that class's lessons.
export default function TrialOutcomeModal({ sub, stage = 'outcome', classId = null, onClose, onSent }) {
  const stageInfo = TRIAL_EMAIL_STAGES[stage] || TRIAL_EMAIL_STAGES.outcome
  const [loading, setLoading] = useState(true)
  const [groups,  setGroups]  = useState([])          // this stage's lesson per class: [{ classId, subject, lessons:[{label, feedback, date}] }]
  const [missing, setMissing] = useState([])          // subjects trialled that haven't had this lesson yet
  const [nextLesson, setNextLesson] = useState('')    // lesson1: the next trial lesson, for {{next_lesson}}
  const [content, setContent] = useState(stageInfo.defaults)
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
      if (!sub.converted_student_id) { if (active) { setGroups([]); setMissing([]); setLoading(false) }; return }
      // Only trial lessons: trial_feedback is written (and required) while the
      // enrolment is a trial, so it marks the lesson as part of the trial and
      // keeps an already-enrolled student's ongoing lessons out of this list.
      const { data: rows } = await supabase
        .from('attendance')
        .select('id, class_id, session_date, status, trial_feedback')
        .eq('student_id', sub.converted_student_id)
        .in('status', ['present', 'late'])
        .not('trial_feedback', 'is', null)
        .order('session_date', { ascending: true })
        .match(classId != null ? { class_id: classId } : {})
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
      const staged = stageGroups(built, stage)
      // lesson1: the next trial lesson in each subject — the class's next
      // lesson after the one just had (its own time, else the class's).
      let next = ''
      if (stage === 'lesson1' && staged.length) {
        const { data: cls } = await supabase.from('classes').select('id, start_time, end_time').in('id', staged.map(g => g.classId))
        const clsById = Object.fromEntries((cls || []).map(c => [c.id, c]))
        const upcoming = await Promise.all(staged.map(g => supabase.from('lessons')
          .select('lesson_date, start_time, end_time').eq('class_id', g.classId).eq('is_makeup', false).neq('status', 'cancelled')
          .gt('lesson_date', g.lessons[0].date).order('lesson_date', { ascending: true }).limit(1)))
        next = nextLessonText(staged.map((g, i) => {
          const l = upcoming[i].data?.[0]
          return l ? { subject: g.subject, date: l.lesson_date, start: l.start_time || clsById[g.classId]?.start_time, end: l.end_time || clsById[g.classId]?.end_time } : null
        }).filter(Boolean))
      }
      if (active) {
        setGroups(staged)
        setMissing(built.filter(g => !staged.some(x => x.classId === g.classId)).map(g => g.subject))
        setNextLesson(next)
        setLoading(false)
      }
    })()
    return () => { active = false }
  }, [sub.converted_student_id, stage, classId])

  const vars = useMemo(() => ({ parentName, studentName, nextLesson }), [parentName, studentName, nextLesson])
  const html = useMemo(
    () => buildTrialOutcomeEmailHtml(vars, groups, content, stage),
    [vars, groups, content, stage],
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
        body: JSON.stringify({ parentEmail, parentName, studentName, groups, content, test, stage, nextLesson, submissionId: sub.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Send failed (${res.status})`)
      setResult(test ? `Test sent to ${TEST_RECIPIENT}` : `Sent to ${parentEmail}`)
      if (!test) onSent?.(stageInfo.sentField, json.sentAt)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }, [parentEmail, parentName, studentName, groups, content, onSent, stage, nextLesson, sub.id, stageInfo.sentField])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">

        <div className="flex items-start justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">{stageInfo.label} email</p>
            <h2 className="text-sm font-bold text-[#062E63]">
              {studentName || 'Student'}
              {parentEmail
                ? <span className="font-normal text-[#2A2035]/50"> · to {parentName ? `${parentName}, ` : ''}{parentEmail}</span>
                : <span className="font-normal text-rose-500"> · no parent email on this trial</span>}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg shrink-0">×</button>
        </div>

        <div className="flex-1 overflow-y-auto grid md:grid-cols-2 gap-0 divide-x divide-[#F0F4FF] bg-[#F8FAFF]">
          {/* Left: the tutors' feedback, editable */}
          <div className="px-6 py-5 space-y-4 bg-white">
            <div>
              <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Tutor feedback</p>
              <p className="text-[11px] text-[#2A2035]/50">
                {stage === 'lesson1'
                  ? 'Written after the first trial lesson. Edit anything here before it goes to a parent — attendance records aren’t changed.'
                  : 'Written after the second trial lesson. Edit anything here before it goes to a parent — attendance records aren’t changed.'}
              </p>
            </div>

            {loading ? (
              <p className="text-xs text-[#2A2035]/40 py-6 text-center">Loading trial lessons…</p>
            ) : groups.length === 0 ? (
              <div className="text-center py-8 px-4 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl">
                <p className="text-sm text-[#2A2035]/50">No {stage === 'lesson1' ? 'first' : 'second'} trial lesson marked yet for this student.</p>
                <p className="text-[11px] text-[#2A2035]/40 mt-1">
                  Lessons appear here once they’re marked present in the session marker.
                </p>
              </div>
            ) : groups.map((g, gi) => (
              <div key={g.classId ?? gi} className="border border-[#DEE7FF] rounded-xl overflow-hidden">
                <div className="bg-[#F8FAFF] px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#062E63] truncate">{g.subject}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 bg-emerald-100 text-emerald-700">
                    Lesson {stageInfo.lessonIndex + 1} marked
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

            {!loading && missing.length > 0 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Not in this email yet: {missing.join(', ')} — lesson {stageInfo.lessonIndex + 1} hasn’t been marked there.
              </p>
            )}
            {stage === 'lesson1' && !loading && groups.length > 0 && (
              <div>
                <label className="block text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Next trial lesson</label>
                <input
                  value={nextLesson}
                  onChange={e => setNextLesson(e.target.value)}
                  placeholder="e.g. Saturday 24 October, 9:00am–10:30am"
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]"
                />
                <p className="text-[10px] text-[#2A2035]/45 mt-1">
                  Filled in from the class’s next lesson. Goes into the email wherever {'{{next_lesson}}'} appears.
                </p>
              </div>
            )}

            <EmailWording
              fields={FIELDS}
              values={content}
              onChange={(k, v) => setContent(c => ({ ...c, [k]: v }))}
              onReset={() => setContent(stageInfo.defaults)}
              hint={stage === 'lesson1' ? '{{parent_name}}, {{student_name}} and {{next_lesson}} fill in automatically.' : '{{parent_name}} and {{student_name}} fill in automatically.'}
            />
          </div>

          {/* Right: exactly what the parent receives */}
          <div className="px-6 py-5 md:sticky md:top-0 md:self-start">
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

'use client'
import { useEffect, useMemo, useState } from 'react'
import { TEST_RECIPIENT } from '../../lib/emailConfig'
import {
  DEFAULT_TRIAL_REMINDER_SUBJECT, DEFAULT_TRIAL_REMINDER_TEMPLATE,
  buildReminderPreviewHtml, fillReminderTemplate, loadReminderWording, saveReminderWording, sendTrialReminders,
} from '../../lib/trialReminderEmail'
import { fmtDate } from '../../lib/format'

/*
 * Trial reminder — sent from the pipeline. One family (the card's button) or
 * several at once (the page's "Send reminders"): tick who gets it, read the
 * exact email for any of them, adjust the wording, send. Each real send is
 * stamped on the submission, so the card shows "Reminded <date>".
 *
 * `entries`: [{ sub, family }] — family in the send route's shape
 * (lib/trialReminderEmail reminderFamilyFor).
 */
export default function TrialReminderModal({ entries, termId, termName, onClose, onSent }) {
  const bulk = entries.length > 1
  const [wording, setWording] = useState({ template: DEFAULT_TRIAL_REMINDER_TEMPLATE, subject: DEFAULT_TRIAL_REMINDER_SUBJECT })
  const [picked, setPicked]   = useState(() => new Set(entries.filter(e => !e.sub.reminder_sent_at || !bulk).map(e => e.sub.id)))
  const [focus, setFocus]     = useState(entries[0]?.sub.id ?? null)
  const [sending, setSending] = useState(false)
  const [note, setNote]       = useState(null)
  const [error, setError]     = useState(null)
  const [results, setResults] = useState(null)

  // The saved wording lives in the browser; read it after mount.
  useEffect(() => { const t = setTimeout(() => setWording(loadReminderWording()), 0); return () => clearTimeout(t) }, [])

  const focused = entries.find(e => e.sub.id === focus) || entries[0]
  const html = useMemo(() => focused ? buildReminderPreviewHtml(wording.template, focused.family, termName) : '', [focused, wording.template, termName])
  const sendable = entries.filter(e => picked.has(e.sub.id) && e.family.parent_email)
  const noEmail  = entries.filter(e => picked.has(e.sub.id) && !e.family.parent_email)

  const updateWording = (patch) => setWording(w => { const n = { ...w, ...patch }; saveReminderWording(n); return n })

  const send = async (test) => {
    const targets = test ? [focused].filter(Boolean) : sendable
    if (!targets.length) return
    setSending(true); setError(null); setNote(null)
    try {
      const res = await sendTrialReminders(targets.map(t => t.family), { termId, termName, template: wording.template, subject: wording.subject, test })
      if (test) { setNote(`Test for ${focused.family.parent_name || focused.family.parent_email} sent to ${TEST_RECIPIENT}.`); return }
      setResults(res)
      onSent?.(res.filter(r => r.success).map(r => r.submission_id))
    } catch (e) { setError(e.message) } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Trial reminder</p>
            <h2 className="text-sm font-bold text-[#062E63]">
              {bulk ? `${entries.length} trial families` : (focused?.sub.student_name || 'Student')}
              {!bulk && focused && (focused.family.parent_email
                ? <span className="font-normal text-[#2A2035]/50"> · to {focused.family.parent_name ? `${focused.family.parent_name}, ` : ''}{focused.family.parent_email}</span>
                : <span className="font-normal text-rose-500"> · no parent email on this trial</span>)}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg shrink-0">×</button>
        </div>

        <div className="flex-1 overflow-y-auto grid md:grid-cols-2 divide-x divide-[#F0F4FF] bg-[#F8FAFF]">
          <div className="px-6 py-5 space-y-4 bg-white">
            {bulk && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099]">Who gets it · {picked.size}</p>
                  <div className="flex gap-2 text-[11px] font-semibold text-[#325099]">
                    <button onClick={() => setPicked(new Set(entries.map(e => e.sub.id)))} className="hover:underline">All</button>
                    <button onClick={() => setPicked(new Set(entries.filter(e => !e.sub.reminder_sent_at).map(e => e.sub.id)))} className="hover:underline">Not yet reminded</button>
                    <button onClick={() => setPicked(new Set())} className="hover:underline">None</button>
                  </div>
                </div>
                <div className="border border-[#EEF2FB] rounded-xl divide-y divide-[#F0F4FF] max-h-64 overflow-y-auto">
                  {entries.map(({ sub, family }) => {
                    const r = results?.find(x => x.submission_id === sub.id)
                    return (
                      <div key={sub.id} className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer ${focus === sub.id ? 'bg-[#F0F4FF]' : 'hover:bg-[#F8FAFF]'}`} onClick={() => setFocus(sub.id)}>
                        <input type="checkbox" checked={picked.has(sub.id)} onClick={e => e.stopPropagation()}
                          onChange={() => setPicked(p => { const n = new Set(p); n.has(sub.id) ? n.delete(sub.id) : n.add(sub.id); return n })} className="accent-[#062E63]" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[#062E63] truncate">{sub.student_name} <span className="font-normal text-[#2A2035]/50">· {family.students.map(s => s.class_name).join(', ')}</span></p>
                          <p className="text-[11px] text-[#2A2035]/50 truncate">{family.parent_email || <span className="text-rose-500">no parent email</span>}{family.students[0]?.trial_dates_label ? ` · ${family.students[0].trial_dates_label}` : ' · no lesson dates yet'}</p>
                        </div>
                        {r ? (r.success ? <span className="text-[10px] font-semibold text-emerald-700">Sent</span> : <span className="text-[10px] font-semibold text-rose-600" title={r.error || ''}>Failed</span>)
                          : sub.reminder_sent_at ? <span className="text-[10px] font-semibold text-sky-700" title={`Reminded ${fmtDate(sub.reminder_sent_at)}`}>Reminded {fmtDate(sub.reminder_sent_at)}</span> : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!bulk && focused && (
              <div className="rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] px-4 py-3 text-xs text-[#2A2035]/70">
                {focused.family.students.map(s => (
                  <p key={s.class_id}><span className="font-semibold text-[#062E63]">{s.class_name}</span> · {s.trial_dates_label || <span className="text-amber-700">no lesson dates in the timetable yet — the weekday is used</span>}{s.class_start ? ` · ${s.class_start}${s.class_end ? ` - ${s.class_end}` : ''}` : ''}</p>
                ))}
                {focused.sub.reminder_sent_at && <p className="mt-1 text-sky-700 font-semibold">Already reminded {fmtDate(focused.sub.reminder_sent_at)} — this sends again.</p>}
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Subject line</label>
              <input value={wording.subject} onChange={e => updateWording({ subject: e.target.value })}
                className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]" />
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <label className="block text-[11px] font-bold tracking-widest uppercase text-[#325099]">Email</label>
                <button onClick={() => updateWording({ template: DEFAULT_TRIAL_REMINDER_TEMPLATE, subject: DEFAULT_TRIAL_REMINDER_SUBJECT })} className="text-[11px] font-semibold text-[#325099] hover:underline">Reset to template</button>
              </div>
              <p className="text-[10px] text-[#2A2035]/45 mb-1.5">The template text — edit it freely. {'{{parent_name}}'}, {'{{student_names}}'} and {'{{class_details}}'} fill in per family. **bold** works. Saved for next time.</p>
              <textarea value={wording.template} onChange={e => updateWording({ template: e.target.value })} rows={16}
                className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs leading-relaxed text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] resize-y" />
            </div>
          </div>

          <div className="px-6 py-5 md:sticky md:top-0 md:self-start">
            <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099] mb-1">Preview{bulk && focused ? ` · ${focused.sub.student_name}` : ''}</p>
            <p className="text-[11px] text-[#2A2035]/50 mb-3">Subject: <span className="font-semibold text-[#2A2035]/70">{focused ? fillReminderTemplate(wording.subject, focused.family, termName) : ''}</span></p>
            <iframe title="Trial reminder email preview" srcDoc={html} className="w-full h-[52vh] bg-white border border-[#DEE7FF] rounded-xl" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#F0F4FF] flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] min-w-0">
            {error && <span className="text-rose-600 font-semibold">{error}</span>}
            {!error && note && <span className="text-emerald-600 font-semibold">{note}</span>}
            {!error && !note && results && <span className="text-emerald-600 font-semibold">Sent to {results.filter(r => r.success).length} of {results.length}.</span>}
            {!error && !note && !results && (
              <span className="text-[#2A2035]/45">
                {sendable.length ? `Sending to ${sendable.length} famil${sendable.length === 1 ? 'y' : 'ies'}.` : 'Nobody selected.'}
                {noEmail.length ? ` ${noEmail.length} skipped — no parent email.` : ''} Each send is recorded on the card.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onClose} className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035] px-3 py-2">{results ? 'Done' : 'Close'}</button>
            <button onClick={() => send(true)} disabled={sending || !focused?.family.parent_email}
              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] hover:border-[#325099] px-4 py-2 rounded-lg transition disabled:opacity-40"
              title={`Send ${focused?.sub.student_name || 'this'} family's email to ${TEST_RECIPIENT} only`}>
              {sending ? 'Sending…' : 'Send test to me'}
            </button>
            <button onClick={() => send(false)} disabled={sending || !sendable.length || !!results}
              className="text-xs font-semibold bg-[#325099] text-white px-4 py-2 rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">
              {sending ? 'Sending…' : bulk ? `Send ${sendable.length} reminder${sendable.length === 1 ? '' : 's'}` : (focused?.sub.reminder_sent_at ? 'Send again' : 'Send reminder')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

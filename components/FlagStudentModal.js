'use client'
import { useEffect, useState } from 'react'
import { authedFetch } from '../lib/authedFetch'
import { createFlag, FLAG_REASONS, reasonMeta } from '../lib/studentFlags'

/*
 * FlagStudentModal — raise a concern about a student from the lesson page.
 *
 * Props:
 *   students     — [{ id, full_name }] the picker is limited to (the roster)
 *   classId / classLabel / lessonDate — session context stored with the flag
 *   staff        — signed-in staff row, recorded as who raised it
 *   onClose(saved) — called with true once a flag has been written
 *
 * The flag is written first and the email fired after: a notification that
 * fails must never lose the flag, which is the thing directors act on.
 */
export default function FlagStudentModal({
  students = [],
  classId = null, classLabel = null, lessonDate = null,
  staff = null, onClose,
}) {
  const [studentId, setStudentId] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose?.(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  const student = students.find(s => s.id === studentId) || null

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (!student) return setError('Pick a student.')
    if (!reason) return setError('Pick a reason for the flag.')
    setSaving(true)
    try {
      await createFlag({ student, classId, className: classLabel, lessonDate, reason, note, staff })
      // Best-effort notification — the flag is already saved and will show in
      // the Action Centre regardless of what the mail provider does.
      authedFetch('/api/notify-student-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: student.full_name, className: classLabel, lessonDate,
          reason, reasonLabel: reasonMeta(reason).label,
          note: note.trim(), raisedBy: staff?.full_name || null,
        }),
      }).catch(err => console.warn('Flag email failed (the flag itself saved):', err))
      onClose?.(true)
    } catch (err) {
      setError(err.message || 'Could not save the flag.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#062E63]/40 backdrop-blur-sm"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose?.(false) }}>
      <form onSubmit={submit}
            className="bg-white rounded-2xl border border-[#DEE7FF] shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-[#F0F4FF] bg-[#F8FAFF] rounded-t-2xl">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1">Raise a concern</p>
          <h3 className="text-lg font-semibold text-[#2A2035] font-display">🚩 Flag a student</h3>
          <p className="text-[11px] text-[#2A2035]/55 mt-1">
            Goes straight to the directors — by email and in the Action Centre — and stays there until it&rsquo;s dealt with.
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-bold text-[#062E63] mb-1.5">Student name</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)} disabled={saving}
                    className="w-full rounded-xl border border-[#DEE7FF] px-3 py-2.5 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 disabled:opacity-50">
              <option value="">Select a student…</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#062E63] mb-1.5">Reason for flag</label>
            <div className="grid grid-cols-2 gap-2">
              {FLAG_REASONS.map(r => (
                <button key={r.value} type="button" disabled={saving}
                        onClick={() => setReason(r.value)}
                        className={`text-left px-3 py-2 rounded-xl border text-xs font-semibold transition disabled:opacity-50 ${
                          reason === r.value
                            ? 'border-[#325099] bg-[#EEF4FF] text-[#062E63] ring-1 ring-[#325099]/30'
                            : 'border-[#DEE7FF] bg-white text-[#2A2035]/70 hover:bg-[#F8FAFF]'}`}>
                  <span className="mr-1.5">{r.icon}</span>{r.label}
                </button>
              ))}
            </div>
            {reason && <p className="text-[11px] text-[#2A2035]/50 mt-2">{reasonMeta(reason).hint}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-[#062E63] mb-1.5">
              Details <span className="font-normal text-[#2A2035]/45">(optional)</span>
            </label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} disabled={saving}
                      placeholder="What happened, and what would you like done about it?"
                      className="w-full rounded-xl border border-[#DEE7FF] px-3 py-2.5 text-sm text-[#2A2035] focus:outline-none focus:ring-2 focus:ring-[#325099]/30 disabled:opacity-50" />
          </div>

          {(classLabel || lessonDate) && (
            <p className="text-[11px] text-[#2A2035]/45">
              Filed against {classLabel || 'this class'}{lessonDate ? ` · ${lessonDate}` : ''}
              {staff?.full_name ? ` · raised by ${staff.full_name}` : ''}
            </p>
          )}
          {error && <p className="px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#F0F4FF] bg-[#F8FAFF] rounded-b-2xl flex justify-end gap-2">
          <button type="button" onClick={() => onClose?.(false)} disabled={saving}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#2A2035]/60 hover:bg-white disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={saving || !studentId || !reason}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#325099] hover:bg-[#062E63] transition disabled:opacity-40">
            {saving ? 'Flagging…' : '🚩 Submit flag'}
          </button>
        </div>
      </form>
    </div>
  )
}

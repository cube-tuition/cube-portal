'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isRosteredTutor, yearGroupLabel } from '../../lib/dropin'

/*
 * A drop-in, opened from the calendar by the teacher rostered on it.
 *
 * Two jobs: show who booked in (so the teacher knows what is coming), and let
 * that teacher confirm the hours they actually worked and save their payroll
 * shift. The shift is written through the `save_dropin_shift` RPC — the rate
 * comes from the year-band matrix inside the database, never from here, and the
 * RPC refuses anyone who is not rostered on the session.
 */

const STATUS_BADGE = {
  draft:     { bg: '#FEF3C7', fg: '#92400E', label: 'Pending review' },
  submitted: { bg: '#DEE7FF', fg: '#062E63', label: 'Submitted' },
  approved:  { bg: '#DCFCE7', fg: '#166534', label: 'Approved' },
  paid:      { bg: '#E2E5EB', fg: '#4B5563', label: 'Paid' },
  void:      { bg: '#FEE2E2', fg: '#991B1B', label: 'Void' },
}

const fmt12 = (t) => {
  if (!t) return '—'
  const [h, m] = String(t).split(':').map(Number)
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`
}
const fmtDate = (d) => (d
  ? new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  : '—')
// <input type="time"> wants HH:MM; the column is HH:MM:SS.
const toInput = (t) => (t ? String(t).slice(0, 5) : '')

const hoursBetween = (start, end) => {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  return mins > 0 ? mins / 60 : null
}

export default function DropinShiftModal({ session, staff, onClose }) {
  const [signins, setSignins] = useState([])
  const [shift, setShift] = useState(null)
  const [start, setStart] = useState(toInput(session?.start_time))
  const [end, setEnd] = useState(toInput(session?.end_time))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const rostered = useMemo(() => isRosteredTutor(session, staff?.full_name), [session, staff])
  const sourceId = session && staff ? `${session.id}_${staff.id}` : null
  const hours = hoursBetween(start, end)

  const load = useCallback(async () => {
    if (!session?.id) return
    setLoading(true)
    const [{ data: si }, { data: sh }] = await Promise.all([
      supabase.from('dropin_signins')
        .select('id, subject, question, status, students(full_name)')
        .eq('session_id', session.id).order('signed_in_at'),
      sourceId
        ? supabase.from('shifts')
            .select('id, start_time, end_time, hours, rate_snapshot, status')
            .eq('source_table', 'dropin_sessions').eq('source_id', sourceId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    setSignins(si || [])
    setShift(sh || null)
    // An existing shift is the source of truth for the hours — the teacher may
    // already have trimmed or extended them.
    if (sh?.start_time) setStart(toInput(sh.start_time))
    if (sh?.end_time) setEnd(toInput(sh.end_time))
    setLoading(false)
  }, [session?.id, sourceId])

  useEffect(() => { load() }, [load])

  const settled = shift && shift.status !== 'draft'

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    const { data, error: e } = await supabase.rpc('save_dropin_shift', {
      p_session_id: session.id,
      p_start: start ? `${start}:00` : null,
      p_end: end ? `${end}:00` : null,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    const row = Array.isArray(data) ? data[0] : data
    if (row) setShift(row)
    setSaved(true)
  }

  const badge = STATUS_BADGE[shift?.status] || null

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] my-10">
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-[#DEE7FF]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-[#CCFBF1] text-[#0F766E]">Drop-in</span>
              {badge && (
                <span className="text-[9px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full"
                  style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
              )}
            </div>
            <h2 className="text-lg font-bold text-[#062E63] mt-1.5">{fmtDate(session?.session_date)}</h2>
            <p className="text-xs text-[#325099]/70 mt-0.5">
              {fmt12(session?.start_time)} – {fmt12(session?.end_time)}
              {session?.location ? ` · ${session.location}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-[#325099]/50 hover:text-[#325099] text-lg leading-none">✕</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[#2A2035]/70">
            <span><span className="font-semibold text-[#062E63]">On:</span> {(session?.tutors || []).join(', ') || '—'}</span>
            <span><span className="font-semibold text-[#062E63]">Years:</span> {yearGroupLabel(session?.year_groups)}</span>
          </div>

          {/* Who booked in */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#325099]/60 mb-1.5">
              Booked in {loading ? '' : `· ${signins.length}${session?.max_capacity ? ` / ${session.max_capacity}` : ''}`}
            </p>
            {loading ? (
              <p className="text-xs text-[#2A2035]/40">Loading…</p>
            ) : signins.length === 0 ? (
              <p className="text-xs text-[#2A2035]/40">No one has booked in yet.</p>
            ) : (
              <ul className="space-y-1">
                {signins.map(s => (
                  <li key={s.id} className="text-xs text-[#2A2035] bg-[#F7F9FF] rounded-lg px-2.5 py-1.5">
                    <span className="font-semibold">{s.students?.full_name || 'Student'}</span>
                    {s.subject ? <span className="text-[#325099]/70"> · {s.subject}</span> : null}
                    {s.question ? <span className="block text-[#2A2035]/60 mt-0.5">{s.question}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The shift */}
          <div className="border-t border-[#EEF2FF] pt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#325099]/60 mb-2">My shift</p>
            {!rostered ? (
              <p className="text-xs text-[#2A2035]/60">
                You are not rostered on this drop-in, so there is no shift for you to save.
              </p>
            ) : settled ? (
              <p className="text-xs text-[#2A2035]/70">
                {fmt12(shift.start_time)} – {fmt12(shift.end_time)} · {Number(shift.hours).toFixed(2)} h.
                This shift has already been {STATUS_BADGE[shift.status]?.label.toLowerCase()}, so it can no longer be changed here.
              </p>
            ) : (
              <>
                <div className="flex items-end gap-3 flex-wrap">
                  <label className="text-[11px] font-semibold text-[#325099]">
                    Start
                    <input type="time" value={start} onChange={e => { setStart(e.target.value); setSaved(false) }}
                      className="block mt-1 text-sm border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-[#2A2035]" />
                  </label>
                  <label className="text-[11px] font-semibold text-[#325099]">
                    Finish
                    <input type="time" value={end} onChange={e => { setEnd(e.target.value); setSaved(false) }}
                      className="block mt-1 text-sm border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-[#2A2035]" />
                  </label>
                  <p className="text-xs text-[#2A2035]/60 pb-2">
                    {hours ? `${hours.toFixed(2)} h` : 'Finish must be after start'}
                    {shift?.rate_snapshot ? ` · $${Number(shift.rate_snapshot).toFixed(2)}/h` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button onClick={save} disabled={saving || !hours}
                    className="text-xs font-bold text-white bg-[#062E63] rounded-full px-4 py-2 disabled:opacity-40">
                    {saving ? 'Saving…' : shift ? 'Update shift' : 'Save shift'}
                  </button>
                  {saved && <span className="text-xs font-semibold text-[#166534]">Saved — it will show on your pay page for approval.</span>}
                </div>
                {error && <p className="text-xs text-[#991B1B] mt-2">{error}</p>}
                {!shift && !loading && (
                  <p className="text-[11px] text-[#2A2035]/50 mt-2">No shift has been raised for you on this drop-in yet.</p>
                )}
              </>
            )}
          </div>
        </div>

        {staff?.role === 'admin' && (
          <div className="px-6 py-3 border-t border-[#EEF2FF]">
            <a href="/tutor/dropin" className="text-xs font-semibold text-[#325099] underline">
              Manage this session in Drop-ins →
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

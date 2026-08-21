'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { isRosteredTutor, yearGroupLabel } from '../../../../lib/dropin'

/*
 * One drop-in session — /tutor/dropin/[id]
 *
 * Opened from either calendar the same way a lesson is. Two jobs: show who has
 * booked in and what they want help with, and let the teacher rostered on
 * confirm the hours they actually worked and save their payroll shift.
 *
 * The shift is written through the `save_dropin_shift` RPC — the rate comes
 * from the year-band matrix inside the database, never from here, and the RPC
 * refuses anyone who is not rostered on the session.
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

export default function DropinSessionPage() {
  const router = useRouter()
  const { id } = useParams()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState(null)
  const [signins, setSignins] = useState([])
  const [siblings, setSiblings] = useState([])   // other dates in this session's series
  const [shift, setShift] = useState(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getAuthProfile().then(({ profile: p, role }) => {
      if (!p || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(p); setReady(true)
    })
  }, [router])

  const load = useCallback(async () => {
    if (!ready || !id || !profile) return
    setLoading(true); setError(null)
    const { data: sess } = await supabase.from('dropin_sessions').select('*').eq('id', id).maybeSingle()
    if (!sess) { setError('That drop-in session no longer exists.'); setLoading(false); return }
    setSession(sess)

    const [{ data: si }, { data: sh }] = await Promise.all([
      supabase.from('dropin_signins')
        .select('id, subject, question, status, students(full_name, year)')
        .eq('session_id', sess.id).order('signed_in_at'),
      supabase.from('shifts')
        .select('id, start_time, end_time, hours, rate_snapshot, status')
        .eq('source_table', 'dropin_sessions')
        .eq('source_id', `${sess.id}_${profile.id}`)
        .maybeSingle(),
    ])
    setSignins(si || [])
    setShift(sh || null)

    // The other dates in this series. A drop-in that repeats is a row per date,
    // so a tutor can be on one occurrence and not another — worth saying out
    // loud on the date they are not on, rather than a flat "not rostered".
    if (sess.series_id) {
      const { data: sib } = await supabase.from('dropin_sessions')
        .select('id, session_date, tutors')
        .eq('series_id', sess.series_id).neq('id', sess.id)
        .order('session_date')
      setSiblings(sib || [])
    } else {
      setSiblings([])
    }
    // An existing shift is the source of truth for the hours — the teacher may
    // already have trimmed or extended them.
    setStart(toInput(sh?.start_time || sess.start_time))
    setEnd(toInput(sh?.end_time || sess.end_time))
    setLoading(false)
  }, [ready, id, profile])

  useEffect(() => { load() }, [load])

  const rostered = useMemo(() => isRosteredTutor(session, profile?.full_name), [session, profile])
  // Dates in the same series this person IS on, so "not this one" is obvious.
  const myOtherDates = useMemo(
    () => siblings.filter(x => isRosteredTutor(x, profile?.full_name)),
    [siblings, profile],
  )
  const hours = hoursBetween(start, end)
  const settled = shift && shift.status !== 'draft'
  const badge = STATUS_BADGE[shift?.status] || null

  const save = async () => {
    setSaving(true); setSaveError(null); setSaved(false)
    const { data, error: e } = await supabase.rpc('save_dropin_shift', {
      p_session_id: session.id,
      p_start: start ? `${start}:00` : null,
      p_end: end ? `${end}:00` : null,
    })
    setSaving(false)
    if (e) { setSaveError(e.message); return }
    const row = Array.isArray(data) ? data[0] : data
    if (row) setShift(row)
    setSaved(true)
  }

  if (!ready) return <div className="min-h-screen flex items-center justify-center bg-white"><div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</div></div>

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role === 'admin'} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-4xl mx-auto px-6 md:px-10 py-8">
          <button onClick={() => router.back()} className="text-[#325099] text-sm hover:underline mb-2">← Back</button>
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-1">
            Drop-in{session?.location ? ` · ${session.location}` : ''}
          </p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#2A2035]">{fmtDate(session?.session_date)}</h1>
          <p className="text-sm text-[#2A2035]/60 mt-1">
            {fmt12(session?.start_time)} – {fmt12(session?.end_time)}
            {' · '}{yearGroupLabel(session?.year_groups)}
            {(session?.tutors || []).length > 0 && <> · {session.tutors.join(', ')}</>}
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 md:px-10 py-8">
        {loading ? (
          <p className="text-sm text-[#2A2035]/60">Loading…</p>
        ) : error ? (
          <div className="bg-[#FEE2E2] border border-[#FCA5A5] rounded-xl p-4 text-sm text-[#991B1B]">{error}</div>
        ) : (
          <div className="space-y-6">
            {/* Who booked in */}
            <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#EEF2FF] flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-[#062E63]">Booked in</p>
                <span className="text-[11px] font-semibold text-[#325099]/70 tabular-nums">
                  {signins.length}{session?.max_capacity ? ` / ${session.max_capacity}` : ''}
                </span>
              </div>
              {signins.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[#2A2035]/50">No one has booked in yet.</p>
              ) : (
                <ul className="divide-y divide-[#EEF2FF]">
                  {signins.map(s => (
                    <li key={s.id} className="px-5 py-3">
                      <p className="text-sm font-semibold text-[#2A2035]">
                        {s.students?.full_name || 'Student'}
                        {s.students?.year && <span className="text-[#325099]/60 font-normal"> · Y{s.students.year}</span>}
                        {s.subject && <span className="text-[#325099]/60 font-normal"> · {s.subject}</span>}
                      </p>
                      {s.question && <p className="text-xs text-[#2A2035]/60 mt-1 whitespace-pre-wrap">{s.question}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* The shift */}
            <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#EEF2FF] flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-[#062E63]">My shift</p>
                {badge && (
                  <span className="text-[9px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full"
                    style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
                )}
              </div>
              <div className="px-5 py-4">
                {!rostered ? (
                  <>
                    <p className="text-sm text-[#2A2035]/60">
                      {(session?.tutors || []).length > 0
                        ? <>This session is rostered to <span className="font-semibold text-[#2A2035]/80">{session.tutors.join(' and ')}</span>, so there is no shift here for you to save.</>
                        : 'No one is rostered on this session, so there is no shift here for you to save.'}
                    </p>
                    {myOtherDates.length > 0 && (
                      <p className="text-xs text-[#2A2035]/55 mt-2">
                        You are on this drop-in on{' '}
                        {myOtherDates.map((x, i) => (
                          <span key={x.id}>
                            {i > 0 && (i === myOtherDates.length - 1 ? ' and ' : ', ')}
                            <Link href={`/tutor/dropin/${x.id}`} className="font-semibold text-[#325099] underline">
                              {new Date(`${x.session_date}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                            </Link>
                          </span>
                        ))}.
                      </p>
                    )}
                  </>
                ) : settled ? (
                  <p className="text-sm text-[#2A2035]/70">
                    {fmt12(shift.start_time)} – {fmt12(shift.end_time)} · {Number(shift.hours).toFixed(2)} h.
                    This shift has already been {STATUS_BADGE[shift.status]?.label.toLowerCase()}, so it can no longer be changed here.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-[#2A2035]/55 mb-3">
                      Save the hours you actually worked — adjust them if the session ran short or long.
                    </p>
                    <div className="flex items-end gap-4 flex-wrap">
                      <label className="text-[11px] font-semibold text-[#325099]">
                        Start
                        <input type="time" value={start} onChange={e => { setStart(e.target.value); setSaved(false) }}
                          className="block mt-1 text-sm border border-[#DEE7FF] rounded-lg px-3 py-2 text-[#2A2035]" />
                      </label>
                      <label className="text-[11px] font-semibold text-[#325099]">
                        Finish
                        <input type="time" value={end} onChange={e => { setEnd(e.target.value); setSaved(false) }}
                          className="block mt-1 text-sm border border-[#DEE7FF] rounded-lg px-3 py-2 text-[#2A2035]" />
                      </label>
                      <p className="text-sm text-[#2A2035]/60 pb-2.5">
                        {hours ? `${hours.toFixed(2)} h` : 'Finish must be after start'}
                        {shift?.rate_snapshot ? ` · $${Number(shift.rate_snapshot).toFixed(2)}/h` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 mt-4 flex-wrap">
                      <button onClick={save} disabled={saving || !hours}
                        className="text-xs font-bold text-white bg-[#062E63] hover:bg-[#325099] rounded-full px-5 py-2.5 transition disabled:opacity-40">
                        {saving ? 'Saving…' : shift ? 'Update shift' : 'Save shift'}
                      </button>
                      {saved && <span className="text-xs font-semibold text-[#166534]">Saved — it will show on your pay page for approval.</span>}
                      {!shift && !saved && <span className="text-xs text-[#2A2035]/50">No shift has been raised for you on this drop-in yet.</span>}
                    </div>
                    {saveError && <p className="text-xs text-[#991B1B] mt-3">{saveError}</p>}
                  </>
                )}
              </div>
            </div>

            {profile?.role === 'admin' && (
              <a href="/tutor/dropin" className="inline-block text-xs font-semibold text-[#325099] underline">
                Manage this session in Drop-ins →
              </a>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

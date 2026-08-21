'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { T_TERMS } from '../../../lib/tables'
import { YEAR_GROUPS, REPEAT_OPTIONS, yearGroupLabel, seriesDates, termContaining,
         buildSeriesRows } from '../../../lib/dropin'

// ── Constants ─────────────────────────────────────────────────────────────────
const SUBJECTS = ['Maths', 'English', 'Chemistry']
const INP = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

// ── Session Modal (create + edit) ─────────────────────────────────────────────
function SessionModal({ session, onClose, onSaved }) {
  const isEdit = !!session
  // Only one centre, so location is no longer asked for — it is stamped on
  // every session instead, which keeps the session cards and the payroll shift
  // note ("Auto: drop-in @ …") reading exactly as they do now.
  const CENTRE = 'Chatswood centre'
  const blank = {
    session_date: '', start_time: '', end_time: '',
    subjects: [], tutors: [],
    max_capacity: 5, notes: '', year_groups: [], repeat: 'none',
  }
  const [form, setForm] = useState(isEdit ? {
    session_date: session.session_date ?? '',
    start_time:   session.start_time?.slice(0, 5) ?? '',
    end_time:     session.end_time?.slice(0, 5) ?? '',
    subjects:     session.subjects ?? [],
    tutors:       session.tutors ?? [],
    max_capacity: session.max_capacity ?? 5,
    notes:        session.notes ?? '',
    year_groups:  session.year_groups ?? [],
    repeat:       'none',      // editing changes one occurrence, never re-runs a series
  } : blank)
  const [tutorsList, setTutorsList] = useState([])
  const [terms, setTerms]           = useState([])
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState('')
  // Editing a session that belongs to a series: apply to this one, or to it and
  // every later date in the series.
  const [scope, setScope] = useState('one')

  useEffect(() => {
    Promise.all([
      supabase.from('tutors').select('id, full_name').eq('active', true).order('full_name'),
      supabase.from('directors').select('id, full_name').order('full_name'),
    ]).then(([{ data: tutors }, { data: directors }]) => {
      const all = [...(tutors || []), ...(directors || [])]
      all.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
      setTutorsList(all)
    })
    supabase.from(T_TERMS).select('*').then(({ data }) => setTerms(data || []))
  }, [])

  const toggleSubject = s => setForm(f => ({
    ...f, subjects: f.subjects.includes(s) ? f.subjects.filter(x => x !== s) : [...f.subjects, s],
  }))
  const toggleTutor = name => setForm(f => ({
    ...f, tutors: f.tutors.includes(name) ? f.tutors.filter(x => x !== name) : [...f.tutors, name],
  }))
  const toggleYear = y => setForm(f => ({
    ...f, year_groups: f.year_groups.includes(y)
      ? f.year_groups.filter(x => x !== y) : [...f.year_groups, y],
  }))

  // A repeat runs to the end of the term the start date sits in. Outside term
  // dates there is no end to stop at, which the form says rather than silently
  // creating a single session.
  const term  = termContaining(terms, form.session_date)
  const dates = seriesDates(form.session_date, form.repeat, term?.end_date)
  const repeating = form.repeat !== 'none'

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!form.session_date || !form.start_time || !form.end_time) {
      setErr('Date and times are required.'); return
    }
    if (repeating && !term) {
      setErr('That date is outside term dates, so a repeat has no term end to stop at. Pick a date inside a term, or set it to not repeat.')
      return
    }
    setSaving(true); setErr('')
    // Details shared by every occurrence. The date is set per row below.
    const details = {
      start_time:   form.start_time,
      end_time:     form.end_time,
      location:     CENTRE,
      subjects:     form.subjects,
      tutors:       form.tutors,
      max_capacity: Number(form.max_capacity) || 5,
      notes:        form.notes || null,
      year_groups:  form.year_groups.length ? form.year_groups : null,
    }

    let error = null
    if (isEdit) {
      // "This and all later" rewrites the shared details across the rest of the
      // series but leaves each occurrence's own date alone — moving them all to
      // one date would collapse the series onto itself.
      if (scope === 'future' && session.series_id) {
        ;({ error } = await supabase.from('dropin_sessions')
          .update(details)
          .eq('series_id', session.series_id)
          .gte('session_date', session.session_date))
        if (!error && form.session_date !== session.session_date) {
          ;({ error } = await supabase.from('dropin_sessions')
            .update({ session_date: form.session_date }).eq('id', session.id))
        }
      } else {
        ;({ error } = await supabase.from('dropin_sessions')
          .update({ ...details, session_date: form.session_date }).eq('id', session.id))
      }
    } else {
      // A repeat is expanded into one row per date: bookings and capacity
      // attach to a concrete session, so there is nothing for a stored rule to
      // hang off. They share a series_id so they can be managed together.
      const rows = buildSeriesRows(details, dates, crypto.randomUUID())
      ;({ error } = await supabase.from('dropin_sessions').insert(rows))
    }
    if (error) { setErr(error.message); setSaving(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <h2 className="text-sm font-bold text-[#062E63]">{isEdit ? 'Edit Session' : 'New Drop-in Session'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3">
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Date</label>
              <input type="date" value={form.session_date}
                onChange={e => setForm(f => ({ ...f, session_date: e.target.value }))} required className={INP} />
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Start</label>
              <input type="time" value={form.start_time}
                onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} required className={INP} />
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">End</label>
              <input type="time" value={form.end_time}
                onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} required className={INP} />
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Capacity</label>
              <input type="number" min={1} max={50} value={form.max_capacity}
                onChange={e => setForm(f => ({ ...f, max_capacity: e.target.value }))} className={INP} />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">
              Year groups
              <span className="ml-2 font-normal normal-case tracking-normal text-[#2A2035]/40">
                {form.year_groups.length === 0
                  ? 'none ticked — open to every year'
                  : yearGroupLabel(form.year_groups)}
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {YEAR_GROUPS.map(y => (
                <button key={y} type="button" onClick={() => toggleYear(y)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                    form.year_groups.includes(y)
                      ? 'bg-[#325099] text-white border-[#325099]'
                      : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
                  }`}>{y}</button>
              ))}
            </div>
            <p className="text-[10px] text-[#2A2035]/40 mt-1.5">
              Only students in a ticked year see this session in their portal. Tick none to show it to everyone.
            </p>
          </div>

          {!isEdit && (
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">Repeat</label>
              <div className="flex flex-wrap gap-2">
                {REPEAT_OPTIONS.map(o => (
                  <button key={o.value} type="button"
                    onClick={() => setForm(f => ({ ...f, repeat: o.value }))}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                      form.repeat === o.value
                        ? 'bg-[#325099] text-white border-[#325099]'
                        : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
                    }`}>{o.label}</button>
                ))}
              </div>
              {repeating && (
                <p className="text-[10px] mt-1.5 text-[#2A2035]/55">
                  {!form.session_date
                    ? 'Pick a start date to see the dates this will create.'
                    : !term
                      ? <span className="text-[#B45309] font-semibold">That date is outside term dates — a repeat has no term end to stop at.</span>
                      : <>Creates <strong>{dates.length}</strong> session{dates.length === 1 ? '' : 's'}, every{' '}
                        {form.repeat === 'fortnightly' ? 'second ' : ' '}
                        {new Date(`${form.session_date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long' })}
                        {' '}until term ends on {new Date(`${term.end_date}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}.</>}
                </p>
              )}
            </div>
          )}

          {isEdit && session.series_id && (
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">Apply changes to</label>
              <div className="flex flex-wrap gap-2">
                {[['one', 'Just this session'], ['future', 'This and all later']].map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setScope(v)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                      scope === v
                        ? 'bg-[#325099] text-white border-[#325099]'
                        : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
                    }`}>{label}</button>
                ))}
              </div>
              {scope === 'future' && (
                <p className="text-[10px] text-[#2A2035]/40 mt-1.5">
                  Details are applied to every later date in this series. Each keeps its own date.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">Subjects available</label>
            <div className="flex flex-wrap gap-2">
              {SUBJECTS.map(s => (
                <button key={s} type="button" onClick={() => toggleSubject(s)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                    form.subjects.includes(s)
                      ? 'bg-[#325099] text-white border-[#325099]'
                      : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
                  }`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">Tutors</label>
            {tutorsList.length === 0 ? (
              <p className="text-[10px] text-[#2A2035]/40 italic">Loading tutors…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tutorsList.map(t => (
                  <button key={t.id} type="button" onClick={() => toggleTutor(t.full_name)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                      form.tutors.includes(t.full_name)
                        ? 'bg-[#325099] text-white border-[#325099]'
                        : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
                    }`}>{t.full_name}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2} placeholder="Optional notes…" className={INP + ' resize-none'} />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </form>
        <div className="px-6 py-4 border-t border-[#F0F4FF] flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 text-xs font-semibold bg-[#325099] text-white rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Session'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Signin Modal ───────────────────────────────────────────────────────────
function AddSigninModal({ sessionId, existingSignins, allStudents, onClose, onAdded }) {
  const [studentId, setStudentId] = useState('')
  const [subject, setSubject]     = useState('')
  const [question, setQuestion]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState('')

  const bookedIds = new Set(existingSignins.map(s => s.student_id))
  const available = allStudents.filter(s => !bookedIds.has(s.id))

  const handleSubmit = async () => {
    if (!studentId || !subject) { setErr('Select a student and subject.'); return }
    setSaving(true); setErr('')
    const { error } = await supabase.from('dropin_signins').insert({
      session_id: sessionId, student_id: studentId,
      subject, question: question.trim() || null, status: 'booked',
    })
    if (error) { setErr(error.message); setSaving(false); return }
    onAdded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <h2 className="text-sm font-bold text-[#062E63]">Add Student to Session</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Student</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)} className={INP}>
              <option value="">Select student…</option>
              {available.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Subject</label>
            <select value={subject} onChange={e => setSubject(e.target.value)} className={INP}>
              <option value="">Select subject…</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">
              Question / topic <span className="font-normal text-[#2A2035]/40">(optional)</span>
            </label>
            <input type="text" value={question} onChange={e => setQuestion(e.target.value)}
              placeholder="e.g. Quadratic equations" className={INP} />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-6 pb-5 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 text-xs font-semibold bg-[#325099] text-white rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Adding…' : 'Add Student'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DropinPage() {
  const router = useRouter()
  const [staff, setStaff]                     = useState(null)
  const [sessions, setSessions]               = useState([])
  const [allStudents, setAllStudents]         = useState([])
  const [loading, setLoading]                 = useState(true)
  const [showAddSession, setShowAddSession]   = useState(false)
  const [editingSession, setEditingSession]   = useState(null)
  const [deleteSessionId, setDeleteSessionId] = useState(null)
  const [addSigninFor, setAddSigninFor]       = useState(null)

  useEffect(() => {
    getAuthProfile().then(({ user, profile }) => {
      if (!user) { router.push('/'); return }
      if (!profile || profile.role !== 'admin') { router.push('/tutor'); return }
      setStaff(profile)
    })
  }, [router])

  const loadSessions = useCallback(async () => {
    setLoading(true)
    const [{ data: raw }, { data: signins }, { data: students }] = await Promise.all([
      supabase.from('dropin_sessions').select('*').order('session_date', { ascending: false }).order('start_time'),
      supabase.from('dropin_signins').select('*').order('signed_in_at'),
      supabase.from('students').select('id, full_name').order('full_name'),
    ])
    const signinMap = {}
    for (const s of signins || []) {
      if (!signinMap[s.session_id]) signinMap[s.session_id] = []
      signinMap[s.session_id].push(s)
    }
    setSessions((raw || []).map(s => ({ ...s, signins: signinMap[s.id] || [] })))
    setAllStudents(students || [])
    setLoading(false)
  }, [])

  useEffect(() => { if (staff) loadSessions() }, [staff, loadSessions])

  // Deleting one date, or the rest of a series from this date on. Later dates
  // only — past occurrences of a standing session are a record of what ran.
  const handleDeleteSession = async (id, alsoFuture = false) => {
    const target = sessions.find(x => x.id === id)
    let ids = [id]
    if (alsoFuture && target?.series_id) {
      ids = sessions
        .filter(x => x.series_id === target.series_id && x.session_date >= target.session_date)
        .map(x => x.id)
    }
    await supabase.from('dropin_signins').delete().in('session_id', ids)
    await supabase.from('dropin_sessions').delete().in('id', ids)
    setSessions(s => s.filter(x => !ids.includes(x.id)))
    setDeleteSessionId(null)
  }

  const handleRemoveSignin = async (sessionId, signinId) => {
    await supabase.from('dropin_signins').delete().eq('id', signinId)
    setSessions(s => s.map(x =>
      x.id !== sessionId ? x : { ...x, signins: x.signins.filter(si => si.id !== signinId) }
    ))
  }

  const fmt12 = t => {
    if (!t) return ''
    const [h, m] = t.split(':').map(Number)
    return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`
  }
  const fmtDate = d => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

  const todayIso = new Date().toISOString().slice(0, 10)
  const upcoming = sessions.filter(s => s.session_date >= todayIso)
  const past     = sessions.filter(s => s.session_date <  todayIso)
  const [showPast, setShowPast] = useState(false)

  if (!staff) return null

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      {/* Header */}
      <div className="bg-white border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Drop-in Sessions</h1>
            <p className="text-sm text-[#2A2035]/50 mt-0.5">Create and manage drop-in tutoring sessions</p>
          </div>
          <button onClick={() => setShowAddSession(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#325099] text-white text-sm font-semibold rounded-xl hover:bg-[#062E63] transition">
            <span className="text-base leading-none">+</span> New Session
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase animate-pulse">Loading…</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <p className="text-5xl">📋</p>
            <p className="text-base font-semibold text-[#2A2035]">No drop-in sessions yet</p>
            <button onClick={() => setShowAddSession(true)}
              className="px-5 py-2.5 bg-[#325099] text-white text-sm font-semibold rounded-xl hover:bg-[#062E63] transition">
              Create your first session
            </button>
          </div>
        ) : (
          <>
          {upcoming.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <p className="text-3xl">📋</p>
              <p className="text-sm font-semibold text-[#2A2035]">No upcoming sessions</p>
              <p className="text-xs text-[#2A2035]/40">Create a new session to get started.</p>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
            {upcoming.map(session => {
              const isFull    = session.signins.length >= session.max_capacity
              const spotsLeft = session.max_capacity - session.signins.length
              const capColour = isFull
                ? 'text-[#991B1B] bg-[#FEE2E2]'
                : spotsLeft <= 2 ? 'text-[#92400E] bg-[#FEF3C7]'
                : 'text-[#065F46] bg-[#D1FAE5]'
              return (
                <div key={session.id} className="bg-white rounded-2xl border border-[#E8EDF8] shadow-sm flex flex-col overflow-hidden hover:shadow-md transition-shadow">
                  {/* Header */}
                  <div className="px-5 pt-5 pb-4 border-b border-[#F0F4FF]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#062E63]">{fmtDate(session.session_date)}</p>
                        <p className="text-xs text-[#2A2035]/60 mt-0.5">
                          {fmt12(session.start_time)} – {fmt12(session.end_time)}
                          {session.location && <> · {session.location}</>}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 ${capColour}`}>
                        {session.signins.length}/{session.max_capacity}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(session.subjects || []).map(s => (
                        <span key={s} className="text-[10px] font-semibold bg-[#EEF4FF] text-[#325099] px-2 py-0.5 rounded-full border border-[#DEE7FF]">{s}</span>
                      ))}
                      {(session.year_groups || []).length > 0 && (
                        <span className="text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 rounded-full border border-[#FDE68A]">
                          {yearGroupLabel(session.year_groups)}
                        </span>
                      )}
                      {session.series_id && (
                        <span className="text-[10px] font-semibold bg-[#F0F4FF] text-[#325099]/70 px-2 py-0.5 rounded-full border border-[#DEE7FF]" title="Part of a repeating series">
                          ↻ repeats
                        </span>
                      )}
                    </div>
                    {(session.tutors || []).length > 0 && (
                      <p className="mt-2 text-[10px] text-[#2A2035]/50">
                        <span className="font-semibold uppercase tracking-wider mr-1">Tutors:</span>
                        {session.tutors.join(', ')}
                      </p>
                    )}
                    {session.notes && (
                      <p className="mt-1.5 text-[10px] text-[#2A2035]/40 italic">{session.notes}</p>
                    )}
                    <div className="mt-3 flex gap-3">
                      <button onClick={() => setEditingSession(session)}
                        className="text-[10px] font-semibold text-[#325099] hover:underline">Edit</button>
                      <span className="text-[#2A2035]/20">·</span>
                      <button onClick={() => setDeleteSessionId(session.id)}
                        className="text-[10px] font-semibold text-red-400 hover:underline">Delete</button>
                    </div>
                  </div>

                  {/* Signins */}
                  <div className="px-5 py-3 flex flex-col gap-1.5 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#325099]/60 mb-1">
                      Attendees {session.signins.length > 0 ? `(${session.signins.length})` : ''}
                    </p>
                    {session.signins.length === 0 && (
                      <p className="text-[10px] text-[#2A2035]/30 italic pl-1">No students booked in yet</p>
                    )}
                    {session.signins.map(si => {
                      const stu = allStudents.find(s => s.id === si.student_id)
                      const statusColour = si.status === 'attended'
                        ? 'text-[#065F46] bg-[#D1FAE5] border-[#6EE7B7]'
                        : si.status === 'absent'
                        ? 'text-[#991B1B] bg-[#FEE2E2] border-[#FCA5A5]'
                        : 'text-[#1e40af] bg-[#EEF4FF] border-[#BFDBFE]'
                      return (
                        <div key={si.id} className="flex items-start gap-2 px-2.5 py-2 rounded-xl bg-[#FAFBFF] border border-[#F0F4FF]">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-[#062E63] truncate">{stu?.full_name ?? '—'}</span>
                              <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusColour}`}>{si.status}</span>
                              <span className="text-[10px] text-[#325099]/60 font-medium">{si.subject}</span>
                            </div>
                            {si.question && <p className="text-[10px] text-[#2A2035]/40 mt-0.5 truncate">{si.question}</p>}
                          </div>
                          <button onClick={() => handleRemoveSignin(session.id, si.id)}
                            className="text-[#2A2035]/25 hover:text-red-400 transition text-sm leading-none shrink-0 pt-0.5">×</button>
                        </div>
                      )
                    })}
                  </div>

                  {/* Add student footer */}
                  <div className="px-5 pb-5 pt-2">
                    <button onClick={() => setAddSigninFor(session.id)} disabled={isFull}
                      className="w-full py-2 rounded-xl border border-dashed border-[#DEE7FF] text-[11px] font-semibold text-[#325099]/60 hover:border-[#325099] hover:text-[#325099] hover:bg-[#F8FAFF] transition disabled:opacity-30 disabled:cursor-not-allowed">
                      {isFull ? 'Session full' : '+ Add student'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Previous sessions */}
          {past.length > 0 && (
            <div className="mt-10">
              <button
                onClick={() => setShowPast(p => !p)}
                className="flex items-center gap-2 text-sm font-semibold text-[#325099]/60 hover:text-[#325099] transition mb-4"
              >
                <span className={`transition-transform duration-200 ${showPast ? 'rotate-90' : ''}`}>▶</span>
                Previous Sessions ({past.length})
              </button>
              {showPast && (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5 opacity-70">
                  {past.map(session => {
                    const isFull    = session.signins.length >= session.max_capacity
                    const spotsLeft = session.max_capacity - session.signins.length
                    const capColour = isFull
                      ? 'text-[#991B1B] bg-[#FEE2E2]'
                      : spotsLeft <= 2 ? 'text-[#92400E] bg-[#FEF3C7]'
                      : 'text-[#065F46] bg-[#D1FAE5]'
                    return (
                      <div key={session.id} className="bg-white rounded-2xl border border-[#E8EDF8] shadow-sm flex flex-col overflow-hidden">
                        <div className="px-5 pt-5 pb-4 border-b border-[#F0F4FF]">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-[#062E63]">{fmtDate(session.session_date)}</p>
                              <p className="text-xs text-[#2A2035]/60 mt-0.5">
                                {fmt12(session.start_time)} – {fmt12(session.end_time)}
                                {session.location && <> · {session.location}</>}
                              </p>
                            </div>
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 ${capColour}`}>
                              {session.signins.length}/{session.max_capacity}
                            </span>
                          </div>
                          {(session.subjects || []).length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {session.subjects.map(s => (
                                <span key={s} className="text-[10px] font-semibold bg-[#EEF4FF] text-[#325099] px-2 py-0.5 rounded-full border border-[#DEE7FF]">{s}</span>
                              ))}
                            </div>
                          )}
                          {(session.tutors || []).length > 0 && (
                            <p className="mt-2 text-[10px] text-[#2A2035]/50">
                              <span className="font-semibold uppercase tracking-wider mr-1">Tutors:</span>
                              {session.tutors.join(', ')}
                            </p>
                          )}
                          <div className="mt-3 flex gap-3">
                            <button onClick={() => setEditingSession(session)} className="text-[10px] font-semibold text-[#325099] hover:underline">Edit</button>
                            <span className="text-[#2A2035]/20">·</span>
                            <button onClick={() => setDeleteSessionId(session.id)} className="text-[10px] font-semibold text-red-400 hover:underline">Delete</button>
                          </div>
                        </div>
                        <div className="px-5 py-3 flex flex-col gap-1.5 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#325099]/60 mb-1">
                            Attendees {session.signins.length > 0 ? `(${session.signins.length})` : ''}
                          </p>
                          {session.signins.length === 0 && (
                            <p className="text-[10px] text-[#2A2035]/30 italic pl-1">No students attended</p>
                          )}
                          {session.signins.map(si => {
                            const stu = allStudents.find(s => s.id === si.student_id)
                            const statusColour = si.status === 'attended'
                              ? 'text-[#065F46] bg-[#D1FAE5] border-[#6EE7B7]'
                              : si.status === 'absent'
                              ? 'text-[#991B1B] bg-[#FEE2E2] border-[#FCA5A5]'
                              : 'text-[#1e40af] bg-[#EEF4FF] border-[#BFDBFE]'
                            return (
                              <div key={si.id} className="flex items-start gap-2 px-2.5 py-2 rounded-xl bg-[#FAFBFF] border border-[#F0F4FF]">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-[#062E63] truncate">{stu?.full_name ?? '—'}</span>
                                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusColour}`}>{si.status}</span>
                                    <span className="text-[10px] text-[#325099]/60 font-medium">{si.subject}</span>
                                  </div>
                                  {si.question && <p className="text-[10px] text-[#2A2035]/40 mt-0.5 truncate">{si.question}</p>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          </>
        )}
      </div>

      {/* Modals */}
      {(showAddSession || editingSession) && (
        <SessionModal
          session={editingSession}
          onClose={() => { setShowAddSession(false); setEditingSession(null) }}
          onSaved={() => { setShowAddSession(false); setEditingSession(null); loadSessions() }}
        />
      )}
      {addSigninFor && (
        <AddSigninModal
          sessionId={addSigninFor}
          existingSignins={sessions.find(s => s.id === addSigninFor)?.signins ?? []}
          allStudents={allStudents}
          onClose={() => setAddSigninFor(null)}
          onAdded={() => { setAddSigninFor(null); loadSessions() }}
        />
      )}
      {deleteSessionId && (() => {
        const target = sessions.find(x => x.id === deleteSessionId)
        // The rest of the series from this date on — past dates are left alone.
        const later = target?.series_id
          ? sessions.filter(x => x.series_id === target.series_id && x.session_date >= target.session_date)
          : []
        const bookedHere  = target?.signins?.length || 0
        const bookedLater = later.reduce((n, x) => n + (x.signins?.length || 0), 0)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-96 border border-[#DEE7FF]">
              <div className="px-6 py-5">
                <p className="text-sm font-bold text-[#062E63] mb-2">Delete this session?</p>
                <p className="text-xs text-[#2A2035]/60 leading-relaxed">
                  This will also remove all student sign-ins. This cannot be undone.
                </p>
                {bookedHere > 0 && (
                  <p className="mt-2 text-xs font-semibold text-[#B45309]">
                    {bookedHere} student{bookedHere === 1 ? ' has' : 's have'} booked this session.
                  </p>
                )}
                {later.length > 1 && (
                  <p className="mt-2 text-[11px] text-[#2A2035]/55 leading-relaxed">
                    This is part of a repeating series — {later.length} session{later.length === 1 ? '' : 's'} from
                    this date onwards{bookedLater > 0 ? `, with ${bookedLater} booking${bookedLater === 1 ? '' : 's'} between them` : ''}.
                  </p>
                )}
              </div>
              <div className="px-6 pb-5 flex flex-wrap gap-2 justify-end">
                <button onClick={() => setDeleteSessionId(null)}
                  className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
                {later.length > 1 && (
                  <button onClick={() => handleDeleteSession(deleteSessionId, true)}
                    className="px-4 py-2 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition">
                    Delete all {later.length}
                  </button>
                )}
                <button onClick={() => handleDeleteSession(deleteSessionId, false)}
                  className="px-4 py-2 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 transition">
                  {later.length > 1 ? 'Just this one' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

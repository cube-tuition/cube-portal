'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import TutorNav from '../../../components/TutorNav'

// ── Status pipeline ───────────────────────────────────────────────────────────
const STAGES = [
  { id: 'new',             label: 'New',             color: 'bg-amber-100 text-amber-800 border-amber-200',   dot: 'bg-amber-400' },
  { id: 'contacted',       label: 'Contacted',        color: 'bg-blue-100 text-blue-800 border-blue-200',      dot: 'bg-blue-400'  },
  { id: 'trial_scheduled', label: 'Trial Scheduled',  color: 'bg-purple-100 text-purple-800 border-purple-200', dot: 'bg-purple-400' },
  { id: 'trial_completed', label: 'Trial Completed',  color: 'bg-indigo-100 text-indigo-800 border-indigo-200', dot: 'bg-indigo-400' },
  { id: 'enrolled',        label: 'Enrolled',         color: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-400' },
  { id: 'declined',        label: 'Declined',         color: 'bg-gray-100 text-gray-500 border-gray-200',      dot: 'bg-gray-300'  },
]

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.id, s]))

function daysSince(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ submissions }) {
  const total     = submissions.length
  const newCount  = submissions.filter(s => s.status === 'new').length
  const thisWeek  = submissions.filter(s => daysSince(s.submitted_at) <= 7).length
  const enrolled  = submissions.filter(s => s.status === 'enrolled').length
  const rate      = total > 0 ? Math.round((enrolled / total) * 100) : 0
  const stale     = submissions.filter(s =>
    ['new','contacted'].includes(s.status) && daysSince(s.submitted_at) > 7
  ).length

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      {[
        { label: 'Total submissions', value: total,          color: 'text-[#062E63]' },
        { label: 'New (unactioned)',   value: newCount,       color: newCount > 0 ? 'text-amber-600' : 'text-[#062E63]' },
        { label: 'This week',          value: thisWeek,       color: 'text-[#062E63]' },
        { label: 'Enrolled',           value: enrolled,       color: 'text-emerald-600' },
        { label: 'Conversion rate',    value: rate + '%',     color: rate >= 50 ? 'text-emerald-600' : 'text-[#062E63]' },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-white border border-[#DEE7FF] rounded-xl px-4 py-3">
          <p className="text-[11px] text-[#325099]/50 mb-0.5">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
      ))}
      {stale > 0 && (
        <div className="col-span-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-center gap-2">
          <span className="text-amber-600 text-sm font-semibold">⚠ {stale} submission{stale > 1 ? 's' : ''} unactioned for 7+ days</span>
        </div>
      )}
    </div>
  )
}

// ── Trial card ────────────────────────────────────────────────────────────────
function TrialCard({ sub, classes, onUpdate, onConvert }) {
  const [expanded,  setExpanded]  = useState(false)
  const [editNotes, setEditNotes] = useState(false)
  const [notes,     setNotes]     = useState(sub.admin_notes || '')
  const [saving,    setSaving]    = useState(false)
  const stage = STAGE_MAP[sub.status] || STAGE_MAP.new
  const age   = daysSince(sub.submitted_at)
  const stale = ['new','contacted'].includes(sub.status) && age > 7

  const subjects = Array.isArray(sub.subjects) ? sub.subjects.join(', ') : (sub.subjects || '—')

  const nextStage = {
    new:             'contacted',
    contacted:       'trial_scheduled',
    trial_scheduled: 'trial_completed',
    trial_completed: 'enrolled',
  }[sub.status]

  const saveNotes = async () => {
    setSaving(true)
    await supabase.from('trial_submissions').update({ admin_notes: notes }).eq('id', sub.id)
    setSaving(false)
    setEditNotes(false)
    onUpdate(sub.id, { admin_notes: notes })
  }

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition ${stale ? 'border-amber-300 shadow-amber-100 shadow-sm' : 'border-[#DEE7FF]'}`}>
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-[#062E63]">{sub.student_name || 'Unknown student'}</span>
            <span className="text-[11px] bg-[#F0F4FF] text-[#325099] px-2 py-0.5 rounded-full font-medium">
              Year {sub.student_year || '?'}
            </span>
            {subjects !== '—' && (
              <span className="text-[11px] text-[#325099]/60">{subjects}</span>
            )}
            {stale && <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Stale {age}d</span>}
          </div>
          <p className="text-[11px] text-[#325099]/50 mt-0.5">
            {sub.parent_name && <span className="mr-2">{sub.parent_name}</span>}
            {sub.parent_email && <a href={'mailto:' + sub.parent_email} className="mr-2 hover:underline text-blue-600">{sub.parent_email}</a>}
            {sub.parent_phone && <a href={'tel:' + sub.parent_phone} className="hover:underline">{sub.parent_phone}</a>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-full ${stage.color}`}>{stage.label}</span>
          <button onClick={() => setExpanded(e => !e)} className="text-[#325099]/40 hover:text-[#325099] text-sm">
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[#DEE7FF] px-4 py-3 space-y-3 bg-[#F8FAFF]">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-xs text-[#325099]/70">
            <div><span className="font-semibold">School:</span> {sub.school || '—'}</div>
            <div><span className="font-semibold">Day pref:</span> {sub.day_preference || '—'}</div>
            <div><span className="font-semibold">Time pref:</span> {sub.time_preference || '—'}</div>
            <div><span className="font-semibold">Submitted:</span> {fmtDate(sub.submitted_at)} ({age}d ago)</div>
            <div><span className="font-semibold">Trial date:</span> {fmtDate(sub.trial_date)}</div>
            <div><span className="font-semibold">Source:</span> {sub.source || '—'}</div>
            {sub.how_heard && <div className="col-span-full"><span className="font-semibold">How heard:</span> {sub.how_heard}</div>}
          </div>

          {/* Admin notes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider">Admin notes</span>
              {!editNotes && (
                <button onClick={() => setEditNotes(true)} className="text-[11px] text-[#325099] hover:underline">Edit</button>
              )}
            </div>
            {editNotes ? (
              <div className="flex gap-2">
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="flex-1 text-xs border border-[#DEE7FF] rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:border-[#325099]"
                />
                <div className="flex flex-col gap-1">
                  <button onClick={saveNotes} disabled={saving}
                    className="text-[11px] font-semibold bg-[#062E63] text-white px-3 py-1 rounded-lg disabled:opacity-40">
                    {saving ? '…' : 'Save'}
                  </button>
                  <button onClick={() => { setEditNotes(false); setNotes(sub.admin_notes || '') }}
                    className="text-[11px] text-[#325099]/50 hover:text-[#325099] px-3 py-1">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[#325099]/60 italic">{notes || 'No notes yet'}</p>
            )}
          </div>

          {/* Trial class assignment */}
          {sub.status === 'trial_scheduled' && (
            <div>
              <label className="text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider block mb-1">Assign trial class</label>
              <select
                value={sub.trial_class_id || ''}
                onChange={async e => {
                  const val = e.target.value ? Number(e.target.value) : null

                  // Remove any existing trial enrolment for this submission
                  if (sub.converted_student_id) {
                    await supabase.from('enrolments')
                      .delete()
                      .eq('student_id', sub.converted_student_id)
                      .eq('status', 'trial')
                  }

                  if (val) {
                    // Find or create student record
                    let studentId = sub.converted_student_id
                    if (!studentId) {
                      const { data: existing } = await supabase
                        .from('students').select('id')
                        .ilike('full_name', sub.student_name || '')
                        .maybeSingle()
                      if (existing) {
                        studentId = existing.id
                      } else {
                        const { data: newStudent } = await supabase
                          .from('students')
                          .insert({ full_name: sub.student_name || 'Unknown', year: sub.student_year || null, school: sub.school || null, status: 'trial' })
                          .select('id').single()
                        studentId = newStudent.id
                        if (sub.parent_name || sub.parent_email || sub.parent_phone) {
                          await supabase.from('guardians').insert({
                            student_id: studentId,
                            full_name: sub.parent_name || null,
                            email: sub.parent_email || null,
                            phone: sub.parent_phone || null,
                          })
                        }
                      }
                    }

                    // Create trial enrolment — makes student appear on lesson interface
                    await supabase.from('enrolments').insert({
                      student_id: studentId,
                      class_id: val,
                      status: 'trial',
                      trial_start_date: new Date().toISOString().split('T')[0],
                      next_term_status: 'continue',
                    })

                    await supabase.from('trial_submissions').update({
                      trial_class_id: val,
                      converted_student_id: studentId,
                    }).eq('id', sub.id)

                    onUpdate(sub.id, { trial_class_id: val, converted_student_id: studentId })
                  } else {
                    await supabase.from('trial_submissions').update({ trial_class_id: null }).eq('id', sub.id)
                    onUpdate(sub.id, { trial_class_id: null })
                  }
                }}
                className="w-full text-xs border border-[#DEE7FF] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[#325099]"
              >
                <option value="">— select class —</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.class_name} ({c.day_of_week})</option>
                ))}
              </select>
            </div>
          )}

          {/* Status actions */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <select
              value={sub.status}
              onChange={async e => {
                const newStatus = e.target.value
                const extra = newStatus === 'contacted' ? { contacted_at: new Date().toISOString() } : {}
                await supabase.from('trial_submissions').update({ status: newStatus, ...extra }).eq('id', sub.id)
                onUpdate(sub.id, { status: newStatus, ...extra })
              }}
              className="text-xs border border-[#DEE7FF] rounded-full px-3 py-1.5 bg-white text-[#062E63] font-semibold focus:outline-none focus:border-[#325099]"
            >
              {STAGES.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            {sub.status === 'trial_completed' && (
              <button
                onClick={() => onConvert(sub)}
                className="text-xs font-semibold bg-emerald-600 text-white px-3 py-1.5 rounded-full hover:bg-emerald-700 transition"
              >
                Convert to student
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Convert modal ─────────────────────────────────────────────────────────────
function ConvertModal({ sub, classes, onClose, onDone }) {
  const [classId,  setClassId]  = useState(sub.trial_class_id ? String(sub.trial_class_id) : '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)

  const handleConvert = async () => {
    if (!classId) { setError('Please select a class.'); return }
    setSaving(true); setError(null)
    try {
      // 1. Create or find student
      let studentId = sub.converted_student_id
      if (!studentId) {
        const { data: existing } = await supabase
          .from('students')
          .select('id')
          .ilike('full_name', sub.student_name || '')
          .maybeSingle()

        if (existing) {
          studentId = existing.id
        } else {
          const { data: newStudent, error: sErr } = await supabase
            .from('students')
            .insert({
              full_name: sub.student_name || 'Unknown',
              year:      sub.student_year || null,
              school:    sub.school       || null,
              status:    'active',
            })
            .select('id').single()
          if (sErr) throw new Error('Student creation failed: ' + sErr.message)
          studentId = newStudent.id

          // Also create guardian record
          if (sub.parent_name || sub.parent_email || sub.parent_phone) {
            await supabase.from('guardians').insert({
              student_id: studentId,
              full_name:  sub.parent_name  || null,
              email:      sub.parent_email || null,
              phone:      sub.parent_phone || null,
            })
          }
        }
      }

      // 2. Upgrade existing trial enrolment → active, or insert fresh if none
      const { data: existingEnrol } = await supabase
        .from('enrolments')
        .select('id')
        .eq('student_id', studentId)
        .eq('class_id', Number(classId))
        .eq('status', 'trial')
        .maybeSingle()

      if (existingEnrol) {
        const { error: eErr } = await supabase
          .from('enrolments')
          .update({ status: 'active' })
          .eq('id', existingEnrol.id)
        if (eErr) throw new Error('Enrolment upgrade failed: ' + eErr.message)
      } else {
        const { error: eErr } = await supabase.from('enrolments').insert({
          student_id: studentId,
          class_id:   Number(classId),
          status:     'active',
          next_term_status: 'continue',
        })
        if (eErr) throw new Error('Enrolment creation failed: ' + eErr.message)
      }

      // 3. Mark trial submission as enrolled
      await supabase.from('trial_submissions').update({
        status:               'enrolled',
        converted_student_id: studentId,
        converted_at:         new Date().toISOString(),
      }).eq('id', sub.id)

      onDone(sub.id, studentId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-[#062E63] text-sm">Convert to Student</h3>
          <button onClick={onClose} className="text-[#325099]/40 hover:text-[#325099]">✕</button>
        </div>

        <div className="space-y-3 mb-5">
          <div className="bg-[#F0F4FF] rounded-xl px-4 py-3 text-sm">
            <p className="font-semibold text-[#062E63]">{sub.student_name || 'Unknown'}</p>
            <p className="text-[#325099]/60 text-xs">Year {sub.student_year || '?'} · {sub.school || '—'}</p>
            <p className="text-[#325099]/60 text-xs mt-1">{sub.parent_email || sub.parent_phone || '—'}</p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">
              Enrol in class
            </label>
            <select value={classId} onChange={e => setClassId(e.target.value)}
              className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] bg-white focus:outline-none focus:border-[#325099]">
              <option value="">— select class —</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>{c.class_name} · {c.day_of_week} {c.start_time}</option>
              ))}
            </select>
          </div>

          <p className="text-[11px] text-[#325099]/50">
            This will create a student record (if one does not exist), a guardian record, and an active enrolment.
          </p>
        </div>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs text-[#325099]/60 border border-[#DEE7FF] px-4 py-2 rounded-full hover:border-[#325099] transition">
            Cancel
          </button>
          <button onClick={handleConvert} disabled={saving}
            className="text-xs font-semibold bg-emerald-600 text-white px-5 py-2 rounded-full hover:bg-emerald-700 transition disabled:opacity-40">
            {saving ? 'Converting…' : 'Convert & Enrol'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Active enrolments view ────────────────────────────────────────────────────
function EnrolmentsView({ enrolments }) {
  const trials  = enrolments.filter(e => e.status === 'trial')
  const active  = enrolments.filter(e => e.status === 'active')

  const EnrolCard = ({ e }) => {
    const trialAge = daysSince(e.trial_start_date)
    const overdue  = e.status === 'trial' && trialAge !== null && trialAge > 14

    return (
      <div className={`bg-white border rounded-xl px-4 py-3 ${overdue ? 'border-amber-300' : 'border-[#DEE7FF]'}`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-sm text-[#062E63]">{e.student_name || '—'}</p>
            <p className="text-[11px] text-[#325099]/50">{e.class_name || '—'}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-full ${
              e.status === 'trial' ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-emerald-100 text-emerald-800 border-emerald-200'
            }`}>{e.status}</span>
            {e.status === 'trial' && trialAge !== null && (
              <p className={`text-[10px] mt-0.5 ${overdue ? 'text-amber-600 font-semibold' : 'text-[#325099]/40'}`}>
                {trialAge}d since trial started{overdue ? ' ⚠' : ''}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {trials.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#062E63] mb-2">
            Trial enrolments <span className="text-[#325099]/40 font-normal">({trials.length})</span>
          </h3>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {trials.map(e => <EnrolCard key={e.id} e={e} />)}
          </div>
        </div>
      )}
      {active.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[#062E63] mb-2">
            Active enrolments <span className="text-[#325099]/40 font-normal">({active.length})</span>
          </h3>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {active.map(e => <EnrolCard key={e.id} e={e} />)}
          </div>
        </div>
      )}
      {trials.length === 0 && active.length === 0 && (
        <p className="text-sm text-[#325099]/40 italic">No enrolments found.</p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TrialsPage() {
  const [profile,     setProfile]     = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [enrolments,  setEnrolments]  = useState([])
  const [classes,     setClasses]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [view,        setView]        = useState('pipeline')  // 'pipeline' | 'enrolments'
  const [filterStage, setFilterStage] = useState('all')
  const [search,      setSearch]      = useState('')
  const [convertSub,  setConvertSub]  = useState(null)
  const [showArchive, setShowArchive] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('directors').select('full_name').eq('user_id', user.id).maybeSingle()
        .then(({ data }) => setProfile(data))
    })
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [subRes, enrolRes, classRes] = await Promise.all([
      supabase
        .from('trial_submissions')
        .select('*')
        .order('submitted_at', { ascending: false }),
      supabase
        .from('enrolments')
        .select('id, status, trial_start_date, student_id, class_id')
        .in('status', ['trial', 'active']),
      supabase
        .from('classes')
        .select('id, class_name, day_of_week, start_time, course_id'),
    ])
    setSubmissions(subRes.data || [])
    setClasses(classRes.data || [])

    // Enrich enrolments with student + class names
    const enrolData = enrolRes.data || []
    const studentIds = [...new Set(enrolData.map(e => e.student_id).filter(Boolean))]
    const classIds   = [...new Set(enrolData.map(e => e.class_id).filter(Boolean))]
    const [studRes, clsRes] = await Promise.all([
      studentIds.length ? supabase.from('students').select('id, full_name').in('id', studentIds) : { data: [] },
      classIds.length   ? supabase.from('classes').select('id, class_name').in('id', classIds)   : { data: [] },
    ])
    const studMap = Object.fromEntries((studRes.data || []).map(s => [s.id, s.full_name]))
    const clsMap  = Object.fromEntries((clsRes.data  || []).map(c => [c.id, c.class_name]))
    setEnrolments(enrolData.map(e => ({
      ...e,
      student_name: studMap[e.student_id] || '—',
      class_name:   clsMap[e.class_id]   || '—',
    })))
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleUpdate = useCallback(async (id, patch, persist = false) => {
    if (persist) {
      const extra = {}
      if (patch.status === 'contacted')       extra.contacted_at = new Date().toISOString()
      await supabase.from('trial_submissions').update({ ...patch, ...extra }).eq('id', id)
    }
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }, [])

  const handleConvertDone = useCallback((id, studentId) => {
    setConvertSub(null)
    setSubmissions(prev => prev.map(s =>
      s.id === id ? { ...s, status: 'enrolled', converted_student_id: studentId } : s
    ))
    loadData()
  }, [loadData])

  // Filter submissions
  const ARCHIVE = ['enrolled', 'declined']
  const visible = submissions.filter(s => {
    if (!showArchive && ARCHIVE.includes(s.status)) return false
    if (filterStage !== 'all' && s.status !== filterStage) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        s.student_name?.toLowerCase().includes(q) ||
        s.parent_name?.toLowerCase().includes(q)  ||
        s.parent_email?.toLowerCase().includes(q) ||
        s.school?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const stagesWithCount = STAGES.map(st => ({
    ...st,
    count: submissions.filter(s => s.status === st.id && !(ARCHIVE.includes(st.id) && !showArchive)).length,
  }))

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      <div className="max-w-6xl mx-auto px-6 pt-10 pb-24">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href="/tutor/database" className="text-sm text-[#325099]/50 hover:text-[#325099] transition">← Database</Link>
            </div>
            <h1 className="text-2xl font-bold text-[#062E63]">Trials</h1>
            <p className="text-sm text-[#325099]/60 mt-1">Manage free trial submissions and active trial enrolments.</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/api/trial-submission"
              target="_blank"
              className="text-xs font-semibold text-[#325099]/60 border border-[#DEE7FF] px-3 py-1.5 rounded-full hover:border-[#325099] transition"
              title="Webhook URL for your website form"
            >
              API endpoint
            </a>
          </div>
        </div>

        {/* View tabs */}
        <div className="flex items-center gap-1 bg-white border border-[#DEE7FF] rounded-xl p-1 mb-5 w-fit">
          {[
            { id: 'pipeline',   label: 'Trial pipeline' },
            { id: 'enrolments', label: 'Enrolment view' },
          ].map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition ${
                view === v.id ? 'bg-[#062E63] text-white' : 'text-[#325099]/60 hover:text-[#325099]'
              }`}>
              {v.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : view === 'pipeline' ? (
          <>
            <StatsBar submissions={submissions} />

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name, email, school…"
                className="border border-[#DEE7FF] rounded-full px-3 py-1.5 text-xs text-[#062E63] bg-white focus:outline-none focus:border-[#325099] w-52"
              />
              <div className="flex items-center gap-1 flex-wrap">
                <button onClick={() => setFilterStage('all')}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition ${filterStage === 'all' ? 'bg-[#062E63] text-white border-[#062E63]' : 'border-[#DEE7FF] text-[#325099]/60 hover:border-[#325099]'}`}>
                  All
                </button>
                {stagesWithCount.filter(s => !ARCHIVE.includes(s.id) || showArchive).map(st => (
                  <button key={st.id} onClick={() => setFilterStage(st.id)}
                    className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition ${filterStage === st.id ? 'bg-[#062E63] text-white border-[#062E63]' : 'border-[#DEE7FF] text-[#325099]/60 hover:border-[#325099]'}`}>
                    {st.label} {st.count > 0 && <span className="opacity-60">({st.count})</span>}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowArchive(a => !a)}
                className="ml-auto text-[11px] text-[#325099]/50 hover:text-[#325099] transition">
                {showArchive ? 'Hide archived' : 'Show enrolled/declined'}
              </button>
            </div>

            {/* Cards */}
            {visible.length === 0 ? (
              <div className="text-center py-16 text-[#325099]/40">
                <p className="text-lg mb-1">No submissions found</p>
                <p className="text-sm">New trial form submissions will appear here automatically.</p>
                <p className="text-xs mt-3 font-mono bg-white border border-[#DEE7FF] rounded-lg px-3 py-2 inline-block text-[#325099]/60">
                  POST {typeof window !== 'undefined' ? window.location.origin : ''}/api/trial-submission
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {visible.map(sub => (
                  <TrialCard
                    key={sub.id}
                    sub={sub}
                    classes={classes}
                    onUpdate={handleUpdate}
                    onConvert={setConvertSub}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <EnrolmentsView enrolments={enrolments} />
        )}
      </div>

      {convertSub && (
        <ConvertModal
          sub={convertSub}
          classes={classes}
          onClose={() => setConvertSub(null)}
          onDone={handleConvertDone}
        />
      )}
    </div>
  )
}

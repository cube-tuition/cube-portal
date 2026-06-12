'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { fmtDate } from '../../../lib/format'
import { registerUndoAction } from '../../../lib/undo'

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
function TrialCard({ sub, classes, onUpdate, onConvertDrop }) {
  const [expanded,     setExpanded]     = useState(false)
  const [editNotes,    setEditNotes]    = useState(false)
  const [notes,        setNotes]        = useState(sub.admin_notes || '')
  const [saving,       setSaving]       = useState(false)
  const [confirmAction, setConfirmAction] = useState(null) // 'convert' | 'drop' | null
  const stage = STAGE_MAP[sub.status] || STAGE_MAP.new
  const age   = daysSince(sub.submitted_at)
  const stale = ['new','contacted'].includes(sub.status) && age > 7

  const subjects = Array.isArray(sub.subjects) ? sub.subjects.join(', ') : (sub.subjects || '—')

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
              Year {sub.student_year ? String(sub.student_year).replace(/^year\s*/i, '') : '?'}
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

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[#DEE7FF]">
            {/* Assign class */}
            <select
              value={sub.trial_class_id || ''}
              onChange={async e => {
                const val = e.target.value ? Number(e.target.value) : null

                let studentId = sub.converted_student_id

                // If no student exists yet (old submission), create one now
                if (!studentId && val) {
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
                    studentId = newStudent?.id
                    if (studentId && (sub.parent_name || sub.parent_email || sub.parent_phone)) {
                      await supabase.from('guardians').insert({
                        student_id: studentId, full_name: sub.parent_name || null,
                        email: sub.parent_email || null, phone: sub.parent_phone || null,
                      })
                    }
                  }
                  // Create the trial enrolment for the first time
                  if (studentId) {
                    const { data: newEnrol } = await supabase.from('enrolments').insert({
                      student_id: studentId, class_id: val, status: 'trial',
                      trial_start_date: new Date().toISOString().split('T')[0],
                      next_term_status: 'confirmed',
                    }).select('id').single()
                    await supabase.from('trial_submissions').update({ trial_class_id: val, converted_student_id: studentId, enrolment_id: newEnrol?.id }).eq('id', sub.id)
                    onUpdate(sub.id, { trial_class_id: val, converted_student_id: studentId, enrolment_id: newEnrol?.id })
                  }
                  return
                }

                // Student already exists — update the specific linked enrolment by enrolment_id
                const prevTrialClassId = sub.trial_class_id ?? null
                let prevEnrol = null
                if (sub.enrolment_id) {
                  const { data } = await supabase.from('enrolments').select('class_id, trial_start_date').eq('id', sub.enrolment_id).maybeSingle()
                  prevEnrol = data
                  await supabase.from('enrolments')
                    .update({ class_id: val, trial_start_date: val ? new Date().toISOString().split('T')[0] : null })
                    .eq('id', sub.enrolment_id)
                } else if (studentId) {
                  // Fallback: update by student_id if no enrolment_id yet
                  await supabase.from('enrolments')
                    .update({ class_id: val, trial_start_date: val ? new Date().toISOString().split('T')[0] : null })
                    .eq('student_id', studentId)
                    .eq('status', 'trial')
                    .is('class_id', null)
                }
                await supabase.from('trial_submissions').update({ trial_class_id: val }).eq('id', sub.id)
                onUpdate(sub.id, { trial_class_id: val })
                registerUndoAction('trial class assignment', async () => {
                  if (sub.enrolment_id && prevEnrol) {
                    await supabase.from('enrolments')
                      .update({ class_id: prevEnrol.class_id, trial_start_date: prevEnrol.trial_start_date })
                      .eq('id', sub.enrolment_id)
                  }
                  await supabase.from('trial_submissions').update({ trial_class_id: prevTrialClassId }).eq('id', sub.id)
                  onUpdate(sub.id, { trial_class_id: prevTrialClassId })
                })
              }}
              className="text-xs border border-[#DEE7FF] rounded-full px-3 py-1.5 bg-white text-[#062E63] focus:outline-none focus:border-[#325099]"
            >
              <option value="">Assign a class…</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>{c.class_name} ({c.day_of_week})</option>
              ))}
            </select>

            {/* Convert / Drop with double confirmation */}
            {sub.status !== 'enrolled' && sub.status !== 'declined' && (
              confirmAction ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#325099]/70">
                    {confirmAction === 'convert' ? 'Convert to active student?' : 'Drop this trial?'}
                  </span>
                  <button
                    onClick={() => { onConvertDrop(sub.id, sub.converted_student_id, confirmAction); setConfirmAction(null) }}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full transition text-white ${confirmAction === 'convert' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600'}`}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="text-xs text-[#325099]/50 hover:text-[#325099] px-2 py-1.5"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setConfirmAction('convert')}
                    className="text-xs font-semibold bg-emerald-600 text-white px-4 py-1.5 rounded-full hover:bg-emerald-700 transition"
                  >
                    Convert
                  </button>
                  <button
                    onClick={() => setConfirmAction('drop')}
                    className="text-xs font-semibold text-gray-500 border border-gray-200 px-4 py-1.5 rounded-full hover:border-gray-400 transition"
                  >
                    Drop
                  </button>
                </>
              )
            )}

            {/* Status badge if already resolved */}
            {(sub.status === 'enrolled' || sub.status === 'declined') && (
              <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${stage.color}`}>
                {stage.label}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TrialsPage() {
  const router = useRouter()
  const [profile,     setProfile]     = useState(null)
  const [isAdmin,     setIsAdmin]     = useState(false)
  const [submissions, setSubmissions] = useState([])
  const [classes,     setClasses]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [filterStage, setFilterStage] = useState('all')
  const [search,      setSearch]      = useState('')
  const [showArchive, setShowArchive] = useState(false)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) {
        router.replace('/tutor')
        return
      }
      setProfile(profile)
      setIsAdmin(true)
    })
  }, [router])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [subRes, classRes] = await Promise.all([
      supabase
        .from('trial_submissions')
        .select('*')
        .order('submitted_at', { ascending: false }),
      supabase
        .from('classes')
        .select('id, class_name, day_of_week, start_time, course_id'),
    ])
    setSubmissions(subRes.data || [])
    setClasses(classRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleUpdate = useCallback((id, patch) => {
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }, [])

  const handleConvertDrop = useCallback(async (id, studentId, action) => {
    if (action === 'convert') {
      if (studentId) {
        await supabase.from('enrolments').update({ status: 'active' }).eq('student_id', studentId).in('status', ['trial', 'trial complete'])
        await supabase.from('students').update({ status: 'active' }).eq('id', studentId)
      }
      await supabase.from('trial_submissions').update({ status: 'enrolled', converted_at: new Date().toISOString() }).eq('id', id)
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'enrolled' } : s))
    } else {
      if (studentId) {
        await supabase.from('enrolments').update({ status: 'disenrol' }).eq('student_id', studentId)
        await supabase.from('students').update({ status: 'quit trial' }).eq('id', studentId)
      }
      await supabase.from('trial_submissions').update({ status: 'declined' }).eq('id', id)
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'declined' } : s))
    }
  }, [])

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

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
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
              </div>
            ) : (
              <div className="space-y-2">
                {visible.map(sub => (
                  <TrialCard
                    key={sub.id}
                    sub={sub}
                    classes={classes}
                    onUpdate={handleUpdate}
                    onConvertDrop={handleConvertDrop}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

    </div>
  )
}

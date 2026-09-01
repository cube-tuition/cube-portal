'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

/* Files on the session — worksheets used, photos of working, anything worth
   keeping with it. Private `dropin-uploads` bucket (staff-only both ways),
   listed straight from storage and opened through short-lived signed URLs —
   the journal-uploads shape.
     session-wide   <session_id>/<timestamp>-<name>
     one student's  <session_id>/students/<student_id>/<timestamp>-<name>
   Keeping a student's work under its own prefix means the session list stays
   what it was, and a student's files travel with the student rather than being
   dumped in one pile the tutor then has to sort through. */
const FILES_BUCKET = 'dropin-uploads'
const FILES_ACCEPT = 'image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt'
const MAX_FILE_MB = 20
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
// Display name: the path is <timestamp>-<original name>.
const displayName = (name) => name.replace(/^\d+-/, '')
// Everything a student's files live under, inside one session.
const STUDENT_DIR = 'students'
const studentPrefix = (sessionId, studentId) => `${sessionId}/${STUDENT_DIR}/${studentId}`

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
  const [files, setFiles] = useState([])           // [{ name, size, created, url }]
  const [uploading, setUploading] = useState(false)
  const [fileErr, setFileErr] = useState('')
  const fileRef = useRef(null)
  const [studentFiles, setStudentFiles] = useState({})   // student_id -> [{name,size,url}]
  const [stuUploading, setStuUploading] = useState(null) // student_id mid-upload
  const [roster, setRoster] = useState([])               // active + trial students
  const [adding, setAdding] = useState(false)            // "add student" row open
  const [addId, setAddId] = useState('')
  const [addSubject, setAddSubject] = useState('')
  const [addErr, setAddErr] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  const loadFiles = useCallback(async () => {
    if (!id) return
    const { data: list, error: e } = await supabase.storage.from(FILES_BUCKET)
      .list(String(id), { sortBy: { column: 'created_at', order: 'asc' } })
    if (e) { setFileErr('Files could not be listed: ' + e.message); return }
    // Folders come back with a null id — the students/ subtree is listed per
    // student below, not here.
    const rows = (list || []).filter(f => f.id && f.name && !f.name.startsWith('.'))
    let urlByName = {}
    if (rows.length) {
      const { data: signed } = await supabase.storage.from(FILES_BUCKET)
        .createSignedUrls(rows.map(f => `${id}/${f.name}`), 3600)
      for (const s of signed || []) if (s.signedUrl && !s.error) urlByName[s.path.split('/').pop()] = s.signedUrl
    }
    setFiles(rows.map(f => ({
      name: f.name,
      size: f.metadata?.size || 0,
      created: f.created_at,
      url: urlByName[f.name] || null,
    })))
  }, [id])

  const uploadFiles = async (picked) => {
    const list = Array.from(picked || []).filter(Boolean)
    if (!list.length) return
    const over = list.filter(f => f.size > MAX_FILE_MB * 1048576)
    if (over.length) { setFileErr(`${over.map(f => f.name).join(', ')} ${over.length === 1 ? 'is' : 'are'} over ${MAX_FILE_MB} MB.`); return }
    setUploading(true); setFileErr('')
    for (const f of list) {
      const safe = f.name.replace(/[^\w.\- ]+/g, '_')
      const { error: e } = await supabase.storage.from(FILES_BUCKET)
        .upload(`${id}/${Date.now()}-${safe}`, f)
      if (e) { setFileErr(`${f.name}: ${e.message}`); break }
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    await loadFiles()
  }

  /* One list + one signed-URL batch per student. A drop-in seats a handful of
     students, so the extra calls are cheaper than flattening the whole tree and
     re-splitting it here. */
  const loadStudentFiles = useCallback(async (ids) => {
    if (!id || !ids?.length) { setStudentFiles({}); return }
    const out = {}
    await Promise.all(ids.map(async (sid) => {
      const { data: list } = await supabase.storage.from(FILES_BUCKET)
        .list(studentPrefix(id, sid), { sortBy: { column: 'created_at', order: 'asc' } })
      const rows = (list || []).filter(f => f.id && f.name && !f.name.startsWith('.'))
      if (!rows.length) { out[sid] = []; return }
      const { data: signed } = await supabase.storage.from(FILES_BUCKET)
        .createSignedUrls(rows.map(f => `${studentPrefix(id, sid)}/${f.name}`), 3600)
      const byName = {}
      for (const u of signed || []) if (u.signedUrl && !u.error) byName[u.path.split('/').pop()] = u.signedUrl
      out[sid] = rows.map(f => ({ name: f.name, size: f.metadata?.size || 0, url: byName[f.name] || null }))
    }))
    setStudentFiles(out)
  }, [id])

  const uploadStudentFiles = async (sid, picked) => {
    const list = Array.from(picked || []).filter(Boolean)
    if (!list.length) return
    const over = list.filter(f => f.size > MAX_FILE_MB * 1048576)
    if (over.length) { setFileErr(`${over.map(f => f.name).join(', ')} ${over.length === 1 ? 'is' : 'are'} over ${MAX_FILE_MB} MB.`); return }
    setStuUploading(sid); setFileErr('')
    for (const f of list) {
      const safe = f.name.replace(/[^\w.\- ]+/g, '_')
      // Runs in an upload handler, not during render — same call as uploadFiles above.
      // eslint-disable-next-line react-hooks/purity
      const path = `${studentPrefix(id, sid)}/${Date.now()}-${safe}`
      const { error: e } = await supabase.storage.from(FILES_BUCKET).upload(path, f)
      if (e) { setFileErr(`${f.name}: ${e.message}`); break }
    }
    setStuUploading(null)
    await loadStudentFiles(signins.map(x => x.student_id).filter(Boolean))
  }

  const removeStudentFile = async (sid, name) => {
    if (!confirm(`Delete "${displayName(name)}"?`)) return
    const { error: e } = await supabase.storage.from(FILES_BUCKET)
      .remove([`${studentPrefix(id, sid)}/${name}`])
    if (e) { setFileErr('Could not delete: ' + e.message); return }
    setStudentFiles(m => ({ ...m, [sid]: (m[sid] || []).filter(f => f.name !== name) }))
  }

  const removeFile = async (name) => {
    if (!confirm(`Delete "${displayName(name)}"?`)) return
    const { error: e } = await supabase.storage.from(FILES_BUCKET).remove([`${id}/${name}`])
    if (e) { setFileErr('Could not delete: ' + e.message); return }
    setFiles(fs => fs.filter(f => f.name !== name))
  }

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
        .select('id, student_id, subject, question, status, students(full_name, year)')
        .eq('session_id', sess.id).order('signed_in_at'),
      supabase.from('shifts')
        .select('id, start_time, end_time, hours, rate_snapshot, status')
        .eq('source_table', 'dropin_sessions')
        .eq('source_id', `${sess.id}_${profile.id}`)
        .maybeSingle(),
    ])
    setSignins(si || [])
    setShift(sh || null)
    loadStudentFiles((si || []).map(x => x.student_id).filter(Boolean))

    // Anyone who could plausibly walk in: currently enrolled or on a trial.
    // Past students are deliberately absent — they are not coming to a drop-in.
    const { data: stu } = await supabase.from('students')
      .select('id, full_name, year, status').in('status', ['active', 'trial']).order('full_name')
    setRoster(stu || [])

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
  }, [ready, id, profile, loadStudentFiles])

  /* Students book themselves in, but plenty just turn up — this is how the
     tutor puts a walk-in on the list so the session record matches the room. */
  const addStudent = async () => {
    if (!addId) { setAddErr('Choose a student.'); return }
    setAddBusy(true); setAddErr('')
    const { error: e } = await supabase.from('dropin_signins').insert({
      session_id: id, student_id: addId,
      subject: addSubject || null, question: null, status: 'booked',
    })
    setAddBusy(false)
    if (e) { setAddErr(e.message); return }
    setAdding(false); setAddId(''); setAddSubject('')
    await load()
  }

  const removeSignin = async (signinId, name) => {
    if (!confirm(`Remove ${name || 'this student'} from the session?`)) return
    const { error: e } = await supabase.from('dropin_signins').delete().eq('id', signinId)
    if (e) { setAddErr(e.message); return }
    await load()
  }

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!ready) return undefined
    const raf = requestAnimationFrame(() => { loadFiles() })
    return () => cancelAnimationFrame(raf)
  }, [ready, loadFiles])

  const rostered = useMemo(() => isRosteredTutor(session, profile?.full_name), [session, profile])
  // The rostered session is the ceiling: a teacher can trim a shift, never
  // extend it past the hours the centre put on. HH:MM sorts lexically.
  const bounds = { start: toInput(session?.start_time), end: toInput(session?.end_time) }
  const tooEarly = !!(start && bounds.start && start < bounds.start)
  const tooLate  = !!(end && bounds.end && end > bounds.end)
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
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold text-[#325099]/70 tabular-nums">
                    {signins.length}{session?.max_capacity ? ` / ${session.max_capacity}` : ''}
                  </span>
                  <button onClick={() => { setAdding(a => !a); setAddErr('') }}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#EEF4FF] text-[#325099] hover:bg-[#DEE7FF] transition">
                    {adding ? 'Cancel' : '+ Add student'}
                  </button>
                </div>
              </div>

              {/* Walk-ins: anyone active or on a trial who never booked in */}
              {adding && (() => {
                const booked = new Set(signins.map(x => x.student_id))
                const available = roster.filter(r => !booked.has(r.id))
                return (
                  <div className="px-5 py-3 bg-[#F8FAFF] border-b border-[#EEF2FF] flex flex-wrap items-end gap-2">
                    <label className="flex-1 min-w-[190px]">
                      <span className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Student</span>
                      <select value={addId} onChange={e => setAddId(e.target.value)}
                        className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-sm text-[#062E63] bg-white focus:outline-none focus:border-[#325099]">
                        <option value="">Select student…</option>
                        {available.map(r => (
                          <option key={r.id} value={r.id}>
                            {r.full_name}{r.year ? ` · Y${r.year}` : ''}{r.status === 'trial' ? ' · trial' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-[140px]">
                      <span className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Subject</span>
                      <select value={addSubject} onChange={e => setAddSubject(e.target.value)}
                        className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-sm text-[#062E63] bg-white focus:outline-none focus:border-[#325099]">
                        <option value="">—</option>
                        {(session?.subjects || []).map(sub => <option key={sub} value={sub}>{sub}</option>)}
                      </select>
                    </label>
                    <button onClick={addStudent} disabled={addBusy || !addId}
                      className="text-[11px] font-bold px-4 py-2 rounded-full bg-[#062E63] text-white hover:bg-[#325099] transition disabled:opacity-40">
                      {addBusy ? 'Adding…' : 'Add'}
                    </button>
                    {available.length === 0 && (
                      <p className="w-full text-[11px] text-[#2A2035]/50">Every active and trial student is already on the list.</p>
                    )}
                    {addErr && <p className="w-full text-[11px] text-[#B23A3A]">{addErr}</p>}
                  </div>
                )
              })()}
              {signins.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[#2A2035]/50">No one has booked in yet.</p>
              ) : (
                <ul className="divide-y divide-[#EEF2FF]">
                  {signins.map(s => {
                    const mine = studentFiles[s.student_id] || []
                    const busy = stuUploading === s.student_id
                    return (
                      <li key={s.id} className="px-5 py-3">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#2A2035]">
                              {s.students?.full_name || 'Student'}
                              {s.students?.year && <span className="text-[#325099]/60 font-normal"> · Y{s.students.year}</span>}
                              {s.subject && <span className="text-[#325099]/60 font-normal"> · {s.subject}</span>}
                            </p>
                            {s.question && <p className="text-xs text-[#2A2035]/60 mt-1 whitespace-pre-wrap">{s.question}</p>}
                          </div>
                          {/* This student's own work, kept against their name */}
                          <label className={`text-[11px] font-bold px-2.5 py-1 rounded-full cursor-pointer shrink-0 transition ${busy ? 'bg-[#EEF0F4] text-[#868D9C]' : 'bg-[#EEF4FF] text-[#325099] hover:bg-[#DEE7FF]'}`}
                            title={`Upload files for ${s.students?.full_name || 'this student'}`}>
                            {busy ? 'Uploading…' : '⬆ File'}
                            <input type="file" multiple accept={FILES_ACCEPT} className="hidden"
                              disabled={busy} onChange={e => uploadStudentFiles(s.student_id, e.target.files)} />
                          </label>
                          <button onClick={() => removeSignin(s.id, s.students?.full_name)}
                            title="Remove this student from the session"
                            className="text-[#2A2035]/25 hover:text-[#B23A3A] text-sm shrink-0 leading-none pt-1">✕</button>
                        </div>
                        {mine.length > 0 && (
                          <ul className="mt-2 pl-3 border-l-2 border-[#EEF2FF] space-y-1">
                            {mine.map(f => (
                              <li key={f.name} className="flex items-center gap-2">
                                <a href={f.url || '#'} target="_blank" rel="noopener noreferrer"
                                  className={`flex-1 min-w-0 text-xs truncate ${f.url ? 'text-[#325099] hover:underline' : 'text-[#2A2035]/50 cursor-default'}`}>
                                  📄 {displayName(f.name)}
                                </a>
                                <span className="text-[10px] text-[#2A2035]/40 tabular-nums shrink-0">{fmtSize(f.size)}</span>
                                <button onClick={() => removeStudentFile(s.student_id, f.name)} title="Delete file"
                                  className="text-[#2A2035]/25 hover:text-[#B23A3A] text-xs shrink-0">✕</button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Files kept with this session */}
            <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#EEF2FF] flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-[#062E63]">Files</p>
                <label className={`text-[11px] font-bold px-3 py-1.5 rounded-full cursor-pointer transition ${uploading ? 'bg-[#EEF0F4] text-[#868D9C]' : 'bg-[#062E63] text-white hover:bg-[#325099]'}`}>
                  {uploading ? 'Uploading…' : '⬆ Upload'}
                  <input ref={fileRef} type="file" multiple accept={FILES_ACCEPT} className="hidden"
                    disabled={uploading} onChange={e => uploadFiles(e.target.files)} />
                </label>
              </div>
              {files.length === 0 ? (
                <p className="px-5 py-5 text-sm text-[#2A2035]/50">
                  Nothing here yet — worksheets used, photos of working, anything worth keeping with this session.
                </p>
              ) : (
                <ul className="divide-y divide-[#EEF2FF]">
                  {files.map(f => (
                    <li key={f.name} className="px-5 py-2.5 flex items-center gap-3">
                      <a href={f.url || '#'} target="_blank" rel="noopener noreferrer"
                        className={`flex-1 min-w-0 text-sm font-semibold truncate ${f.url ? 'text-[#325099] hover:underline' : 'text-[#2A2035]/50 cursor-default'}`}>
                        📄 {displayName(f.name)}
                      </a>
                      <span className="text-[11px] text-[#2A2035]/40 tabular-nums shrink-0">{fmtSize(f.size)}</span>
                      <button onClick={() => removeFile(f.name)} title="Delete file"
                        className="text-[#2A2035]/30 hover:text-[#B23A3A] text-sm shrink-0">✕</button>
                    </li>
                  ))}
                </ul>
              )}
              {fileErr && <p className="px-5 pb-3 text-xs text-[#991B1B]">{fileErr}</p>}
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
                      Save the hours you actually worked. You can trim them if the session ran short,
                      but not past {fmt12(session?.start_time)} – {fmt12(session?.end_time)}.
                    </p>
                    <div className="flex items-end gap-4 flex-wrap">
                      <label className="text-[11px] font-semibold text-[#325099]">
                        Start
                        <input type="time" value={start} min={bounds.start} max={bounds.end}
                          onChange={e => { setStart(e.target.value); setSaved(false) }}
                          className={`block mt-1 text-sm border rounded-lg px-3 py-2 text-[#2A2035] ${tooEarly ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#DEE7FF]'}`} />
                      </label>
                      <label className="text-[11px] font-semibold text-[#325099]">
                        Finish
                        <input type="time" value={end} min={bounds.start} max={bounds.end}
                          onChange={e => { setEnd(e.target.value); setSaved(false) }}
                          className={`block mt-1 text-sm border rounded-lg px-3 py-2 text-[#2A2035] ${tooLate ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#DEE7FF]'}`} />
                      </label>
                      <p className="text-sm text-[#2A2035]/60 pb-2.5">
                        {hours ? `${hours.toFixed(2)} h` : 'Finish must be after start'}
                        {shift?.rate_snapshot ? ` · $${Number(shift.rate_snapshot).toFixed(2)}/h` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 mt-4 flex-wrap">
                      <button onClick={save} disabled={saving || !hours || tooEarly || tooLate}
                        className="text-xs font-bold text-white bg-[#062E63] hover:bg-[#325099] rounded-full px-5 py-2.5 transition disabled:opacity-40">
                        {saving ? 'Saving…' : shift ? 'Update shift' : 'Save shift'}
                      </button>
                      {(tooEarly || tooLate) && (
                        <span className="text-xs font-semibold text-[#991B1B]">
                          {tooEarly
                            ? `The session starts at ${fmt12(session?.start_time)} — a shift can't start earlier.`
                            : `The session finishes at ${fmt12(session?.end_time)} — a shift can't run later.`}
                        </span>
                      )}
                      {saved && <span className="text-xs font-semibold text-[#166534]">Saved — it will show on your pay page for approval.</span>}
                      {!shift && !saved && !tooEarly && !tooLate && <span className="text-xs text-[#2A2035]/50">No shift has been raised for you on this drop-in yet.</span>}
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

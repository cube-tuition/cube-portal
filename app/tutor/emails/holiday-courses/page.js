'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import { authedFetch } from '../../../../lib/authedFetch'
import TutorNav from '../../../../components/TutorNav'
import { fetchAllTerms, getEnrolmentTerm, isHolidayTerm } from '../../../../lib/terms'
import { T_STUDENTS, T_PARENTS, T_CLASSES, T_ENROLMENTS, T_LESSONS, T_HOLIDAY_COURSE_EMAILS } from '../../../../lib/tables'
import { inferSubject } from '../../../../components/CourseDetail'
import {
  HOLIDAY_SUBJECTS, HOLIDAY_YEARS, STUDENT_STATUSES, DEFAULT_HOLIDAY_TEMPLATE, buildHolidayCourseEmailHtml,
} from '../../../../lib/holidayCourseEmail'

/*
 * Holiday Courses — /tutor/emails/holiday-courses
 *
 * Saved email templates advertising a holiday intensive. Each template has an
 * intro, a dates line, one block per subject (optionally LINKED to the holiday
 * class it advertises, so its dates and times come from that class's sessions),
 * fee lines, a closing note, and an "Enrol now" button that opens the sign-up
 * form. The audience is an editable rule (year levels, subjects, student
 * status) plus a per-family checklist — pick and choose, then preview, test
 * and send. One email per family.
 */

const familyKeyFor = (s) =>
  s.family_id != null ? `f_${s.family_id}` : (s.parent_email ? `e_${s.parent_email.toLowerCase()}` : `s_${s.id}`)

// "2026-09-28" → "Mon 28 Sep" (a local calendar date, never UTC-shifted).
const fmtDate = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  return y ? new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : ''
}
// "09:30:00" → "9:30 am"
const fmtTime = (t) => {
  const [h, min] = String(t || '').split(':').map(Number)
  if (!Number.isFinite(h)) return ''
  return `${h % 12 === 0 ? 12 : h % 12}:${String(min || 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
// Human summary of a linked class's sessions for the block's time line.
const sessionsLine = (sessions = []) => {
  if (!sessions.length) return ''
  const first = sessions[0], last = sessions[sessions.length - 1]
  const dates = sessions.length === 1 ? fmtDate(first.lesson_date) : `${fmtDate(first.lesson_date)} – ${fmtDate(last.lesson_date)}`
  const times = `${fmtTime(first.start_time)} – ${fmtTime(first.end_time)}`
  return `${dates} · ${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${times}`
}

const blankCourse = () => ({ class_id: null, title: '', time: '', blurb: '' })

export default function HolidayCoursesEmailPage() {
  const router = useRouter()
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [students, setStudents] = useState([])   // {id, full_name, year, status, family_id, subjects[], parent_name, parent_email}
  const [holidayTerms, setHolidayTerms] = useState([])  // [{...term, classes: [{id, class_name, teacher, sessions[]}]}]

  const [templates, setTemplates] = useState([])
  const [currentId, setCurrentId] = useState('')
  const [draft, setDraft]       = useState(DEFAULT_HOLIDAY_TEMPLATE())
  const [dirty, setDirty]       = useState(false)
  const [saving, setSaving]     = useState(false)

  const [unchecked, setUnchecked] = useState(() => new Set())
  const [sending, setSending]   = useState(false)
  const [testing, setTesting]   = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [results, setResults]   = useState(null)
  const [testSentTo, setTestSentTo] = useState(null)
  const [error, setError]       = useState(null)

  const rowToDraft = (r) => ({
    ...DEFAULT_HOLIDAY_TEMPLATE(),
    ...r,
    courses: Array.isArray(r.courses) ? r.courses : [],
    year_levels: r.year_levels || [], requires_subjects: r.requires_subjects || [], excludes_subjects: r.excludes_subjects || [],
    statuses: Array.isArray(r.statuses) && r.statuses.length ? r.statuses : ['active', 'trial'],
  })
  const loadIntoDraft = (r) => {
    setCurrentId(r.id); setDraft(rowToDraft(r))
    setDirty(false); setUnchecked(new Set()); setResults(null); setTestSentTo(null)
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)

      const allTerms = await fetchAllTerms()
      const term = getEnrolmentTerm(allTerms)
      const holidays = (allTerms || []).filter(isHolidayTerm).sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
      const [{ data: studentRows }, { data: guardians }, { data: classRows }, { data: enrolRows }, { data: tplRows }, { data: hClasses }] = await Promise.all([
        supabase.from(T_STUDENTS).select('id, full_name, family_id, year, status').order('full_name'),
        supabase.from(T_PARENTS).select('student_id, full_name, email'),
        term ? supabase.from(T_CLASSES).select('id, class_name').eq('term_id', term.id) : Promise.resolve({ data: [] }),
        term ? supabase.from(T_ENROLMENTS).select('student_id, class_id, status, ended_at') : Promise.resolve({ data: [] }),
        supabase.from(T_HOLIDAY_COURSE_EMAILS).select('*').order('updated_at', { ascending: false }),
        holidays.length
          ? supabase.from(T_CLASSES).select('id, class_name, teacher, term_id, status').in('term_id', holidays.map(t => t.id))
          : Promise.resolve({ data: [] }),
      ])
      // Sessions of every holiday class, so a linked block can quote dates and times.
      const liveHoliday = (hClasses || []).filter(c => (c.status || 'active') === 'active')
      const { data: lessonRows } = liveHoliday.length
        ? await supabase.from(T_LESSONS).select('class_id, lesson_date, start_time, end_time').in('class_id', liveHoliday.map(c => c.id)).order('lesson_date')
        : { data: [] }
      const sessionsByClass = {}
      for (const l of lessonRows || []) (sessionsByClass[l.class_id] ||= []).push(l)
      setHolidayTerms(holidays.map(t => ({
        ...t,
        classes: liveHoliday.filter(c => c.term_id === t.id).map(c => ({ ...c, sessions: sessionsByClass[c.id] || [] })),
      })).filter(t => t.classes.length))

      const classById = {}
      for (const c of classRows || []) classById[c.id] = c.class_name
      const subjByStudent = {}
      for (const e of enrolRows || []) {
        const name = classById[e.class_id]
        if (!name || e.ended_at || !['active', 'trial'].includes(e.status)) continue
        const subj = inferSubject({ class_name: name })
        if (subj) (subjByStudent[e.student_id] ||= new Set()).add(subj)
      }
      const gByStudent = {}
      for (const g of guardians || []) (gByStudent[String(g.student_id)] ||= []).push(g)
      setStudents((studentRows || []).map(s => {
        const gs = gByStudent[s.id] || []
        const primary = gs.find(g => g.email) || gs[0] || null
        return {
          id: s.id, full_name: s.full_name, year: s.year, status: s.status || 'active', family_id: s.family_id,
          subjects: [...(subjByStudent[s.id] || [])],
          parent_name: primary?.full_name || null, parent_email: primary?.email || null,
        }
      }))

      setTemplates(tplRows || [])
      if (tplRows?.length) loadIntoDraft(tplRows[0])
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const setField = (k, v) => { setDraft(d => ({ ...d, [k]: v })); setDirty(true) }
  const toggleInList = (k, val) => setField(k, draft[k].includes(val) ? draft[k].filter(x => x !== val) : [...draft[k], val])
  const setCourse = (i, patch) => setField('courses', draft.courses.map((c, j) => j === i ? { ...c, ...patch } : c))
  const removeCourse = (i) => setField('courses', draft.courses.filter((_, j) => j !== i))
  const addCourse = () => setField('courses', [...draft.courses, blankCourse()])

  // Link a block to a holiday class: the class's name, dates and times fill
  // the block; the blurb is the teacher's to write.
  const holidayClassById = useMemo(() => {
    const m = {}
    for (const t of holidayTerms) for (const c of t.classes) m[c.id] = { ...c, term: t }
    return m
  }, [holidayTerms])
  const fillFromClass = (i, classId) => {
    const c = holidayClassById[classId]
    if (!c) { setCourse(i, { class_id: null }); return }
    setCourse(i, { class_id: c.id, title: c.class_name, time: sessionsLine(c.sessions) })
  }

  // ── Template CRUD ────────────────────────────────────────────────────────────
  const rowFromDraft = () => {
    const { id, created_at, ...rest } = draft
    return { ...rest, updated_at: new Date().toISOString() }
  }
  const newTemplate = async () => {
    const { data, error: err } = await supabase.from(T_HOLIDAY_COURSE_EMAILS)
      .insert({ ...DEFAULT_HOLIDAY_TEMPLATE(), created_by: profile?.full_name }).select('*').single()
    if (err) { setError(err.message); return }
    setTemplates(prev => [data, ...prev]); loadIntoDraft(data)
  }
  const saveTemplate = async () => {
    if (!currentId) return
    setSaving(true); setError(null)
    const patch = rowFromDraft()
    const { error: err } = await supabase.from(T_HOLIDAY_COURSE_EMAILS).update(patch).eq('id', currentId)
    setSaving(false)
    if (err) { setError(err.message); return }
    setTemplates(prev => prev.map(t => t.id === currentId ? { ...t, ...patch } : t))
    setDirty(false)
  }
  const deleteTemplate = async () => {
    if (!currentId || !confirm('Delete this holiday course template?')) return
    const { error: err } = await supabase.from(T_HOLIDAY_COURSE_EMAILS).delete().eq('id', currentId)
    if (err) { setError(err.message); return }
    const rest = templates.filter(t => t.id !== currentId)
    setTemplates(rest)
    if (rest.length) loadIntoDraft(rest[0]); else { setCurrentId(''); setDraft(DEFAULT_HOLIDAY_TEMPLATE()) }
  }

  // ── Recipients ───────────────────────────────────────────────────────────────
  const matchingFamilies = useMemo(() => {
    const yrs = (draft.year_levels || []).map(Number)
    const req = draft.requires_subjects || []
    const exc = draft.excludes_subjects || []
    const sts = draft.statuses || []
    const matched = students.filter(s => {
      if (sts.length && !sts.includes(s.status)) return false
      if (yrs.length && !yrs.includes(Number(s.year))) return false
      if (req.length && !req.every(r => s.subjects.includes(r))) return false
      if (exc.length && exc.some(x => s.subjects.includes(x))) return false
      return true
    })
    const map = {}
    for (const s of matched) {
      const key = familyKeyFor(s)
      if (!map[key]) map[key] = { key, parent_name: s.parent_name, parent_email: s.parent_email, students: [] }
      map[key].students.push(s.full_name)
      if (!map[key].parent_email && s.parent_email) { map[key].parent_email = s.parent_email; map[key].parent_name = s.parent_name }
    }
    return Object.values(map)
      .map(f => ({ ...f, student_names: f.students.map(n => n.split(' ')[0]).join(' & ') }))
      .sort((a, b) => (a.parent_name || 'zz').localeCompare(b.parent_name || 'zz'))
  }, [students, draft.year_levels, draft.requires_subjects, draft.excludes_subjects, draft.statuses])

  const selected = useMemo(
    () => matchingFamilies.filter(f => f.parent_email && !unchecked.has(f.key)),
    [matchingFamilies, unchecked])
  const noEmailCount = matchingFamilies.filter(f => !f.parent_email).length

  const previewHtml = useMemo(
    () => buildHolidayCourseEmailHtml(draft, { parentName: selected[0]?.parent_name || 'there', studentNames: selected[0]?.student_names || 'your child' }),
    [draft, selected])

  // ── Send ─────────────────────────────────────────────────────────────────────
  const post = (payload) => authedFetch('/api/send-holiday-course-emails', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template: draft, ...payload }),
  })
  const sendTest = async () => {
    setTesting(true); setError(null); setTestSentTo(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const email = session?.user?.email || profile?.email
      if (!email) throw new Error('Could not determine your email address.')
      const res = await post({ test: true, testEmail: email })
      const b = await res.json(); if (!res.ok) throw new Error(b.error || 'Test send failed')
      setTestSentTo(email)
    } catch (e) { setError(e.message) } finally { setTesting(false) }
  }
  const sendAll = async () => {
    setConfirmSend(false); setSending(true); setError(null); setResults(null)
    try {
      const res = await post({ families: selected.map(f => ({ parent_name: f.parent_name, parent_email: f.parent_email, student_names: f.student_names })) })
      const b = await res.json(); if (!res.ok) throw new Error(b.error || 'Send failed')
      setResults(b)
    } catch (e) { setError(e.message) } finally { setSending(false) }
  }

  const urlOk = /^https?:\/\//i.test(draft.enrol_url || '')
  const contentOk = draft.email_subject.trim() && draft.intro.trim() && urlOk
  const canSend = contentOk && selected.length > 0

  // ── Render ───────────────────────────────────────────────────────────────────
  const pill = (active) => `text-xs font-semibold px-2.5 py-1 rounded-full border transition ${active ? 'bg-[#062E63] text-white border-[#062E63]' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`
  const input = 'w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#325099]'
  const label = 'block text-[11px] font-semibold text-[#325099] mb-1'
  const hint = 'font-normal text-[#325099]/50'

  return (
    <div className="min-h-screen bg-[#F7F9FF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/tutor/emails" className="text-sm text-[#325099] hover:underline">← Emails</Link>
        </div>
        <h1 className="text-2xl font-bold text-[#062E63]">Holiday Courses</h1>
        <p className="text-sm text-[#325099]/60 mt-1 mb-6">Advertise a holiday intensive — link each subject to its holiday class, set the fees and the sign-up form link, choose the families, then preview, test and send. One email per family.</p>

        {error && <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-2">{error}</div>}

        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <select value={currentId} onChange={e => { const t = templates.find(x => x.id === e.target.value); if (t) loadIntoDraft(t) }}
            className="border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm font-semibold text-[#062E63] bg-white max-w-[280px]">
            {templates.length === 0 && <option value="">No templates yet</option>}
            {templates.map(t => <option key={t.id} value={t.id}>{t.name || 'Untitled template'}</option>)}
          </select>
          <button onClick={newTemplate} className="text-sm font-semibold rounded-xl px-3 py-2 border bg-white text-[#062E63] border-[#DEE7FF] hover:border-[#325099]">+ New template</button>
          {currentId && (
            <>
              <button onClick={saveTemplate} disabled={saving || !dirty}
                className="text-sm font-semibold rounded-xl px-4 py-2 border bg-[#325099] text-white border-[#325099] hover:bg-[#062E63] disabled:opacity-50">
                {saving ? 'Saving…' : dirty ? 'Save template' : 'Saved ✓'}
              </button>
              <button onClick={deleteTemplate} className="text-sm font-semibold rounded-xl px-3 py-2 border bg-white text-[#B23A3A] border-[#F3C0C0] hover:bg-[#FFF5F5]">Delete</button>
            </>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-[#2A2035]/40 py-12 text-center animate-pulse">Loading…</p>
        ) : !currentId ? (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center text-sm text-[#325099]/50">
            Create your first holiday course template to get started — it starts pre-filled with the Year 6 Holiday Intensive.
          </div>
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-5">
            {/* Left: template */}
            <div className="space-y-5">
              <section className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
                <p className="text-xs font-bold text-[#062E63] mb-3">Email</p>
                <label className={label}>Template name (internal)</label>
                <input value={draft.name} onChange={e => setField('name', e.target.value)} className={`${input} mb-4`} />
                <label className={label}>Subject line <span className={hint}>· {'{{parent_name}}'}, {'{{student_names}}'}</span></label>
                <input value={draft.email_subject} onChange={e => setField('email_subject', e.target.value)} className={`${input} mb-4`} />
                <label className={label}>Intro <span className={hint}>· blank line = new paragraph · **bold**</span></label>
                <textarea value={draft.intro} onChange={e => setField('intro', e.target.value)} rows={5}
                  className={`${input} leading-relaxed resize-y mb-4`} />
                <label className={label}>Dates <span className={hint}>· shown in a callout box; leave blank to hide</span></label>
                <input value={draft.dates_line} onChange={e => setField('dates_line', e.target.value)} className={input} />
              </section>

              <section className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-[#062E63]">Subjects</p>
                  <button onClick={addCourse} className="text-[11px] font-semibold text-[#325099] hover:underline">+ Add subject</button>
                </div>
                {draft.courses.length === 0 && <p className="text-xs text-[#2A2035]/40 mb-2">No subject blocks yet.</p>}
                <div className="space-y-4">
                  {draft.courses.map((c, i) => (
                    <div key={i} className="border border-[#EEF2FB] rounded-xl p-4 bg-[#FBFCFF]">
                      <div className="flex items-center gap-2 mb-3">
                        <select value={c.class_id || ''} onChange={e => fillFromClass(i, e.target.value ? Number(e.target.value) : null)}
                          className="flex-1 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs text-[#2A2035] bg-white">
                          <option value="">Not linked to a holiday class (free text)</option>
                          {holidayTerms.map(t => (
                            <optgroup key={t.id} label={t.name}>
                              {t.classes.map(hc => <option key={hc.id} value={hc.id}>{hc.class_name}{hc.teacher ? ` — ${hc.teacher}` : ''} ({hc.sessions.length} session{hc.sessions.length === 1 ? '' : 's'})</option>)}
                            </optgroup>
                          ))}
                        </select>
                        {c.class_id && holidayClassById[c.class_id] && (
                          <button onClick={() => fillFromClass(i, c.class_id)} title="Refill the title and times from the class" className="text-[11px] font-semibold text-[#325099] hover:underline whitespace-nowrap">↻ Refill</button>
                        )}
                        <button onClick={() => removeCourse(i)} title="Remove this subject" className="text-[12px] text-[#2A2035]/30 hover:text-[#DC2626]">✕</button>
                      </div>
                      <label className={label}>Title</label>
                      <input value={c.title} onChange={e => setCourse(i, { title: e.target.value })} className={`${input} mb-3`} placeholder="e.g. Mathematics: Head Start on Algebra" />
                      <label className={label}>Dates &amp; times</label>
                      <input value={c.time} onChange={e => setCourse(i, { time: e.target.value })} className={`${input} mb-3`} placeholder="e.g. 9:30 – 11:00 am, daily" />
                      <label className={label}>What students will do</label>
                      <textarea value={c.blurb} onChange={e => setCourse(i, { blurb: e.target.value })} rows={2} className={`${input} leading-relaxed resize-y`} />
                    </div>
                  ))}
                </div>
                {holidayTerms.length === 0 && (
                  <p className="text-[11px] text-[#2A2035]/45 mt-3">No holiday classes exist yet. Create them in the database explorer inside a holiday period, then link each subject here to pull its dates and times.</p>
                )}
              </section>

              <section className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
                <p className="text-xs font-bold text-[#062E63] mb-3">Fees, closing and sign-up</p>
                <label className={label}>Course fees <span className={hint}>· one line per fee</span></label>
                <textarea value={draft.fees} onChange={e => setField('fees', e.target.value)} rows={3} className={`${input} leading-relaxed resize-y mb-4`} />
                <label className={label}>Closing note <span className={hint}>· shown just above the button</span></label>
                <textarea value={draft.closing} onChange={e => setField('closing', e.target.value)} rows={2} className={`${input} leading-relaxed resize-y mb-4`} />
                <div className="grid sm:grid-cols-[minmax(0,1fr)_160px] gap-3 mb-4">
                  <div>
                    <label className={label}>Sign-up form link <span className={hint}>· the button opens this</span></label>
                    <input value={draft.enrol_url} onChange={e => setField('enrol_url', e.target.value)} placeholder="https://…" className={`${input} ${draft.enrol_url && !urlOk ? 'border-rose-300' : ''}`} />
                  </div>
                  <div>
                    <label className={label}>Button label</label>
                    <input value={draft.enrol_label} onChange={e => setField('enrol_label', e.target.value)} className={input} />
                  </div>
                </div>
                {!urlOk && <p className="text-[11px] text-amber-700 -mt-2 mb-4">Paste the full link to the sign-up form (starting with https://) before sending.</p>}
                <label className={label}>Sign-off</label>
                <textarea value={draft.signoff} onChange={e => setField('signoff', e.target.value)} rows={2} className={`${input} leading-relaxed resize-y`} />
              </section>

              <section className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
                <p className="text-xs font-bold text-[#062E63] mb-3">Audience</p>
                <p className="text-[11px] font-semibold text-[#325099] mb-1.5">Student status <span className={hint}>(none = every status)</span></p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {STUDENT_STATUSES.map(s => <button key={s} onClick={() => toggleInList('statuses', s)} className={pill(draft.statuses.includes(s))}>{s}</button>)}
                </div>
                <p className="text-[11px] font-semibold text-[#325099] mb-1.5">Year levels <span className={hint}>(none = all years)</span></p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {HOLIDAY_YEARS.map(y => <button key={y} onClick={() => toggleInList('year_levels', y)} className={pill(draft.year_levels.includes(y))}>Y{y}</button>)}
                </div>
                <p className="text-[11px] font-semibold text-[#325099] mb-1.5">Currently studies <span className={hint}>(must do all selected)</span></p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {HOLIDAY_SUBJECTS.map(s => <button key={s} onClick={() => toggleInList('requires_subjects', s)} className={pill(draft.requires_subjects.includes(s))}>{s}</button>)}
                </div>
                <p className="text-[11px] font-semibold text-[#325099] mb-1.5">Does NOT study</p>
                <div className="flex flex-wrap gap-1.5">
                  {HOLIDAY_SUBJECTS.map(s => <button key={s} onClick={() => toggleInList('excludes_subjects', s)} className={pill(draft.excludes_subjects.includes(s))}>{s}</button>)}
                </div>
                <p className="text-[11px] text-[#2A2035]/45 mt-3">Untick individual families in the list on the right to leave them out.</p>
              </section>
            </div>

            {/* Right: recipients + preview + send */}
            <div className="space-y-5">
              <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
                <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3 flex items-center justify-between">
                  <p className="text-xs font-bold text-[#062E63]">Recipients — {selected.length} of {matchingFamilies.length}</p>
                  {matchingFamilies.length > 0 && (
                    <div className="flex gap-2 text-[10px] font-semibold">
                      <button onClick={() => setUnchecked(new Set())} className="text-[#325099] hover:underline">All</button>
                      <button onClick={() => setUnchecked(new Set(matchingFamilies.map(f => f.key)))} className="text-[#325099] hover:underline">None</button>
                    </div>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#F0F4FF]">
                  {matchingFamilies.length === 0 ? (
                    <p className="text-center text-xs text-[#2A2035]/40 py-8">No students match this audience.</p>
                  ) : matchingFamilies.map(f => (
                    <label key={f.key} className={`flex items-start gap-2.5 px-4 py-2 cursor-pointer ${!f.parent_email ? 'opacity-50' : ''}`}>
                      <input type="checkbox" disabled={!f.parent_email} checked={!!f.parent_email && !unchecked.has(f.key)}
                        onChange={() => setUnchecked(prev => { const n = new Set(prev); n.has(f.key) ? n.delete(f.key) : n.add(f.key); return n })}
                        className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-[#062E63] truncate">{f.parent_name || f.students[0]}</span>
                        <span className="block text-[10px] text-[#2A2035]/45 truncate">{f.students.join(', ')}{f.parent_email ? ` · ${f.parent_email}` : ' · no email'}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {noEmailCount > 0 && <p className="px-4 py-2 text-[10px] text-amber-700 bg-amber-50 border-t border-amber-100">{noEmailCount} matching famil{noEmailCount === 1 ? 'y has' : 'ies have'} no email and can&apos;t be sent to.</p>}
              </section>

              <section className="bg-white rounded-2xl border border-[#DEE7FF] p-4">
                <p className="text-xs font-bold text-[#062E63] mb-2">Preview</p>
                <iframe srcDoc={previewHtml} title="preview" className="w-full h-[28rem] border border-[#EEF2FB] rounded-xl bg-white" />
              </section>

              <div className="flex flex-col gap-2">
                {testSentTo && <p className="text-xs text-emerald-700">Test sent to {testSentTo}.</p>}
                <div className="flex gap-2">
                  <button onClick={sendTest} disabled={testing || !contentOk}
                    className="flex-1 text-sm font-semibold rounded-xl px-4 py-2.5 border bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] hover:bg-[#FEF3C7] disabled:opacity-40">
                    {testing ? 'Testing…' : '🧪 Test to me'}
                  </button>
                  <button onClick={() => setConfirmSend(true)} disabled={sending || !canSend}
                    className="flex-1 text-sm font-semibold rounded-xl px-4 py-2.5 border bg-[#062E63] text-white border-[#062E63] hover:bg-[#325099] disabled:opacity-40">
                    {sending ? 'Sending…' : `✉ Send to ${selected.length}`}
                  </button>
                </div>
                {dirty && <p className="text-[11px] text-amber-700">You have unsaved changes — save the template before sending so the audience and content stick.</p>}
              </div>

              {results && (
                <div className="bg-white rounded-2xl border border-[#DEE7FF] p-4 text-sm">
                  <p className="font-semibold text-[#062E63] mb-1">Sent {results.successCount}/{results.total}.</p>
                  {results.results?.filter(r => !r.success).map((r, i) => (
                    <p key={i} className="text-xs text-rose-600">{r.email || r.family}: {r.error}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {confirmSend && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setConfirmSend(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] p-6 w-[24rem]" onClick={e => e.stopPropagation()}>
            <p className="text-lg font-bold text-[#062E63] mb-2">Send holiday course email?</p>
            <p className="text-sm text-[#2A2035]/70 mb-1">“{draft.name}” will email <strong>{selected.length}</strong> famil{selected.length === 1 ? 'y' : 'ies'}.</p>
            <p className="text-xs text-[#2A2035]/50 mb-5">Subject: {draft.email_subject || '(none)'}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmSend(false)} className="flex-1 text-sm font-semibold rounded-xl px-4 py-2 border border-[#DEE7FF] text-[#325099]">Cancel</button>
              <button onClick={sendAll} className="flex-1 text-sm font-semibold rounded-xl px-4 py-2 bg-[#062E63] text-white hover:bg-[#325099]">Send now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

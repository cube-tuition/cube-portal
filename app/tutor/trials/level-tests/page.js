'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import SearchSelectPopover from '../../../../components/SearchSelectPopover'
import { subjectCode } from '../../../../lib/format'

/*
 * Level Tests — /tutor/trials/level-tests
 *
 * Book a student (active or trial) in for a level test from the exam bank,
 * then mark it per question and read the topical analysis. The booking is a
 * lessons row (lesson_type='level_test', makeup_student_id set so the report
 * and guardian email know who sat it); marking, per-question marks and the
 * topical analysis all live on the lesson page (/tutor/lessons/<id>), the
 * same machinery the mid-term and end-of-term exams use.
 */

const fmtDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmt12 = (t) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = ((h + 11) % 12) + 1; return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}` }

// Same display name the Level Tests panel uses: "10.M. Level Test".
const levelTestDisplayName = (t) => {
  const code = subjectCode(t.subject)
  return (t.year && code) ? `${t.year}.${code}. Level Test` : (t.title || 'Untitled level test')
}

const EMPTY_FORM = { student_id: '', build_ids: [], lesson_date: '', start_time: '', end_time: '', room: '', notes: '' }

export default function LevelTestBookingsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [tests, setTests] = useState([])
  const [bookings, setBookings] = useState([])
  const [markCounts, setMarkCounts] = useState({})   // lesson_id -> marks entered
  const [form, setForm] = useState(EMPTY_FORM)
  const [studentPop, setStudentPop] = useState(null)   // anchor rect while the picker is open
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

  useEffect(() => {
    if (!ready) return undefined
    let alive = true
    ;(async () => {
      const [{ data: sts }, { data: lts }, { data: ls }] = await Promise.all([
        supabase.from('students')
          .select('id, full_name, year, school, status')
          .in('status', ['active', 'trial']).order('full_name'),
        supabase.from('booklet_builds')
          .select('id, title, year, subject')
          .eq('doc_type', 'level_test').order('updated_at', { ascending: false }),
        supabase.from('lessons')
          .select('id, lesson_date, start_time, end_time, room, notes, student_name, makeup_student_id, level_test_build_ids, level_test_build_id, students:makeup_student_id(full_name, year, status)')
          .eq('lesson_type', 'level_test')
          .order('lesson_date', { ascending: false }).order('start_time', { ascending: false })
          .limit(200),
      ])
      if (!alive) return
      setStudents(sts || [])
      setTests(lts || [])
      setBookings(ls || [])
      const ids = (ls || []).map(l => l.id)
      if (ids.length) {
        const { data: ms } = await supabase.from('level_test_marks')
          .select('lesson_id').in('lesson_id', ids)
        if (!alive) return
        const counts = {}
        for (const m of ms || []) counts[m.lesson_id] = (counts[m.lesson_id] || 0) + 1
        setMarkCounts(counts)
      }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [ready])

  const testById = useMemo(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests])
  const studentOptions = useMemo(() => {
    const opt = (s) => ({
      value: String(s.id),
      label: s.full_name,
      sub: [s.year ? `Year ${s.year}` : null, s.status === 'trial' ? 'Trial' : 'Active', s.school || null]
        .filter(Boolean).join(' · '),
    })
    // Trial students first — they are who this page mostly books.
    return [
      ...students.filter(s => s.status === 'trial').map(opt),
      ...students.filter(s => s.status === 'active').map(opt),
    ]
  }, [students])
  const chosenStudent = students.find(s => String(s.id) === String(form.student_id)) || null

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const toggleTest = (tid) => setForm(f => ({
    ...f,
    build_ids: f.build_ids.includes(tid) ? f.build_ids.filter(x => x !== tid) : [...f.build_ids, tid],
  }))
  const valid = form.student_id && form.build_ids.length > 0 && form.lesson_date && form.start_time

  const book = async () => {
    if (!valid || saving) return
    setSaving(true); setErr('')
    const student = students.find(s => String(s.id) === String(form.student_id))
    const { data, error } = await supabase.from('lessons').insert({
      lesson_type: 'level_test',
      makeup_student_id: student?.id ?? null,
      student_name: student?.full_name ?? null,
      level_test_build_ids: form.build_ids,
      level_test_build_id: form.build_ids[0],
      lesson_date: form.lesson_date,
      start_time: form.start_time,
      end_time: form.end_time || null,
      room: form.room.trim() || null,
      notes: form.notes.trim() || null,
      scheduled_teacher_id: null,
      is_makeup: false,
      status: 'scheduled',
    }).select('id, lesson_date, start_time, end_time, room, notes, student_name, makeup_student_id, level_test_build_ids, level_test_build_id').single()
    setSaving(false)
    if (error) { setErr('Could not book the level test: ' + error.message); return }
    setBookings(bs => [{ ...data, students: student ? { full_name: student.full_name, year: student.year, status: student.status } : null }, ...bs])
    setForm(EMPTY_FORM)
  }

  const removeBooking = async (id) => {
    if (confirmDel !== id) { setConfirmDel(id); setTimeout(() => setConfirmDel(c => (c === id ? null : c)), 3000); return }
    setConfirmDel(null)
    const prev = bookings
    setBookings(bs => bs.filter(b => b.id !== id))
    const { error } = await supabase.from('lessons').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); setBookings(prev) }
  }

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const FIELD = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] transition'
  const LABEL = 'block text-[10px] font-bold tracking-widest uppercase text-[#325099]/60 mb-1'

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-6xl mx-auto px-6 pt-10 pb-24">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href="/tutor/trials" className="text-sm text-[#325099]/50 hover:text-[#325099] transition">← Trials</Link>
            </div>
            <h1 className="text-2xl font-bold text-[#062E63]">Level Tests</h1>
            <p className="text-sm text-[#325099]/60 mt-1">
              Book a student in for a level test, mark it question by question, and read their topical analysis.
            </p>
          </div>
        </div>

        {/* ── Book a level test ── */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5 md:p-6 mb-8">
          <p className="text-sm font-bold text-[#062E63] mb-4">📋 Book a student in</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className={LABEL}>Student</label>
              <button type="button"
                onClick={(e) => setStudentPop(e.currentTarget.getBoundingClientRect())}
                className={`${FIELD} flex items-center justify-between gap-2 text-left ${chosenStudent ? '' : 'text-[#2A2035]/40'}`}>
                <span className="truncate">
                  {chosenStudent
                    ? <>{chosenStudent.full_name}
                        {chosenStudent.year && <span className="text-[#325099]/60"> · Y{chosenStudent.year}</span>}
                        {chosenStudent.status === 'trial' && <span className="ml-1.5 text-[9px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] align-middle">Trial</span>}</>
                    : 'Choose a student…'}
                </span>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 opacity-50">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {studentPop && (
                <SearchSelectPopover
                  anchor={studentPop}
                  options={studentOptions}
                  currentValue={form.student_id}
                  placeholder="Search students…"
                  onSelect={(v) => { setForm(f => ({ ...f, student_id: v })); setStudentPop(null) }}
                  onClose={() => setStudentPop(null)}
                />
              )}
            </div>
            <div>
              <label className={LABEL}>Date</label>
              <input type="date" value={form.lesson_date} onChange={set('lesson_date')} className={FIELD} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>Start</label>
                <input type="time" value={form.start_time} onChange={set('start_time')} className={FIELD} />
              </div>
              <div>
                <label className={LABEL}>Finish</label>
                <input type="time" value={form.end_time} onChange={set('end_time')} className={FIELD} />
              </div>
            </div>
            <div className="col-span-2 md:col-span-4">
              <label className={LABEL}>Level test(s) — from the exam bank</label>
              {tests.length === 0 ? (
                <p className="text-xs text-[#2A2035]/45 py-1">
                  No level tests in the bank yet — build one under Resources → Exams → Level Tests.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tests.map(t => {
                    const on = form.build_ids.includes(t.id)
                    return (
                      <button key={t.id} type="button" onClick={() => toggleTest(t.id)}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition ${on
                          ? 'bg-[#062E63] text-white border-[#062E63]'
                          : 'bg-white text-[#2A2035]/65 border-[#DEE7FF] hover:border-[#325099]'}`}>
                        {on ? '✓ ' : ''}{levelTestDisplayName(t)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div>
              <label className={LABEL}>Room</label>
              <input value={form.room} onChange={set('room')} className={FIELD} placeholder="—" />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={LABEL}>Notes</label>
              <input value={form.notes} onChange={set('notes')} className={FIELD} placeholder="Anything worth noting for the session…" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={book} disabled={!valid || saving}
              className="text-xs font-bold text-white bg-[#062E63] hover:bg-[#325099] rounded-full px-5 py-2.5 transition disabled:opacity-40">
              {saving ? 'Booking…' : 'Book level test'}
            </button>
            {err && <span className="text-xs font-semibold text-[#991B1B]">{err}</span>}
          </div>
        </div>

        {/* ── Bookings ── */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#EEF2FF] flex items-center justify-between">
            <p className="text-sm font-bold text-[#062E63]">Booked level tests</p>
            <span className="text-[11px] text-[#2A2035]/40 tabular-nums">{bookings.length}</span>
          </div>
          {loading ? (
            <p className="px-5 py-8 text-sm text-[#2A2035]/40 animate-pulse">Loading…</p>
          ) : bookings.length === 0 ? (
            <p className="px-5 py-8 text-sm text-[#2A2035]/45">No level tests booked yet.</p>
          ) : (
            <ul className="divide-y divide-[#EEF2FF]">
              {bookings.map(b => {
                const buildIds = (Array.isArray(b.level_test_build_ids) && b.level_test_build_ids.length)
                  ? b.level_test_build_ids : (b.level_test_build_id ? [b.level_test_build_id] : [])
                const names = buildIds.map(tid => (testById[tid] ? levelTestDisplayName(testById[tid]) : 'Deleted test'))
                const who = b.students?.full_name || b.student_name || 'Student'
                const trial = b.students?.status === 'trial'
                const marked = markCounts[b.id] || 0
                const past = b.lesson_date <= new Date().toISOString().slice(0, 10)
                return (
                  <li key={b.id} className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#2A2035]">
                        {who}
                        {b.students?.year && <span className="text-[#325099]/60 font-normal"> · Y{b.students.year}</span>}
                        {trial && <span className="ml-1.5 text-[9px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">Trial</span>}
                      </p>
                      <p className="text-[11px] text-[#2A2035]/50 mt-0.5 truncate">
                        {fmtDate(b.lesson_date)} · {fmt12(b.start_time)}{b.end_time ? `–${fmt12(b.end_time)}` : ''}
                        {b.room ? ` · ${b.room}` : ''} · {names.join(' + ')}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${marked > 0
                      ? 'bg-[#DCFCE7] text-[#166534] border-[#A7F3D0]'
                      : past ? 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]' : 'bg-[#EEF4FF] text-[#325099] border-[#DEE7FF]'}`}>
                      {marked > 0 ? `${marked} mark${marked === 1 ? '' : 's'} entered` : past ? 'To mark' : 'Booked'}
                    </span>
                    <Link href={`/tutor/lessons/${b.id}`}
                      className="text-xs font-bold text-white bg-[#325099] hover:bg-[#062E63] rounded-full px-4 py-1.5 transition shrink-0">
                      {marked > 0 ? 'Marking & analysis →' : 'Open marking →'}
                    </Link>
                    <button onClick={() => removeBooking(b.id)}
                      className={`text-[11px] font-semibold shrink-0 transition ${confirmDel === b.id ? 'text-[#B23A3A]' : 'text-[#2A2035]/30 hover:text-[#B23A3A]'}`}>
                      {confirmDel === b.id ? 'Confirm?' : 'Delete'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <p className="text-[11px] text-[#2A2035]/40 mt-3">
          Opening a booking gives per-question marking and the student&rsquo;s topical analysis — the same
          breakdown as the mid-term and end-of-term exams — plus the feedback report PDF and guardian email.
        </p>
      </div>
    </div>
  )
}

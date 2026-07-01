'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import { T_ATTENDANCE, T_CURRENT_TUTOR_RATES, T_LESSONS, T_QUIZ_RESULTS, T_SHIFTS } from '../../../../../lib/tables'
import { inferSubject, subjectsMatch } from '../../../../../components/CourseDetail'
import { fmtTime, fmtTimeRange } from '../../../../../lib/format'

/*
 * Makeup lesson session page — /tutor/classes/makeup/[lessonId]
 * ─────────────────────────────────────────────────────────────
 * Full single-student marking form. Fields adapt to the source class type:
 *   • Group class  → Attendance + HW Completion + RQ Mark % + Notes
 *   • 1:1 class    → Attendance + Understanding % + Notes
 *
 * Saving writes attendance, quiz_results, and a draft payroll shift together.
 */

const MONTH_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ── Field options (mirrors SessionMarker) ──────────────────────────────────
const ATTENDANCE_OPTIONS = [
  { value: 'present', label: 'Present', bg: '#D1FAE5', fg: '#065F46' },
  { value: 'late',    label: 'Late',    bg: '#FEF3C7', fg: '#92400E' },
  { value: 'absent',  label: 'Absent',  bg: '#FEE2E2', fg: '#991B1B' },
]
const GRADE_OPTIONS = [
  { value: 'A', label: 'A — Excellent',   bg: '#D1FAE5', fg: '#065F46' },
  { value: 'B', label: 'B — Good',        bg: '#DEE7FF', fg: '#062E63' },
  { value: 'C', label: 'C — Satisfactory',bg: '#FEF3C7', fg: '#92400E' },
  { value: 'D', label: 'D — Needs work',  bg: '#FFEDD5', fg: '#9A3412' },
  { value: 'E', label: 'E — Not done',    bg: '#FEE2E2', fg: '#991B1B' },
]
const UNDERSTANDING_OPTIONS = [
  { value: '100', label: '100%', bg: '#D1FAE5', fg: '#065F46' },
  { value: '90',  label: '90%',  bg: '#D1FAE5', fg: '#065F46' },
  { value: '80',  label: '80%',  bg: '#DEE7FF', fg: '#062E63' },
  { value: '70',  label: '70%',  bg: '#DEE7FF', fg: '#062E63' },
  { value: '60',  label: '60%',  bg: '#FEF3C7', fg: '#92400E' },
  { value: '50',  label: '50%',  bg: '#FEF3C7', fg: '#92400E' },
  { value: '40',  label: '40%',  bg: '#FFEDD5', fg: '#9A3412' },
  { value: '30',  label: '30%',  bg: '#FEE2E2', fg: '#991B1B' },
  { value: '20',  label: '20%',  bg: '#FEE2E2', fg: '#991B1B' },
]

// ── Helpers ────────────────────────────────────────────────────────────────
// fmtTime and fmtTimeRange imported from lib/format.

// Includes weekday: "Wednesday 4 June 2025"
function fmtDateWithDay(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  return `${days[d.getDay()]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`
}
function parseTimeMins(t) {
  if (!t) return null
  const [hRaw, mRaw] = String(t).split(':')
  const h = parseInt(hRaw, 10); const m = parseInt(mRaw || '0', 10) || 0
  if (Number.isNaN(h)) return null
  return h * 60 + m
}

// ── Pill select button ─────────────────────────────────────────────────────
function PillOption({ opt, selected, onSelect, disabled }) {
  const active = selected === opt.value
  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(opt.value)}
      disabled={disabled}
      className={`px-4 py-2 rounded-full text-sm font-semibold border transition ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      }`}
      style={active
        ? { background: opt.bg, color: opt.fg, borderColor: opt.fg + '55' }
        : { background: '#F8FAFF', color: '#325099', borderColor: '#DEE7FF' }}
    >{opt.label}</button>
  )
}

// ── Field card ─────────────────────────────────────────────────────────────
function FieldCard({ label, required, children }) {
  return (
    <div className="rounded-2xl border border-[#DEE7FF] bg-white px-6 py-5">
      <p className="text-[10px] font-semibold tracking-[0.25em] uppercase text-[#325099] mb-3">
        {label}{required && <span className="text-[#DC2626] ml-0.5">*</span>}
      </p>
      {children}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function MakeupLessonPage() {
  const { lessonId } = useParams()
  const router = useRouter()

  const [staff, setStaff]     = useState(null)
  const [lesson, setLesson]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [authErr, setAuthErr] = useState(null)

  // Marks
  const [attendance, setAttendance]   = useState('')
  const [hw, setHw]                   = useState('')       // group only
  const [rq, setRq]                   = useState('')       // group only (0-100)
  const [understanding, setUnderstanding] = useState('') // 1:1 only
  const [notes, setNotes]             = useState('')

  // Save state
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [saveErr, setSaveErr]   = useState(null)
  const [isLocked, setIsLocked] = useState(false)
  const [showValidation, setShowValidation] = useState(false)

  // ── Auth + lesson load ────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { user, profile } = await getAuthProfile()
      if (!user)    { router.push('/'); return }
      if (!profile) { setAuthErr('No profile found.'); return }
      if (profile.role !== 'tutor' && profile.role !== 'admin') { router.push('/dashboard'); return }
      setStaff(profile)

      const { data: row, error } = await supabase
        .from(T_LESSONS)
        .select(`
          id, lesson_date, start_time, end_time, room, week,
          is_makeup, makeup_student_id, class_id,
          students!makeup_student_id (id, full_name, year, school),
          classes (id, class_name, teacher, room, start_time, end_time)
        `)
        .eq('id', lessonId)
        .eq('is_makeup', true)
        .maybeSingle()

      if (error || !row) { setAuthErr('Lesson not found.'); setLoading(false); return }
      setLesson(row)

      // Prefill from existing attendance / quiz_results
      const studentId = row.makeup_student_id
      const [{ data: attRow }, { data: qzRow }] = await Promise.all([
        supabase.from(T_ATTENDANCE)
          .select('status, notes')
          .eq('class_id', row.class_id)
          .eq('session_date', row.lesson_date)
          .eq('student_id', studentId)
          .maybeSingle(),
        supabase.from(T_QUIZ_RESULTS)
          .select('score, homework_grade')
          .eq('student_id', studentId)
          .eq('quiz_date', row.lesson_date)
          .maybeSingle(),
      ])

      let hasData = false
      if (attRow) {
        setAttendance(attRow.status || '')
        setNotes(attRow.notes || '')
        hasData = true
      }
      if (qzRow) {
        if (qzRow.score != null) {
          const isOneToOne = /1.?:?.?1/i.test(row.classes?.class_name || '')
          if (isOneToOne) setUnderstanding(String(qzRow.score))
          else setRq(String(qzRow.score))
        }
        if (qzRow.homework_grade) setHw(qzRow.homework_grade)
        hasData = true
      }
      if (hasData) setIsLocked(true)

      setLoading(false)
    }
    load()
  }, [lessonId])

  // ── Derived ───────────────────────────────────────────────────────────────
  const isOneToOne = /1.?:?.?1/i.test(lesson?.classes?.class_name || '')
  const isAbsent   = attendance === 'absent'
  const studentId  = lesson?.makeup_student_id
  const subject    = lesson ? inferSubject({ class_name: lesson.classes?.class_name }) : ''

  // ── Validation ────────────────────────────────────────────────────────────
  const attMissing  = showValidation && !attendance
  const hwMissing   = showValidation && !isAbsent && !isOneToOne && !hw
  const rqMissing   = showValidation && !isAbsent && !isOneToOne && (rq === '' || rq == null)
  const uMissing    = showValidation && !isAbsent && isOneToOne && !understanding

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (saving || isLocked || !lesson || !staff) return

    // Validate
    const missing = []
    if (!attendance) missing.push('Attendance')
    if (!isAbsent) {
      if (isOneToOne && !understanding) missing.push('Understanding %')
      if (!isOneToOne && !hw) missing.push('HW Completion')
      if (!isOneToOne && (rq === '' || rq == null)) missing.push('RQ Mark')
    }
    if (missing.length > 0) {
      setShowValidation(true)
      setSaveErr(`Please fill in: ${missing.join(', ')}`)
      return
    }
    setShowValidation(false); setSaveErr(null); setSaving(true)

    // 1. Upsert attendance
    const { error: attErr } = await supabase.from(T_ATTENDANCE).upsert({
      student_id:   studentId,
      class_id:     lesson.class_id,
      session_date: lesson.lesson_date,
      status:       attendance,
      notes:        notes.trim() || null,
    }, { onConflict: 'student_id,class_id,session_date' })
    if (attErr) { setSaveErr('Failed to save attendance: ' + attErr.message); setSaving(false); return }

    // 2. Save quiz_results (skip if absent). quiz_results has no natural unique
    // key, so we find-then-update/insert (like the session marker) rather than
    // upsert — keyed on student + makeup date, matching the prefill above.
    if (!isAbsent) {
      const scoreVal = isOneToOne ? (understanding ? Number(understanding) : null) : (rq !== '' ? Number(rq) : null)
      const qzSubject = subject || lesson.classes?.class_name || ''
      const { data: existingQz } = await supabase.from(T_QUIZ_RESULTS)
        .select('id, subject')
        .eq('student_id', studentId)
        .eq('quiz_date', lesson.lesson_date)
        .limit(20)
      const existingRow = (existingQz || []).find(r => subjectsMatch(r.subject, qzSubject)) || (existingQz || [])[0]
      const qzPayload = {
        student_id:      studentId,
        subject:         qzSubject,
        week:            lesson.week ? `Week ${lesson.week}` : null,
        score:           scoreVal,
        max_score:       100,
        homework_grade:  isOneToOne ? null : (hw || null),
        quiz_date:       lesson.lesson_date,
      }
      const { error: qzErr } = existingRow
        ? await supabase.from(T_QUIZ_RESULTS).update(qzPayload).eq('id', existingRow.id)
        : await supabase.from(T_QUIZ_RESULTS).insert(qzPayload)
      if (qzErr) { setSaveErr('Failed to save marks: ' + qzErr.message); setSaving(false); return }
    }

    // 3. Create draft payroll shift
    const startMins = parseTimeMins(lesson.start_time)
    const endMins   = parseTimeMins(lesson.end_time)
    const hours = (startMins != null && endMins != null && endMins > startMins)
      ? parseFloat(((endMins - startMins) / 60).toFixed(2)) : null

    let rateSnapshot = null
    const { data: rateRow } = await supabase
      .from(T_CURRENT_TUTOR_RATES).select('*').eq('tutor_id', staff.id).limit(1).maybeSingle()
    if (rateRow) rateSnapshot = rateRow

    // Only insert shift if one doesn't already exist
    const { data: existingShift } = await supabase
      .from(T_SHIFTS).select('id')
      .eq('source_table', 'makeup_lesson').eq('source_id', String(lesson.id))
      .maybeSingle()
    if (!existingShift) {
      const { error: shiftErr } = await supabase.from(T_SHIFTS).insert({
        tutor_id:      staff.id,
        work_date:     lesson.lesson_date,
        start_time:    lesson.start_time,
        end_time:      lesson.end_time,
        hours,
        kind:          'teaching',
        source_table:  'makeup_lesson',
        source_id:     String(lesson.id),
        rate_snapshot: rateSnapshot,
        notes:         notes.trim() || `Makeup session — ${lesson.students?.full_name}`,
        status:        'draft',
        created_by:    staff.id,
      })
      if (shiftErr) { setSaveErr('Marks saved but shift failed: ' + shiftErr.message); setSaving(false); return }
    }

    setSaving(false); setIsLocked(true); setSaved(true)
  }

  // ── Loading / error ───────────────────────────────────────────────────────
  if (authErr) return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="text-center">
        <p className="text-sm text-[#B23A3A] mb-4">{authErr}</p>
        <Link href="/tutor/classes" className="text-xs font-semibold text-[#325099] underline">Back to classes</Link>
      </div>
    </div>
  )
  if (loading || !staff) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <p className="text-sm text-[#325099]/60 font-semibold tracking-widest uppercase font-display">Loading…</p>
    </div>
  )

  const studentName  = lesson.students?.full_name || 'Student'
  const studentYear  = lesson.students?.year ? `Year ${lesson.students.year}` : null
  const studentSchool = lesson.students?.school || null
  const className    = lesson.classes?.class_name || 'Class'
  const timeRange    = fmtTimeRange(lesson.start_time, lesson.end_time)
  const room         = lesson.room || lesson.classes?.room || null
  const weekLabel    = lesson.week ? `Week ${lesson.week}` : null
  const isAdmin      = staff.role === 'admin'

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={isAdmin} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F5F3FF] via-[#EDE9FE] to-[#C4B5FD] border-b border-[#DDD6FE]">
        <div className="max-w-3xl mx-auto px-6 md:px-10 py-7 md:py-10">
          <div className="flex items-center gap-2 mb-4 text-[11px] text-[#5B21B6]/70 font-medium">
            <Link href="/tutor/classes" className="hover:text-[#5B21B6] transition">Classes</Link>
            <span>/</span>
            <span className="text-[#5B21B6]">Makeup Lesson</span>
          </div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase px-2.5 py-1 rounded-full bg-[#8B5CF6]/15 text-[#5B21B6]">Makeup · {isOneToOne ? '1:1' : 'Group'}</span>
            {weekLabel && <span className="text-[10px] font-bold tracking-[0.2em] uppercase px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">{weekLabel}</span>}
            {isLocked && !saved && <span className="text-[10px] font-bold tracking-[0.2em] uppercase px-2.5 py-1 rounded-full bg-[#D1FAE5] text-[#065F46]">✓ Saved</span>}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-[#2A2035] font-display mb-1">{studentName}</h1>
          <p className="text-sm text-[#2A2035]/60">{className}{room ? ` · ${room}` : ''}</p>
        </div>
      </section>

      {/* CONTENT */}
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 space-y-5">

        {/* Session meta */}
        <div className="rounded-2xl border border-[#DDD6FE] bg-[#FAF5FF] px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetaItem label="Date"   value={fmtDateWithDay(lesson.lesson_date)} span={2} />
          <MetaItem label="Time"   value={timeRange} />
          {room           && <MetaItem label="Room"   value={room} />}
          {studentYear    && <MetaItem label="Year"   value={studentYear} />}
          {studentSchool  && <MetaItem label="School" value={studentSchool} />}
        </div>

        {/* Lock banner */}
        {isLocked && (
          <div className="flex items-center gap-2.5 px-5 py-3 rounded-2xl border border-[#A7F3D0] bg-[#F0FDF4]">
            <span className="text-lg">🔒</span>
            <p className="text-sm font-semibold text-[#065F46]">
              {saved ? 'Session saved — shift logged for payroll.' : 'Session already marked — use “Edit marks” to change.'}
            </p>
          </div>
        )}

        {/* Error */}
        {saveErr && (
          <div className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3">
            <p className="text-xs text-[#B23A3A]">{saveErr}</p>
          </div>
        )}

        {/* ── ATTENDANCE ── */}
        <FieldCard label="Attendance" required>
          <div className="flex flex-wrap gap-2">
            {ATTENDANCE_OPTIONS.map(opt => (
              <PillOption key={opt.value} opt={opt} selected={attendance} onSelect={setAttendance} disabled={isLocked} />
            ))}
          </div>
          {attMissing && <p className="text-[11px] text-[#DC2626] mt-2">Attendance is required.</p>}
        </FieldCard>

        {/* ── GROUP CLASS FIELDS ── */}
        {!isOneToOne && !isAbsent && (
          <>
            <FieldCard label="Previous week's HW completion" required>
              <div className="flex flex-wrap gap-2">
                {GRADE_OPTIONS.map(opt => (
                  <PillOption key={opt.value} opt={opt} selected={hw} onSelect={setHw} disabled={isLocked} />
                ))}
              </div>
              {hwMissing && <p className="text-[11px] text-[#DC2626] mt-2">HW completion is required.</p>}
            </FieldCard>

            <FieldCard label="RQ mark %" required>
              <div className="flex items-center gap-3">
                <input
                  type="number" min="0" max="100"
                  value={rq}
                  onChange={e => setRq(e.target.value)}
                  disabled={isLocked}
                  placeholder="0–100"
                  className="w-28 text-sm font-semibold text-[#2A2035] bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20 focus:border-[#7C3AED] transition disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {rq !== '' && !isNaN(Number(rq)) && (
                  <span className="text-sm font-bold" style={{ color: Number(rq) >= 80 ? '#065F46' : Number(rq) >= 60 ? '#92400E' : '#991B1B' }}>
                    {Number(rq) >= 80 ? '✓ Strong' : Number(rq) >= 60 ? '~ Okay' : '✗ Needs work'}
                  </span>
                )}
              </div>
              {rqMissing && <p className="text-[11px] text-[#DC2626] mt-2">RQ mark is required.</p>}
            </FieldCard>
          </>
        )}

        {/* ── 1:1 CLASS FIELD ── */}
        {isOneToOne && !isAbsent && (
          <FieldCard label="Understanding %" required>
            <div className="flex flex-wrap gap-2">
              {UNDERSTANDING_OPTIONS.map(opt => (
                <PillOption key={opt.value} opt={opt} selected={understanding} onSelect={setUnderstanding} disabled={isLocked} />
              ))}
            </div>
            {uMissing && <p className="text-[11px] text-[#DC2626] mt-2">Understanding % is required.</p>}
          </FieldCard>
        )}

        {/* ── NOTES ── */}
        <FieldCard label="Additional comments">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={isLocked}
            rows={3}
            placeholder="Any notes about the session, topics covered, next steps…"
            className="w-full text-sm text-[#2A2035] bg-[#FAF5FF] border border-[#DDD6FE] rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/25 focus:border-[#7C3AED] transition placeholder:text-[#2A2035]/25 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </FieldCard>

        {/* ── ACTIONS ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <Link href="/tutor/classes" className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035] transition">
            ← Back to classes
          </Link>
          {!isLocked ? (
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 disabled:cursor-not-allowed px-6 py-2.5 rounded-full transition shadow-sm"
            >
              {saving ? 'Saving…' : 'Save session + shift →'}
            </button>
          ) : (
            <button
              onClick={() => { setIsLocked(false); setSaved(false); setSaveErr(null) }}
              className="text-sm font-semibold text-[#7C3AED] bg-white border border-[#DDD6FE] hover:bg-[#F5F3FF] px-6 py-2.5 rounded-full transition"
            >
              Edit marks
            </button>
          )}
        </div>

        <p className="text-[10px] text-[#2A2035]/30 pb-4">
          Saving records attendance and marks for this student, and logs a draft payroll shift for approval.
        </p>
      </div>
    </div>
  )
}

function MetaItem({ label, value, span }) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[#5B21B6]/50 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-[#2A2035]">{value}</p>
    </div>
  )
}

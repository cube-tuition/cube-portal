'use client'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllTerms, getCurrentTerm } from '../lib/terms'
import { inferSubject, subjectsMatch } from './CourseDetail'
import { T_ATTENDANCE, T_BOOKLETS, T_ENROLMENTS, T_QUIZ_RESULTS } from '../lib/tables'

/*
 * SessionMarker — the per-session marking UI (workbook + roll + notes).
 *
 * Used by:
 *   • /tutor/classes/[classId]/[date] — single session standalone page
 *   • /tutor/classes/[classId]        — inside week tabs, one per session
 *
 * Props:
 *   classId  — numeric id (required)
 *   dateISO  — YYYY-MM-DD (required)
 *   cls      — class row (required, fetched by parent so we don't double-fetch)
 *   staff    — student row of the signed-in user (required)
 *
 * Self-contained: owns marks/notes/history/save/lock state. Re-fetches when
 * classId or dateISO changes. Parent can mount multiple instances with
 * different keys; each is independent.
 */

// ── Tiny helpers (kept inside the component file so the standalone page
// doesn't need to duplicate them) ──────────────────────────────────────────
function isoToDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}
function parseYearFromCourse(name) {
  if (!name) return null
  const m = String(name).match(/Y(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}
function weekNumberInTerm(date, term) {
  if (!date || !term) return null
  const start = isoToDate(term.start_date)
  const end = isoToDate(term.end_date)
  if (!start || !end) return null
  if (date < start || date > end) return null
  return Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7)) + 1
}
function fmtSavedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export default function SessionMarker({ classId, dateISO, cls, staff, readOnly = false }) {
  const isAdmin = staff?.role === 'admin'
  const date = useMemo(() => isoToDate(dateISO || ''), [dateISO])

  const [roster, setRoster] = useState([])
  const [marks, setMarks] = useState({})
  const [history, setHistory] = useState({})
  const [expanded, setExpanded] = useState(() => new Set())
  const [notesFromCube, setNotesFromCube] = useState('')
  const [notesGeneral,  setNotesGeneral]  = useState('')
  const [notesWorkbook, setNotesWorkbook] = useState('')
  const [notesHomework, setNotesHomework] = useState('')
  const [term, setTerm] = useState(null)
  const [booklet, setBooklet] = useState(null)
  const [bookletWeek, setBookletWeek] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveError, setSaveError] = useState(null)
  const [isLocked, setIsLocked] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [armed, setArmed] = useState(false)
  const [showValidation, setShowValidation] = useState(false)
  const [loading, setLoading] = useState(true)

  // Auto-cancel armed state after 5 s
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(t)
  }, [armed])

  const handleSaveClick = () => {
    if (saving || isLocked) return

    // Validate required fields before arming
    const missing = []
    for (const s of roster) {
      const m = marks[s.id] || {}
      const att = m.attendance || ''
      const isAbsent = att === 'absent' || att === 'excused'
      if (!att) {
        missing.push(`${s.full_name} (attendance)`)
        continue
      }
      if (!isAbsent) {
        const issues = []
        if (!m.hw) issues.push("prev week's HWK")
        if (m.rq === '' || m.rq == null) issues.push('RQ')
        if (issues.length) missing.push(`${s.full_name} (${issues.join(', ')})`)
      }
    }

    if (missing.length > 0) {
      setShowValidation(true)
      setSaveError(`Required fields missing — ${missing.join(' · ')}`)
      setSaveStatus('error')
      return
    }

    setShowValidation(false)
    setSaveError(null)
    setSaveStatus('idle')
    if (!armed) { setArmed(true); return }
    setArmed(false)
    saveSession()
  }

  useEffect(() => {
    if (!classId || !cls || !dateISO || !date) return
    let cancelled = false

    const load = async () => {
      setLoading(true)

      // Roster
      const { data: links } = await supabase
        .from(T_ENROLMENTS)
        .select('students (id, full_name, school, year)')
        .eq('class_id', classId)
      if (cancelled) return
      const students = (links || [])
        .map(l => l.students)
        .filter(Boolean)
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
      setRoster(students)

      // Term + week
      const terms = await fetchAllTerms()
      const containing = (terms || []).find(t =>
        dateISO >= t.start_date && dateISO <= t.end_date
      ) || getCurrentTerm(terms)
      if (cancelled) return
      setTerm(containing)

      const week = weekNumberInTerm(date, containing)
      setBookletWeek(week)

      const subject = inferSubject({ class_name: cls.class_name })
      const weekLabel = week != null ? `Week ${week}` : null

      // Prefill marks
      const studentIds = students.map(s => s.id)
      const seed = {}
      for (const s of students) seed[s.id] = {}
      let anyPriorData = false
      let latestSavedAt = null

      if (studentIds.length > 0) {
        const { data: attRows } = await supabase
          .from(T_ATTENDANCE)
          .select('student_id, status, notes, created_at')
          .eq('class_id', classId)
          .eq('session_date', dateISO)
          .in('student_id', studentIds)
        if (cancelled) return
        for (const a of attRows || []) {
          seed[a.student_id] = {
            ...seed[a.student_id],
            attendance: a.status || '',
            comment: a.notes || '',
          }
          anyPriorData = true
          if (a.created_at && (!latestSavedAt || a.created_at > latestSavedAt)) latestSavedAt = a.created_at
        }

        if (weekLabel) {
          const { data: qzRows } = await supabase
            .from(T_QUIZ_RESULTS)
            .select('student_id, subject, week, score, homework_grade, created_at')
            .in('student_id', studentIds)
            .eq('week', weekLabel)
          if (cancelled) return
          for (const q of qzRows || []) {
            if (!subjectsMatch(q.subject, subject)) continue
            seed[q.student_id] = {
              ...seed[q.student_id],
              hw: q.homework_grade || '',
              rq: q.score != null ? String(q.score) : '',
            }
            anyPriorData = true
            if (q.created_at && (!latestSavedAt || q.created_at > latestSavedAt)) latestSavedAt = q.created_at
          }
        }
      }
      setMarks(seed)
      setIsLocked(anyPriorData)
      setSavedAt(latestSavedAt)

      // History (term-wide)
      const hist = {}
      for (const s of students) hist[s.id] = { quizzes: [], attendance: [] }
      if (containing && studentIds.length > 0) {
        const { data: qzAll } = await supabase
          .from(T_QUIZ_RESULTS)
          .select('student_id, subject, week, score, max_score, homework_grade, quiz_date')
          .in('student_id', studentIds)
          .gte('quiz_date', containing.start_date)
          .lte('quiz_date', containing.end_date)
        if (cancelled) return
        for (const q of qzAll || []) {
          if (!subjectsMatch(q.subject, subject)) continue
          if (q.quiz_date === dateISO) continue
          if (!hist[q.student_id]) hist[q.student_id] = { quizzes: [], attendance: [] }
          hist[q.student_id].quizzes.push(q)
        }
        const { data: attAll } = await supabase
          .from(T_ATTENDANCE)
          .select('student_id, session_date, status, notes')
          .eq('class_id', classId)
          .in('student_id', studentIds)
          .gte('session_date', containing.start_date)
          .lte('session_date', containing.end_date)
        if (cancelled) return
        for (const a of attAll || []) {
          if (a.session_date === dateISO) continue
          if (!hist[a.student_id]) hist[a.student_id] = { quizzes: [], attendance: [] }
          hist[a.student_id].attendance.push(a)
        }
      }
      setHistory(hist)
      setLoading(false)

      // Booklet match
      const year = parseYearFromCourse(cls.class_name)
      if (containing && week != null && week >= 1 && week <= 10) {
        const { data: bks } = await supabase
          .from(T_BOOKLETS)
          .select('id, booklet_name, year, subject, week, term_number, pdf_attachment_ids, pdf_filenames')
          .eq('term_number', containing.term_number)
          .eq('week', week)
        if (cancelled) return
        const match = (bks || []).find(b => {
          if (year != null && b.year != null && b.year !== year) return false
          if (!subjectsMatch(b.subject, subject) && !subjectsMatch(b.subject, cls.class_name)) return false
          return true
        })
        setBooklet(match || null)
      } else {
        setBooklet(null)
      }
    }

    load()
    return () => { cancelled = true }
  }, [classId, dateISO, cls, date])

  const saveSession = async () => {
    if (!cls || roster.length === 0) return
    setSaving(true)
    setSaveStatus('idle')
    setSaveError(null)

    const subject = inferSubject({ class_name: cls.class_name })
    const weekLabel = bookletWeek != null ? `Week ${bookletWeek}` : null
    const errors = []

    for (const s of roster) {
      const m = marks[s.id] || {}
      const hasAttendance = !!m.attendance
      const hasComment    = (m.comment || '').trim() !== ''
      const hasHw         = !!m.hw
      const hasRq         = m.rq !== '' && m.rq != null

      if (hasAttendance || hasComment) {
        try {
          const { data: existing } = await supabase
            .from(T_ATTENDANCE)
            .select('id')
            .eq('class_id', classId)
            .eq('student_id', s.id)
            .eq('session_date', dateISO)
            .limit(1)
          const existingId = existing?.[0]?.id || null
          const payload = {
            class_id: Number(classId),
            student_id: s.id,
            session_date: dateISO,
            status: m.attendance || 'present',
            notes: hasComment ? m.comment.trim() : null,
          }
          const { error } = existingId
            ? await supabase.from(T_ATTENDANCE).update(payload).eq('id', existingId)
            : await supabase.from(T_ATTENDANCE).insert(payload)
          if (error) errors.push(`Attendance · ${s.full_name}: ${error.message}`)
        } catch (e) {
          errors.push(`Attendance · ${s.full_name}: ${e.message}`)
        }
      }

      if ((hasHw || hasRq) && !weekLabel) {
        errors.push(`HW/RQ · ${s.full_name}: can't save — session is outside any term, no week to assign.`)
        continue
      }
      if (hasHw || hasRq) {
        try {
          const { data: existing } = await supabase
            .from(T_QUIZ_RESULTS)
            .select('id, subject')
            .eq('student_id', s.id)
            .eq('week', weekLabel)
            .limit(20)
          const existingRow = (existing || []).find(r => subjectsMatch(r.subject, subject))
          const payload = {
            student_id: s.id,
            subject,
            week: weekLabel,
            score: hasRq ? Number(m.rq) : null,
            max_score: 100,
            quiz_date: dateISO,
            homework_grade: hasHw ? m.hw : null,
          }
          const { error } = existingRow
            ? await supabase.from(T_QUIZ_RESULTS).update(payload).eq('id', existingRow.id)
            : await supabase.from(T_QUIZ_RESULTS).insert(payload)
          if (error) errors.push(`HW/RQ · ${s.full_name}: ${error.message}`)
        } catch (e) {
          errors.push(`HW/RQ · ${s.full_name}: ${e.message}`)
        }
      }
    }

    setSaving(false)
    if (errors.length > 0) {
      setSaveError(errors.join(' • '))
      setSaveStatus('error')
    } else {
      setSaveStatus('saved')
      setIsLocked(true)
      setSavedAt(new Date().toISOString())
      setTimeout(() => setSaveStatus(prev => (prev === 'saved' ? 'idle' : prev)), 4000)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#325099]">Loading session…</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Workbook rendering is now handled by <WeekBooklet /> in the parent
          pages so the booklet is always visible per Wk tab even when there's
          no session to mark. Booklet fetch is still done here as a no-op
          (kept for backward compatibility / unused state). */}

      {/* Mark this session */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
              Mark this session
            </p>
            <h3 className="text-lg font-semibold text-[#2A2035] font-display">Students</h3>
          </div>
          <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
            {roster.length} student{roster.length === 1 ? '' : 's'}
          </span>
        </div>

        {roster.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-4xl mb-3">🪑</div>
            <p className="text-sm font-semibold text-[#2A2035] mb-1">No students linked to this class yet.</p>
            <p className="text-xs text-[#2A2035]/60 max-w-md mx-auto">
              Once students are enrolled, they&rsquo;ll appear on this roster.
            </p>
          </div>
        ) : (
          <MarkTable
            roster={roster}
            marks={marks}
            history={history}
            term={term}
            currentWeek={bookletWeek}
            expanded={expanded}
            onToggleExpand={(sid) => setExpanded(prev => {
              const next = new Set(prev)
              if (next.has(sid)) next.delete(sid); else next.add(sid)
              return next
            })}
            onChange={(studentId, field, value) =>
              setMarks(prev => ({
                ...prev,
                [studentId]: { ...(prev[studentId] || {}), [field]: value },
              }))
            }
            isLocked={isLocked || readOnly}
            savedAt={savedAt}
            onEdit={readOnly ? undefined : () => { setIsLocked(false); setShowValidation(false); setSaveError(null); setSaveStatus('idle') }}
            showValidation={showValidation}
            isOneToOne={/1.?:?.?1/i.test(cls?.class_name || '')}
          />
        )}

        {/* Notes (split: From CUBE / To CUBE → general/workbook/homework) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <NotesBox
            label="Notes from CUBE"
            sub="Admin → tutor. Heads-ups, guidance, asks."
            value={notesFromCube}
            onChange={setNotesFromCube}
            editable={isAdmin && !readOnly}
            placeholder={isAdmin && !readOnly ? 'Anything the admin should know about this session…' : 'Nothing from admin yet.'}
          />
          <NotesGroup
            label="Notes to CUBE"
            sub="Tutor → admin. How the session went, workbook tweaks, homework set."
            editable={staff?.role === 'tutor' && !readOnly}
            sections={[
              { key: 'general',  label: 'General',                  value: notesGeneral,  onChange: setNotesGeneral,
                placeholder: staff?.role === 'tutor' ? 'How the session went, blockers, asks…' : 'Nothing from the tutor yet.' },
              { key: 'workbook', label: 'Workbook changes / fixes', value: notesWorkbook, onChange: setNotesWorkbook,
                placeholder: staff?.role === 'tutor' ? 'Typos, unclear questions, suggested edits…' : '—' },
              { key: 'homework', label: 'Homework given',           value: notesHomework, onChange: setNotesHomework,
                placeholder: staff?.role === 'tutor' ? 'Pages, exercises, extra practice assigned…' : '—' },
            ]}
          />
        </div>
      </div>

      {/* Save session — always the last element */}
      {roster.length > 0 && (
        readOnly ? (
          <div className="bg-[#FEF3C7] rounded-2xl border border-[#FDE68A] px-5 py-4 flex items-center gap-3">
            <span className="text-lg">🔒</span>
            <p className="text-[11px] font-semibold text-[#92400E]">
              This session is covered by a substitute teacher. Marking is read-only for you.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-[#2A2035]/60 flex-1 min-w-[200px]">
              {saveError ? (
                <span className="text-[#B23A3A] font-semibold">{saveError}</span>
              ) : saveStatus === 'saved' ? (
                <span className="text-[#065F46] font-semibold">✓ Saved — these marks now show on the student portal.</span>
              ) : armed ? (
                <span className="text-[#991B1B] font-semibold">⚠ Click confirm to commit. Auto-cancels in 5s.</span>
              ) : isLocked ? (
                <span>Session locked. Press <strong>Edit</strong> to modify.</span>
              ) : (
                <span>By saving this session, your shift will be recorded for payroll. Please ensure all required lesson details have been completed before saving.</span>
              )}
            </div>
            {isLocked ? (
              <button type="button" onClick={() => { setArmed(false); setIsLocked(false) }}
                className="text-xs font-semibold bg-white text-[#062E63] border border-[#DEE7FF] hover:bg-[#F8FAFF] px-4 py-2 rounded-full transition">
                Edit
              </button>
            ) : (
              <button type="button" onClick={handleSaveClick} disabled={saving}
                className={`text-xs font-semibold px-5 py-2 rounded-full transition ${
                  armed ? 'bg-[#B23A3A] text-white hover:bg-[#991B1B]' : 'bg-[#325099] text-white hover:bg-[#062E63]'
                } disabled:opacity-60`}>
                {saving ? 'Saving…' : armed ? 'Click again to confirm' : 'Save session'}
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal sub-components (lifted unchanged from the original per-date page)
// ─────────────────────────────────────────────────────────────────────────────

const ATTENDANCE_OPTIONS = [
  { value: '',         label: '—',       bg: '#ffffff', fg: '#9CA3AF' },
  { value: 'present',  label: 'Present', bg: '#D1FAE5', fg: '#065F46' },
  { value: 'late',     label: 'Late',    bg: '#FEF3C7', fg: '#92400E' },
  { value: 'absent',   label: 'Absent',  bg: '#FEE2E2', fg: '#991B1B' },
]
const GRADE_OPTIONS = [
  { value: '',  label: '—', bg: '#ffffff', fg: '#9CA3AF' },
  { value: 'A', label: 'A', bg: '#D1FAE5', fg: '#065F46' },
  { value: 'B', label: 'B', bg: '#DEE7FF', fg: '#062E63' },
  { value: 'C', label: 'C', bg: '#FEF3C7', fg: '#92400E' },
  { value: 'D', label: 'D', bg: '#FFEDD5', fg: '#9A3412' },
  { value: 'E', label: 'E', bg: '#FEE2E2', fg: '#991B1B' },
]
const HW_COLOR = {
  A: { bg:'#D1FAE5', fg:'#065F46' }, B: { bg:'#DEE7FF', fg:'#062E63' },
  C: { bg:'#FEF3C7', fg:'#92400E' }, D: { bg:'#FFEDD5', fg:'#9A3412' },
  E: { bg:'#FEE2E2', fg:'#991B1B' },
}
const ATTEND_COLOR = {
  present: { bg:'#D1FAE5', fg:'#065F46', label:'Present' },
  late:    { bg:'#FEF3C7', fg:'#92400E', label:'Late'    },
  absent:  { bg:'#FEE2E2', fg:'#991B1B', label:'Absent'  },
  excused: { bg:'#E0E7FF', fg:'#3730A3', label:'Excused' },
}

function rowTint(att) {
  if (att === 'present') return '#F0FDF4'
  if (att === 'late')    return '#FFFBEB'
  if (att === 'absent')  return '#FEF2F2'
  return ''
}
function numberTier(n) {
  if (n >= 80) return { bg: '#D1FAE5', fg: '#065F46' }
  if (n >= 70) return { bg: '#DEE7FF', fg: '#062E63' }
  if (n >= 60) return { bg: '#FEF3C7', fg: '#92400E' }
  if (n >= 50) return { bg: '#FFEDD5', fg: '#9A3412' }
  return            { bg: '#FEE2E2', fg: '#991B1B' }
}
function weekNumberFromLabel(label) {
  const m = String(label || '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}
function buildHistoryByWeek({ quizzes, attendance, term, currentWeek }) {
  const map = new Map()
  for (const q of quizzes) {
    const w = weekNumberFromLabel(q.week)
    if (!Number.isFinite(w)) continue
    if (w === currentWeek) continue
    if (!map.has(w)) map.set(w, { week: w })
    map.get(w).quiz = q
  }
  for (const a of attendance) {
    if (!term) continue
    const [y, mo, d] = (a.session_date || '').split('-').map(Number)
    if (!y) continue
    const dt = new Date(y, mo - 1, d)
    const [sy, sm, sd] = term.start_date.split('-').map(Number)
    const start = new Date(sy, sm - 1, sd)
    const ms = dt.getTime() - start.getTime()
    if (ms < 0) continue
    const w = Math.floor(ms / (1000 * 60 * 60 * 24 * 7)) + 1
    if (w === currentWeek) continue
    if (!map.has(w)) map.set(w, { week: w })
    map.get(w).att = a
  }
  return [...map.values()].sort((x, y) => x.week - y.week)
}

const UNDERSTANDING_OPTIONS = [
  { value: '',    label: '—',    bg: '#ffffff', fg: '#9CA3AF' },
  { value: '100', label: '100%', bg: '#D1FAE5', fg: '#065F46' },
  { value: '90',  label: '90%',  bg: '#D1FAE5', fg: '#065F46' },
  { value: '80',  label: '80%',  bg: '#DEE7FF', fg: '#062E63' },
  { value: '70',  label: '70%',  bg: '#DEE7FF', fg: '#062E63' },
  { value: '60',  label: '60%',  bg: '#FEF3C7', fg: '#92400E' },
  { value: '50',  label: '50%',  bg: '#FEF3C7', fg: '#92400E' },
  { value: '40',  label: '40%',  bg: '#FFEDD5', fg: '#9A3412' },
  { value: '30',  label: '30%',  bg: '#FFEDD5', fg: '#9A3412' },
  { value: '20',  label: '20%',  bg: '#FEE2E2', fg: '#991B1B' },
  { value: '10',  label: '10%',  bg: '#FEE2E2', fg: '#991B1B' },
  { value: '0',   label: '0%',   bg: '#FEE2E2', fg: '#991B1B' },
]

function MarkTable({
  roster, marks, history, term, currentWeek,
  expanded, onToggleExpand,
  onChange,
  isLocked, savedAt, onEdit,
  isOneToOne,
  showValidation,
}) {

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      {isLocked && (
        <div className="px-5 py-3 bg-[#F0FDF4] border-b border-[#A7F3D0] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[#065F46]">
            <span className="text-base">🔒</span>
            <span className="font-semibold">Session saved &mdash; read only.</span>
            {savedAt && (
              <span className="text-[#065F46]/70 hidden sm:inline">Last saved {fmtSavedAt(savedAt)}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setArmed(false); onEdit?.() }}
            className="text-xs font-semibold bg-white text-[#065F46] border border-[#A7F3D0] hover:bg-[#D1FAE5] px-4 py-1.5 rounded-full transition"
          >
            Edit
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
              <Th className="text-left pl-5 pr-3 w-[26%]">Student name</Th>
              <Th className="text-center px-3 w-[14%]">Attendance <span className="text-[#EF4444]">*</span></Th>
              <Th className="text-center px-3 w-[14%]">HW completion <span className="text-[#EF4444]">*</span></Th>
              <Th className="text-center px-3 w-[14%]">{isOneToOne ? 'Understanding %' : 'RQ mark %'} <span className="text-[#EF4444]">*</span></Th>
              <Th className="text-left px-5 bg-[#EEF4FF] text-[#062E63]">Additional comments</Th>
            </tr>
          </thead>
          <tbody>
            {roster.map(s => {
              const m = marks[s.id] || {}
              const att = m.attendance || ''
              const isAbsent = att === 'absent' || att === 'excused'
              const tint = rowTint(att)
              const isOpen = expanded?.has(s.id)
              const sHist = history?.[s.id] || { quizzes: [], attendance: [] }

              // Validation highlights — only shown after a failed save attempt
              const attInvalid = showValidation && !att
              const hwInvalid  = showValidation && !isAbsent && att && !m.hw
              const rqInvalid  = showValidation && !isAbsent && att && (m.rq === '' || m.rq == null)

              return (
                <Fragment key={s.id}>
                  <tr className="border-b last:border-0 border-[#DEE7FF] transition-colors"
                      style={tint ? { background: tint } : undefined}>
                    <td className="pl-5 pr-3 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => onToggleExpand?.(s.id)}
                          aria-label={isOpen ? 'Hide history' : 'Show history'}
                          className="w-8 h-8 rounded-full bg-[#062E63] text-white text-[11px] font-bold flex items-center justify-center shrink-0 hover:bg-[#325099] transition"
                        >
                          {(s.full_name || '?').slice(0, 1).toUpperCase()}
                        </button>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#2A2035] truncate leading-tight">
                            {s.full_name || 'Unknown'}
                          </p>
                          <button
                            type="button"
                            onClick={() => onToggleExpand?.(s.id)}
                            className="text-[10px] text-[#325099]/80 hover:text-[#062E63] truncate transition text-left"
                          >
                            {s.school || '—'} · Y{s.year || '?'} · {isOpen ? 'Hide history ↑' : 'Term history ↓'}
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className={attInvalid ? 'rounded-full ring-2 ring-[#EF4444]' : ''}>
                        <PillSelect value={att} options={ATTENDANCE_OPTIONS}
                                    onChange={v => onChange(s.id, 'attendance', v)} disabled={isLocked} />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className={hwInvalid ? 'rounded-full ring-2 ring-[#EF4444]' : ''}>
                        <PillSelect value={m.hw || ''} options={GRADE_OPTIONS}
                                    onChange={v => onChange(s.id, 'hw', v)} disabled={isLocked || isAbsent} />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className={rqInvalid ? 'rounded-full ring-2 ring-[#EF4444]' : ''}>
                        {isOneToOne ? (
                          <PillSelect
                            value={m.rq || ''}
                            options={UNDERSTANDING_OPTIONS}
                            onChange={v => onChange(s.id, 'rq', v)}
                            disabled={isLocked || isAbsent}
                          />
                        ) : (
                          <NumberPill value={m.rq || ''} min={1} max={100}
                                      onChange={v => onChange(s.id, 'rq', v)} disabled={isLocked || isAbsent} />
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 bg-[#F5F8FF]/60">
                      <input
                        type="text"
                        value={m.comment || ''}
                        onChange={e => onChange(s.id, 'comment', e.target.value)}
                        placeholder="Notes about this lesson…"
                        disabled={isLocked}
                        className="w-full bg-white border border-[#DEE7FF] rounded-lg px-3 py-1.5 text-xs text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition disabled:bg-[#F8FAFF] disabled:text-[#2A2035]/70 disabled:cursor-not-allowed"
                      />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b last:border-0 border-[#DEE7FF]" style={{ background: '#FBFCFF' }}>
                      <td colSpan={5} className="px-5 md:px-6 py-4">
                        <HistoryPanel student={s} quizzes={sHist.quizzes} attendance={sHist.attendance}
                                      term={term} currentWeek={currentWeek} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, className = '' }) {
  return (
    <th className={`py-3 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] ${className}`}>
      {children}
    </th>
  )
}

function PillSelect({ value, options, onChange, disabled = false }) {
  const opt = options.find(o => o.value === value) || options[0]
  const isEmpty = !value
  if (disabled) {
    return (
      <span className="inline-flex w-full justify-center items-center text-xs font-semibold rounded-full border px-2.5 py-1.5 cursor-default opacity-90"
        style={{ background: opt.bg, color: opt.fg, borderColor: isEmpty ? '#DEE7FF' : opt.fg + '40' }}>
        {opt.label}
      </span>
    )
  }
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full text-xs font-semibold rounded-full border px-2.5 py-1.5 pr-6 cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-[#325099]/30 text-center"
      style={{ background: opt.bg, color: opt.fg, borderColor: isEmpty ? '#DEE7FF' : opt.fg + '40' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function NumberPill({ value, min = 1, max = 100, onChange, disabled = false }) {
  const isEmpty = value === '' || value === null || value === undefined
  const n = isEmpty ? null : Number(value)
  const valid = n !== null && !Number.isNaN(n)
  const tier = valid ? numberTier(n) : { bg: '#ffffff', fg: '#9CA3AF' }
  if (disabled) {
    return (
      <span className="inline-flex w-full justify-center items-center text-xs font-semibold rounded-full border px-2 py-1.5 tabular-nums cursor-default opacity-90"
        style={{ background: tier.bg, color: tier.fg, borderColor: valid ? tier.fg + '40' : '#DEE7FF' }}>
        {isEmpty ? '—' : String(value)}
      </span>
    )
  }
  return (
    <input type="number" inputMode="numeric" min={min} max={max}
      value={isEmpty ? '' : String(value)} placeholder="—"
      onChange={e => {
        const raw = e.target.value
        if (raw === '') { onChange(''); return }
        const num = Number(raw)
        if (Number.isNaN(num)) return
        onChange(String(Math.max(min, Math.min(max, Math.floor(num)))))
      }}
      className="w-full text-xs font-semibold rounded-full border px-2 py-1.5 text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-[#325099]/30 transition"
      style={{ background: tier.bg, color: tier.fg, borderColor: valid ? tier.fg + '40' : '#DEE7FF' }} />
  )
}

function HistoryPanel({ student, quizzes, attendance, term, currentWeek }) {
  const rows = useMemo(
    () => buildHistoryByWeek({ quizzes, attendance, term, currentWeek }),
    [quizzes, attendance, term, currentWeek]
  )
  const stats = useMemo(() => {
    const scored = quizzes.filter(q => q.score != null).map(q => Number(q.score))
    const avgRq = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null
    const hwGrades = quizzes.map(q => q.homework_grade).filter(Boolean)
    let hwMode = null
    if (hwGrades.length > 0) {
      const freq = {}
      let maxFreq = 0
      for (const g of hwGrades) {
        freq[g] = (freq[g] || 0) + 1
        if (freq[g] > maxFreq) { maxFreq = freq[g]; hwMode = g }
      }
    }
    const attTotal = attendance.length
    const attHere  = attendance.filter(a => a.status === 'present' || a.status === 'late').length
    const attPct   = attTotal > 0 ? Math.round((attHere / attTotal) * 100) : null
    return { avgRq, hwMode, attPct, scored: scored.length, hwTotal: hwGrades.length, attTotal }
  }, [quizzes, attendance])

  if (rows.length === 0 && stats.attTotal === 0 && stats.scored === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-xs font-semibold text-[#2A2035]/60">
          No prior sessions or quizzes for {student.full_name || 'this student'} this term yet.
        </p>
      </div>
    )
  }
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <SummaryTile label="RQ Average"
          value={stats.avgRq == null ? '—' : `${stats.avgRq}`}
          sub={stats.scored ? `${stats.scored} quiz${stats.scored === 1 ? '' : 'zes'}` : 'no quizzes'}
          tone={stats.avgRq == null ? 'neutral' : stats.avgRq >= 70 ? 'good' : stats.avgRq >= 50 ? 'warn' : 'bad'} />
        <SummaryTile label="Prev week's HWK"
          value={stats.hwMode ?? '—'}
          sub={stats.hwTotal ? `${stats.hwTotal} week${stats.hwTotal === 1 ? '' : 's'}` : 'no data'}
          tone={stats.hwMode == null ? 'neutral' : (stats.hwMode === 'A' || stats.hwMode === 'B') ? 'good' : stats.hwMode === 'C' ? 'warn' : 'bad'} />
        <SummaryTile label="Attendance"
          value={stats.attPct == null ? '—' : `${stats.attPct}%`}
          sub={stats.attTotal ? `${stats.attTotal} session${stats.attTotal === 1 ? '' : 's'}` : 'no data'}
          tone={stats.attPct == null ? 'neutral' : stats.attPct >= 90 ? 'good' : stats.attPct >= 75 ? 'warn' : 'bad'} />
      </div>
      <div className="rounded-xl border border-[#DEE7FF] bg-white overflow-hidden">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
              <Th className="text-left pl-4 pr-2 py-2 w-[18%]">Week</Th>
              <Th className="text-left px-2 py-2 w-[22%]">Date</Th>
              <Th className="text-center px-2 py-2 w-[20%]">Attendance</Th>
              <Th className="text-center px-2 py-2 w-[18%]">Prev week's HWK</Th>
              <Th className="text-center px-2 py-2 w-[22%]">RQ</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-[11px] text-[#2A2035]/50 py-4">No weekly data yet.</td></tr>
            ) : rows.map(r => {
              const att = r.att ? ATTEND_COLOR[r.att.status] : null
              const hw = r.quiz?.homework_grade ? HW_COLOR[r.quiz.homework_grade] : null
              return (
                <tr key={r.week} className="border-b last:border-0 border-[#DEE7FF]">
                  <td className="pl-4 pr-2 py-2 font-semibold text-[#2A2035]">Week {r.week}</td>
                  <td className="px-2 py-2 text-[#2A2035]/60 tabular-nums">{r.att?.session_date || r.quiz?.quiz_date || '—'}</td>
                  <td className="px-2 py-2 text-center">
                    {att ? <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: att.bg, color: att.fg }}>{att.label}</span> : <span className="text-[#2A2035]/30">—</span>}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {hw ? <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: hw.bg, color: hw.fg }}>{r.quiz.homework_grade}</span> : <span className="text-[#2A2035]/30">—</span>}
                  </td>
                  <td className="px-2 py-2 text-center font-semibold tabular-nums">
                    {r.quiz?.score != null ? <span style={{ color: numberTier(Number(r.quiz.score)).fg }}>{r.quiz.score}</span> : <span className="text-[#2A2035]/30">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SummaryTile({ label, value, sub, tone }) {
  const toneStyle = {
    good:    { bg: '#D1FAE5', fg: '#065F46' },
    warn:    { bg: '#FEF3C7', fg: '#92400E' },
    bad:     { bg: '#FEE2E2', fg: '#991B1B' },
    neutral: { bg: '#F8FAFF', fg: '#325099' },
  }[tone] || { bg: '#F8FAFF', fg: '#325099' }
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/80 font-semibold truncate">{label}</p>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: toneStyle.bg, color: toneStyle.fg }}>●</span>
      </div>
      <p className="text-lg font-bold text-[#2A2035] font-display tabular-nums">{value}</p>
      <p className="text-[10px] text-[#2A2035]/50">{sub}</p>
    </div>
  )
}

function NotesGroup({ label, sub, editable, sections }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden flex flex-col">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">{label}</p>
          <p className="text-[11px] text-[#2A2035]/50">{sub}</p>
        </div>
        <span className={`shrink-0 text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full ${
          editable ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#F4F4F4] text-[#9CA3AF]'
        }`}>
          {editable ? '✎ Editable' : '🔒 Read only'}
        </span>
      </div>
      <div className="px-5 pb-5 flex-1 space-y-3">
        {sections.map(sec => (
          <div key={sec.key}>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-[#325099]/80 font-semibold mb-1">{sec.label}</label>
            <textarea
              value={sec.value}
              onChange={editable ? e => sec.onChange(e.target.value) : undefined}
              readOnly={!editable}
              placeholder={sec.placeholder}
              rows={3}
              className={`w-full rounded-xl border px-3 py-2 text-sm leading-relaxed resize-y transition focus:outline-none ${
                editable
                  ? 'bg-[#F8FAFF] border-[#DEE7FF] text-[#2A2035] placeholder:text-[#2A2035]/30 focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099]'
                  : 'bg-[#F4F4F4] border-[#E5E7EB] text-[#2A2035]/70 placeholder:text-[#2A2035]/40 cursor-not-allowed'
              }`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function NotesBox({ label, sub, value, onChange, editable, placeholder }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden flex flex-col">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">{label}</p>
          <p className="text-[11px] text-[#2A2035]/50">{sub}</p>
        </div>
        <span className={`shrink-0 text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full ${
          editable ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#F4F4F4] text-[#9CA3AF]'
        }`}>
          {editable ? '✎ Editable' : '🔒 Read only'}
        </span>
      </div>
      <div className="px-5 pb-5 flex-1">
        <textarea
          value={value}
          onChange={editable ? e => onChange(e.target.value) : undefined}
          readOnly={!editable}
          placeholder={placeholder}
          rows={6}
          className={`w-full rounded-xl border px-4 py-3 text-sm leading-relaxed resize-y transition focus:outline-none ${
            editable
              ? 'bg-[#F8FAFF] border-[#DEE7FF] text-[#2A2035] placeholder:text-[#2A2035]/30 focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099]'
              : 'bg-[#F4F4F4] border-[#E5E7EB] text-[#2A2035]/70 placeholder:text-[#2A2035]/40 cursor-not-allowed'
          }`}
        />
      </div>
    </div>
  )
}

function WorkbookSection({ booklet, term, week, cls }) {
  if (!term || week == null) {
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-8 text-center">
        <div className="text-3xl mb-2">📅</div>
        <p className="text-sm font-semibold text-[#2A2035] mb-1">This session falls outside any term window.</p>
        <p className="text-xs text-[#2A2035]/60 max-w-md mx-auto">We can only match a booklet once the date sits inside a term.</p>
      </div>
    )
  }
  if (!booklet) {
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-8 text-center">
        <div className="text-3xl mb-2">📭</div>
        <p className="text-sm font-semibold text-[#2A2035] mb-1">No booklet uploaded for Week {week} yet.</p>
        <p className="text-xs text-[#2A2035]/60 max-w-md mx-auto">
          Once a Week {week} booklet for {cls?.class_name || 'this course'} is synced from Airtable, it&rsquo;ll appear here.
        </p>
      </div>
    )
  }
  const ids = booklet.pdf_attachment_ids || []
  const names = booklet.pdf_filenames || []
  if (ids.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
        <div className="flex items-center gap-3">
          <WeekChip n={week} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#2A2035] truncate">{booklet.booklet_name}</p>
            <p className="text-[11px] text-[#2A2035]/50">No PDF attached to this booklet yet.</p>
          </div>
        </div>
      </div>
    )
  }
  return <BookletPanel booklet={booklet} week={week} cls={cls} ids={ids} names={names} />
}

function BookletPanel({ booklet, week, cls, ids, names }) {
  const [viewing, setViewing] = useState(null)
  if (viewing) {
    const filename = viewing.filename
    const href = `/api/booklet/${booklet.id}/pdf/${viewing.idx}`
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
        <div className="px-5 md:px-6 py-4 border-b border-[#DEE7FF] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setViewing(null)}
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] px-3 py-1.5 rounded-full hover:bg-[#F8FAFF] transition shrink-0">
              ← Back
            </button>
            <WeekChip n={week} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#2A2035] font-display truncate">{booklet.booklet_name}</p>
              <p className="text-[11px] text-[#2A2035]/50 truncate">
                {filename}
                {ids.length > 1 && <> · {viewing.idx + 1} of {ids.length}</>}
                {cls?.class_name && <> · {cls.class_name}</>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a href={href} download={filename}
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] px-3 py-2 rounded-full hover:bg-[#F8FAFF] transition">
              ↓ Download
            </a>
            <a href={href} target="_blank" rel="noopener noreferrer"
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] transition">
              Open in new tab ↗
            </a>
          </div>
        </div>
        <iframe key={`${booklet.id}-${viewing.idx}`} src={href}
          className="w-full" style={{ height: '75vh', border: 'none' }} title={booklet.booklet_name} />
      </div>
    )
  }
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="px-5 md:px-6 py-4 border-b border-[#DEE7FF] flex items-center gap-3">
        <WeekChip n={week} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#2A2035] truncate">{booklet.booklet_name}</p>
          <p className="text-[11px] text-[#2A2035]/50">
            {ids.length} PDF{ids.length === 1 ? '' : 's'}
            {cls?.class_name && <> · {cls.class_name}</>}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-[#DEE7FF]">
        {ids.map((_, i) => {
          const filename = names[i] || `Booklet ${i + 1}.pdf`
          const href = `/api/booklet/${booklet.id}/pdf/${i}`
          return (
            <li key={i} className="px-5 md:px-6 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-[#FEE2E2] text-[#991B1B] flex items-center justify-center text-xs font-bold shrink-0">PDF</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#2A2035] truncate">{filename}</p>
                  <p className="text-[11px] text-[#2A2035]/50 truncate">
                    {ids.length > 1 ? `${i + 1} of ${ids.length}` : 'Single PDF'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={href} download={filename}
                  className="text-xs font-semibold text-[#325099] hover:text-[#062E63] px-3 py-2 rounded-full hover:bg-[#F8FAFF] transition">
                  ↓ Download
                </a>
                <button type="button" onClick={() => setViewing({ idx: i, filename })}
                  className="text-xs font-semibold bg-[#325099] text-white px-4 py-2 rounded-full hover:bg-[#062E63] transition">
                  View →
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function WeekChip({ n }) {
  return (
    <div className="w-11 h-11 rounded-xl flex flex-col items-center justify-center shrink-0 border border-[#DEE7FF] bg-[#F8FAFF]">
      <span className="text-[8px] tracking-widest uppercase font-bold text-[#325099] leading-none">Wk</span>
      <span className="text-sm font-bold text-[#062E63] tabular-nums leading-tight mt-0.5">{n}</span>
    </div>
  )
}

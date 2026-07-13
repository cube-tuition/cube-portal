'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import { fetchAllTerms, getEnrolmentTerm, formatTermLabel } from '../../../../lib/terms'
import {
  T_CLASSES, T_COURSES, T_TUTORS, T_ADMINS, T_TEACHER_AVAILABILITY, T_ENROLMENTS, T_TERMS, T_STUDENTS,
} from '../../../../lib/tables'
import TutorNav from '../../../../components/TutorNav'
import { listDrafts, createDraft, loadDraft, saveDraft, renameDraft, deleteDraft } from '../../../../lib/timetableDrafts'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_START = 8          // 8:00 am — top of the grid
const DAY_END   = 21         // 9:00 pm — bottom of the grid
const HOUR_PX   = 56         // pixel height of one hour
const SNAP_MIN  = 15         // drag snaps to 15-minute increments

// Ordered for maximum hue separation among the first ~10 entries so adjacent
// teachers never look alike (e.g. Amber=blue vs Ryan=lime).
const CHIP_COLORS = [
  { bg: '#E8F0FE', text: '#1D4ED8', border: '#BCD3FB' },  // blue
  { bg: '#FFF1E8', text: '#C2410C', border: '#FED0B4' },  // orange
  { bg: '#E7FBEF', text: '#047857', border: '#A7F3D0' },  // green
  { bg: '#F6EEFF', text: '#7C3AED', border: '#DDD0FB' },  // purple
  { bg: '#FEECEC', text: '#DC2626', border: '#FBC4C4' },  // red
  { bg: '#E6FAFC', text: '#0E7490', border: '#A8ECF5' },  // teal
  { bg: '#FDEBF4', text: '#BE185D', border: '#FAC4DE' },  // pink
  { bg: '#FCF6E3', text: '#A16207', border: '#F4E2A6' },  // amber/gold
  { bg: '#F1FADF', text: '#4D7C0F', border: '#D6EFA0' },  // lime
  { bg: '#EAEBFD', text: '#4338CA', border: '#C9CAF8' },  // indigo
  { bg: '#FFEEF0', text: '#9F1239', border: '#FCC4CD' },  // rose
  { bg: '#E6F5FE', text: '#0369A1', border: '#B6E1FB' },  // sky
]
const GREY = { bg: '#F1F3F7', text: '#5B6477', border: '#D4D9E3' }
// Fixed colour overrides for specific staff (by lower-cased full name).
const COLOR_OVERRIDES = {
  'ryan park': { bg: '#CBD9F7', text: '#1E40AF', border: '#A9C0EF' },  // pastel cornflower blue
  'kevin park': { bg: '#BCE5CB', text: '#066B45', border: '#92D3AC' },  // slightly darker pastel green
}

// ── Time helpers ────────────────────────────────────────────────────────────────
function parseTime(str) {
  if (!str) return null
  const s = String(str).trim().toLowerCase()
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const ap = m[3]
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return h * 60 + min
}
const toHHMM = (mins) => {
  const h = Math.floor(mins / 60), m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
function fmtTime(mins) {
  if (mins == null) return ''
  const h = Math.floor(mins / 60), m = mins % 60
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${period}`
}
// A class is "on the timetable" once it has a day + a valid start/end time.
function isPlaced(c) {
  const s = parseTime(c.start_time), e = parseTime(c.end_time)
  return !!c.day_of_week && s != null && e != null && e > s
}

// ── Edit / add modal ─────────────────────────────────────────────────────────────
function ClassModal({ entry, courses, tutors, rooms = [], onClose, onSave, onRemove, onDelete,
                      draftMode = false, studentsById = {}, allStudents = [], otherClasses = [],
                      onAddStudent, onRemoveStudent, onMoveStudent }) {
  const [stuQuery, setStuQuery] = useState('')  // add-student typeahead (draft mode)
  const [form, setForm] = useState(() => ({
    course_id : entry.course_id ?? '',
    class_name: entry.class_name ?? '',
    tutor_id  : entry.tutor_id ?? '',
    room      : entry.room ?? '',
    day_of_week: entry.day_of_week || 'Monday',
    start_time: toHHMM(parseTime(entry.start_time) ?? 16 * 60),
    end_time  : toHHMM(parseTime(entry.end_time) ?? 17 * 60),
  }))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const isNew = !entry.id

  // Enrolled students for this class (current roster — not yet ended). In draft
  // mode the roster comes from entry.student_ids instead (edited locally).
  const [students, setStudents] = useState(entry.id ? null : [])
  useEffect(() => {
    if (!entry.id || draftMode) return
    let active = true
    ;(async () => {
      const { data } = await supabase.from(T_ENROLMENTS)
        .select('id, status, ended_at, student:students(id, full_name, year)')
        .eq('class_id', entry.id)
      if (!active) return
      const list = (data || [])
        .filter(r => !r.ended_at && r.student)
        .map(r => ({ ...r.student, status: r.status }))
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
      setStudents(list)
    })()
    return () => { active = false }
  }, [entry.id, draftMode])

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] p-6 w-[26rem] max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <p className="text-lg font-bold text-[#062E63]">{isNew ? 'New class' : 'Edit class'}</p>
          <button onClick={onClose} className="text-[#325099]/30 hover:text-[#325099] text-xl leading-none">✕</button>
        </div>

        {isNew && (
          <p className="text-[11px] text-[#325099]/60 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-3 py-2 mb-4">
            This creates a brand-new class in the database for this term.
          </p>
        )}

        <div className="space-y-3.5">
          <div>
            <label className="text-xs font-semibold text-[#062E63]">Course</label>
            <select
              value={form.course_id}
              onChange={e => set('course_id', e.target.value)}
              className="mt-1 w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#325099]"
            >
              <option value="">— none —</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>{c.course_code ? `${c.course_code} · ` : ''}{c.course_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#062E63]">Class name</label>
            <input
              value={form.class_name}
              onChange={e => set('class_name', e.target.value)}
              placeholder="e.g. Year 9 Maths (Kevin)"
              className="mt-1 w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#325099]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#062E63]">Teacher</label>
              <select
                value={form.tutor_id}
                onChange={e => set('tutor_id', e.target.value)}
                className="mt-1 w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#325099]"
              >
                <option value="">— unassigned —</option>
                {tutors.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#062E63]">Room</label>
              <select
                value={form.room}
                onChange={e => set('room', e.target.value)}
                className="mt-1 w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#325099]"
              >
                <option value="">— none —</option>
                {rooms.map(r => <option key={r} value={r}>{r}</option>)}
                {form.room && !rooms.includes(form.room) && <option value={form.room}>{form.room}</option>}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#062E63]">Day</label>
            <select
              value={form.day_of_week}
              onChange={e => set('day_of_week', e.target.value)}
              className="mt-1 w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#325099]"
            >
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#062E63]">Start</label>
              <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)}
                className="mt-1 w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#325099]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#062E63]">End</label>
              <input type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)}
                className="mt-1 w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#325099]" />
            </div>
          </div>
        </div>

        {!isNew && draftMode && (() => {
          const roster = (entry.student_ids || [])
            .map(id => ({ id, name: studentsById[id]?.full_name || 'Unknown student', year: studentsById[id]?.year }))
            .sort((a, b) => a.name.localeCompare(b.name))
          const inClass = new Set(entry.student_ids || [])
          const q = stuQuery.trim().toLowerCase()
          const matches = q
            ? allStudents.filter(s => !inClass.has(s.id) && (s.full_name || '').toLowerCase().includes(q)).slice(0, 8)
            : []
          return (
            <div className="mt-4 pt-4 border-t border-[#EEF2FB]">
              <p className="text-xs font-semibold text-[#062E63] mb-2">
                Students <span className="text-[#325099]/50 font-normal">({roster.length})</span>
                <span className="text-[#325099]/40 font-normal"> · draft — applied on “Apply to live”</span>
              </p>
              {roster.length === 0 ? (
                <p className="text-xs text-[#325099]/40 italic mb-2">No students in this class yet.</p>
              ) : (
                <div className="space-y-1 mb-2">
                  {roster.map(s => (
                    <div key={s.id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate text-[#325099]">{s.name}{s.year ? ` · ${s.year}` : ''}</span>
                      {otherClasses.length > 0 && (
                        <select
                          value=""
                          onChange={e => { if (e.target.value) onMoveStudent(s.id, Number(e.target.value)) }}
                          className="text-[11px] border border-[#DEE7FF] rounded-lg px-1.5 py-0.5 bg-white text-[#325099] max-w-[8rem]"
                          title="Move to another class"
                        >
                          <option value="">Move to…</option>
                          {otherClasses.map(c => <option key={c.id} value={c.id}>{c.class_name}</option>)}
                        </select>
                      )}
                      <button onClick={() => onRemoveStudent(s.id)} className="text-red-400 hover:text-red-600" title="Remove from class">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative">
                <input
                  value={stuQuery}
                  onChange={e => setStuQuery(e.target.value)}
                  placeholder="+ Add student — type a name"
                  className="w-full border border-[#DEE7FF] rounded-xl px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]"
                />
                {matches.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#DEE7FF] rounded-xl shadow-lg max-h-44 overflow-y-auto">
                    {matches.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { onAddStudent(s.id); setStuQuery('') }}
                        className="w-full text-left px-3 py-1.5 text-xs text-[#325099] hover:bg-[#F0F4FF]"
                      >
                        {s.full_name}{s.year ? ` · ${s.year}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {!isNew && !draftMode && (
          <div className="mt-4 pt-4 border-t border-[#EEF2FB]">
            <p className="text-xs font-semibold text-[#062E63] mb-2">
              Students {students ? <span className="text-[#325099]/50 font-normal">({students.length})</span> : ''}
            </p>
            {students === null ? (
              <p className="text-xs text-[#325099]/40">Loading…</p>
            ) : students.length === 0 ? (
              <p className="text-xs text-[#325099]/40 italic">No students enrolled.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {students.map(s => (
                  <span
                    key={s.id}
                    className={`text-[11px] px-2 py-1 rounded-full border ${
                      s.status === 'trial'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-[#EEF4FF] text-[#325099] border-[#C7D5F8]'
                    }`}
                  >
                    {s.full_name}{s.year ? ` · ${s.year}` : ''}{s.status === 'trial' ? ' · trial' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 space-y-2">
          <button
            onClick={() => onSave(form)}
            className="w-full bg-[#062E63] text-white text-sm font-semibold rounded-xl py-2.5 hover:bg-[#0a3d82] transition"
          >
            {isNew ? 'Create class' : 'Save changes'}
          </button>
          {!isNew && (
            <div className="flex items-center gap-2">
              <button
                onClick={onRemove}
                className="flex-1 text-sm font-semibold text-[#325099] border border-[#DEE7FF] rounded-xl py-2 hover:border-[#325099] transition"
                title="Unschedule — keeps the class but returns it to the Add list"
              >
                Remove from timetable
              </button>
              <button
                onClick={onDelete}
                className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition"
                title="Delete the class from the database"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function TimetablePage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [terms, setTerms]     = useState([])
  const [termId, setTermId]   = useState('')
  const [courses, setCourses] = useState([])
  const [tutors, setTutors]   = useState([])    // tutors + directors (everyone who can teach)
  const [allStudents, setAllStudents] = useState([])  // {id, full_name, year} — for draft roster editing
  const [rooms, setRooms] = useState([])  // distinct room names across all classes (dropdown options)
  // Live enrolment baseline per class (class_id → [student_id]) captured on
  // entering a draft, so Apply can diff the draft roster against what's live.
  const liveRosters = useRef({})
  const [avail, setAvail]     = useState({})    // tutorId -> { day -> Set(slotMin) }
  const [entries, setEntries] = useState([])    // class rows for the selected term
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)  // class being edited | null
  const dragId = useRef(null)
  // Draft mode — a persistent, independent scratch plan (table: timetable_drafts).
  // Editing a draft never touches the live `classes`; you Save it and resume later,
  // and only "Apply to live" pushes the arrangement onto real classes.
  const [draftMode, setDraftMode]   = useState(false)
  const [draftDirty, setDraftDirty] = useState(false)  // unsaved edits in the open draft
  const [applying, setApplying]     = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [drafts, setDrafts]         = useState([])     // [{ id, name, updated_at }] for this term
  const [draftId, setDraftId]       = useState('')     // the open draft
  const liveSnapshot = useRef(null)  // live entries captured on entering draft (for exit + apply diff)
  const [hiddenIds, setHiddenIds]   = useState(() => new Set())  // cards hidden in the open draft

  // Auth
  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)
    })
  }, [router])

  // Static reference data + term default
  useEffect(() => {
    if (!profile) return
    ;(async () => {
      const [allTerms, { data: courseRows }, { data: tutorRows }, { data: directorRows }, { data: availRows }, { data: studentRows }, { data: roomRows }] = await Promise.all([
        fetchAllTerms(),
        supabase.from(T_COURSES).select('id, course_name, course_code').order('course_name'),
        supabase.from(T_TUTORS).select('id, full_name').eq('active', true).order('full_name'),
        supabase.from(T_ADMINS).select('id, full_name').order('full_name'),
        supabase.from(T_TEACHER_AVAILABILITY).select('tutor_id, day_of_week, slot_time'),
        supabase.from(T_STUDENTS).select('id, full_name, year, status').order('full_name'),
        supabase.from(T_CLASSES).select('room'),
      ])
      setTerms(allTerms)
      setCourses(courseRows || [])
      setTutors([...(tutorRows || []), ...(directorRows || [])])
      setAllStudents(studentRows || [])
      // Distinct, naturally-sorted room names for the class room dropdown.
      const roomSet = [...new Set((roomRows || []).map(r => (r.room || '').trim()).filter(Boolean))]
      roomSet.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      setRooms(roomSet)
      const am = {}
      for (const r of availRows || []) {
        const min = parseTime(r.slot_time)
        if (min == null) continue
        ;(am[r.tutor_id] ||= {})
        ;(am[r.tutor_id][r.day_of_week] ||= new Set()).add(min)
      }
      setAvail(am)
      const cur = getEnrolmentTerm(allTerms)
      const upcoming = allTerms
        .filter(t => cur ? t.start_date > cur.start_date : true)
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
      setTermId(upcoming[0]?.id || cur?.id || allTerms[0]?.id || '')
    })()
  }, [profile])

  const CLASS_COLS = 'id, class_name, course_id, teacher, room, day_of_week, start_time, end_time, term_id'
  const loadClasses = async (tid) => {
    const { data } = await supabase.from(T_CLASSES).select(CLASS_COLS).eq('term_id', tid)
    setEntries(data || [])
  }

  // Classes for the selected term
  useEffect(() => {
    if (!termId) return
    ;(async () => {
      // Switching terms leaves draft mode (drafts are per-term) and reloads live.
      setDraftMode(false); setDraftDirty(false); setHiddenIds(new Set())
      setDraftId(''); setDrafts([]); liveSnapshot.current = null
      setLoading(true); await loadClasses(termId); setLoading(false)
    })()
  }, [termId])

  const courseLabel = (id) => {
    const c = courses.find(c => String(c.id) === String(id))
    return c ? (c.course_code || c.course_name) : ''
  }
  const colorForTutor = (id) => {
    if (!id) return GREY
    const idx = tutors.findIndex(t => t.id === id)
    if (idx < 0) return GREY
    const override = COLOR_OVERRIDES[(tutors[idx].full_name || '').trim().toLowerCase()]
    return override || CHIP_COLORS[idx % CHIP_COLORS.length]
  }
  const tutorFirst = (id) => (tutors.find(t => t.id === id)?.full_name || '').split(' ')[0]

  // Map a class's teacher name -> staff id. Classes store the teacher as free
  // text — historically a first name ("Amber"), now a full name ("Amber Kim") —
  // so we key by both, and only add a first-name key when it's unambiguous.
  const nameToId = useMemo(() => {
    const firstCount = {}
    for (const t of tutors) {
      const first = (t.full_name || '').trim().toLowerCase().split(/\s+/)[0]
      if (first) firstCount[first] = (firstCount[first] || 0) + 1
    }
    const m = {}
    for (const t of tutors) {
      const full = (t.full_name || '').trim().toLowerCase()
      if (!full) continue
      m[full] = t.id
      const first = full.split(/\s+/)[0]
      if (first && firstCount[first] === 1 && !(first in m)) m[first] = t.id
    }
    return m
  }, [tutors])
  const resolveTutorId = (teacher) => {
    const key = (teacher || '').trim().toLowerCase()
    if (!key) return null
    return nameToId[key] || nameToId[key.split(/\s+/)[0]] || null
  }
  const teacherShort = (row) =>
    tutorFirst(row.tutor_id) || (row.teacher || '').trim().split(/\s+/)[0] || ''

  // ── Derived: placed rows + clash + availability flags ───────────────────────────
  const decorated = useMemo(() => {
    // Hidden cards are "parked" — exclude them so they don't trigger clash or
    // availability warnings (and the warning can't point at an invisible card).
    const rows = entries.filter(e => isPlaced(e) && !hiddenIds.has(e.id)).map(e => ({
      ...e,
      s: parseTime(e.start_time),
      e: parseTime(e.end_time),
      tutor_id: resolveTutorId(e.teacher),
    }))

    const clash = new Set()
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j]
        if (a.day_of_week !== b.day_of_week) continue
        if (a.s < b.e && b.s < a.e) {
          const sameTutor = a.tutor_id && b.tutor_id && a.tutor_id === b.tutor_id
          const sameRoom  = a.room && b.room && a.room.trim().toLowerCase() === b.room.trim().toLowerCase()
          if (sameTutor || sameRoom) { clash.add(a.id); clash.add(b.id) }
        }
      }
    }

    const offAvail = new Set()
    for (const r of rows) {
      if (!r.tutor_id) continue
      const byDay = avail[r.tutor_id]
      if (!byDay) continue
      const set = byDay[r.day_of_week]
      let ok = !!set
      // Availability is recorded in 30-min slots on the :00/:30 grid, so snap the
      // class start down to that grid — otherwise a class that starts off-grid
      // (e.g. 16:15) never matches even when it's fully covered.
      if (set) {
        const start = Math.floor(r.s / 30) * 30
        for (let t = start; t < r.e; t += 30) { if (!set.has(t)) { ok = false; break } }
      }
      if (!ok) offAvail.add(r.id)
    }
    return { rows, clash, offAvail }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, avail, nameToId, hiddenIds])

  // Weekly hours per tutor (+ unassigned) from placed classes.
  const hoursByTutor = useMemo(() => {
    const mins = {}
    for (const r of decorated.rows) {
      const key = r.tutor_id || '_none'
      mins[key] = (mins[key] || 0) + (r.e - r.s)
    }
    return mins
  }, [decorated])
  const fmtHours = (m) => {
    const h = m / 60
    return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
  }

  // Lane layout per day for side-by-side overlaps.
  const layoutForDay = (day) => {
    const evs = decorated.rows.filter(r => r.day_of_week === day && !hiddenIds.has(r.id)).sort((a, b) => a.s - b.s || a.e - b.e)
    const laneEnds = []
    evs.forEach(ev => {
      let lane = laneEnds.findIndex(end => end <= ev.s)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(ev.e) } else laneEnds[lane] = ev.e
      ev._lane = lane
    })
    let curEnd = -1, cluster = []
    const flush = () => { const n = cluster.length ? Math.max(...cluster.map(e => e._lane)) + 1 : 1; cluster.forEach(e => { e._lanes = n }); cluster = [] }
    evs.forEach(ev => { if (cluster.length && ev.s >= curEnd) { flush(); curEnd = -1 } cluster.push(ev); curEnd = Math.max(curEnd, ev.e) })
    flush()
    return evs
  }

  // ── Publish to website ──────────────────────────────────────────────────────────
  const selectedTerm = terms.find(t => t.id === termId)
  const togglePublish = async () => {
    if (!selectedTerm) return
    const next = !selectedTerm.published_on_website
    if (next && !confirm(`Publish ${formatTermLabel(selectedTerm)}'s timetable to the public website?\n\nGroup classes for this term will become visible at cubetuition.com.au/timetable.`)) return
    setTerms(prev => prev.map(t => t.id === termId ? { ...t, published_on_website: next } : t))
    const { error } = await supabase.from(T_TERMS).update({ published_on_website: next }).eq('id', termId)
    if (error) {
      setTerms(prev => prev.map(t => t.id === termId ? { ...t, published_on_website: !next } : t))
      alert(`Could not update: ${error.message}`)
    }
  }

  // ── Mutations (all write to the classes table) ──────────────────────────────────
  const openEdit = (row) => setEditing({ ...row, tutor_id: resolveTutorId(row.teacher) })

  const saveEntry = async (form) => {
    const teacher = tutors.find(t => t.id === form.tutor_id)?.full_name || null
    const payload = {
      course_id : form.course_id ? Number(form.course_id) : null,
      class_name: form.class_name?.trim() || courseLabel(form.course_id) || 'Class',
      teacher,
      room      : form.room?.trim() || null,
      day_of_week: form.day_of_week,
      start_time: form.start_time,
      end_time  : form.end_time,
    }
    if (editing.id) {
      setEntries(prev => prev.map(e => e.id === editing.id ? { ...e, ...payload } : e))
      if (draftMode) setDraftDirty(true)            // draft: local only, saved on Apply
      else await supabase.from(T_CLASSES).update(payload).eq('id', editing.id)
    } else {
      const { data } = await supabase.from(T_CLASSES).insert({ ...payload, term_id: termId }).select(CLASS_COLS).single()
      if (data) setEntries(prev => [...prev, data])
    }
    setEditing(null)
  }

  // Unschedule — keeps the class, returns it to the Add pool.
  const removeFromTimetable = async () => {
    const id = editing.id
    const patch = { day_of_week: null, start_time: null, end_time: null }
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
    setEditing(null)
    if (draftMode) { setDraftDirty(true); return }  // draft: local only, saved on Apply
    await supabase.from(T_CLASSES).update(patch).eq('id', id)
  }

  // Delete the class outright.
  const deleteClass = async () => {
    const id = editing.id
    if (draftMode) {
      // Draft: remove locally; the actual DB delete happens on Apply (and is
      // reversible via Discard until then).
      setEntries(prev => prev.filter(e => e.id !== id))
      setEditing(null); setDraftDirty(true)
      return
    }
    if (!confirm('Delete this class from the database entirely? This cannot be undone.')) return
    setEditing(null)
    const { error } = await supabase.from(T_CLASSES).delete().eq('id', id)
    if (error) { alert(`Could not delete: ${error.message}\n\nIt may have enrolments or attendance linked to it. Use “Remove from timetable” instead.`); return }
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  const moveEntry = async (id, day, startMin) => {
    const e = entries.find(x => x.id === id)
    if (!e) return
    const dur = ((parseTime(e.end_time) ?? 0) - (parseTime(e.start_time) ?? 0)) || 60
    const start = Math.max(DAY_START * 60, Math.min(startMin, DAY_END * 60 - dur))
    const patch = { day_of_week: day, start_time: toHHMM(start), end_time: toHHMM(start + dur) }
    setEntries(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x))
    if (draftMode) { setDraftDirty(true); return }   // draft: local only, no DB write
    await supabase.from(T_CLASSES).update(patch).eq('id', id)
  }

  // ── Draft roster editing (next-term planning) ───────────────────────────────
  // Each draft entry carries a `student_ids` array. Edits stay in the draft and
  // are reconciled onto real enrolments only on Apply to live.
  const studentsById = useMemo(() => {
    const m = {}
    for (const s of allStudents) m[s.id] = s
    return m
  }, [allStudents])

  // Active enrolment roster (class_id → [student_id]) for the given classes.
  const loadLiveRosters = async (ents) => {
    const ids = ents.map(e => e.id).filter(Boolean)
    if (!ids.length) return {}
    const { data } = await supabase.from(T_ENROLMENTS)
      .select('class_id, student_id, status, ended_at')
      .in('class_id', ids)
    const map = {}
    for (const r of data || []) {
      if (r.ended_at || r.status === 'disenrol' || !r.student_id) continue
      ;(map[r.class_id] ||= []).push(r.student_id)
    }
    return map
  }

  const setRoster = (classId, updater) => {
    setEntries(prev => prev.map(e => e.id === classId ? { ...e, student_ids: updater(e.student_ids || []) } : e))
    setDraftDirty(true)
  }
  const addStudentToClass      = (classId, sid) => setRoster(classId, ids => ids.includes(sid) ? ids : [...ids, sid])
  const removeStudentFromClass = (classId, sid) => setRoster(classId, ids => ids.filter(x => x !== sid))
  const moveStudent = (sid, fromId, toId) => {
    if (!toId || fromId === toId) return
    setEntries(prev => prev.map(e => {
      if (e.id === fromId) return { ...e, student_ids: (e.student_ids || []).filter(x => x !== sid) }
      if (e.id === toId)   return { ...e, student_ids: (e.student_ids || []).includes(sid) ? e.student_ids : [...(e.student_ids || []), sid] }
      return e
    }))
    setDraftDirty(true)
  }

  // Student check — non-archived students not placed in any class in this draft.
  const [showUnassigned, setShowUnassigned]   = useState(false)
  const [unassignedQuery, setUnassignedQuery] = useState('')
  const unassignedStudents = useMemo(() => {
    if (!draftMode) return []
    const assigned = new Set()
    for (const e of entries) for (const sid of (e.student_ids || [])) assigned.add(sid)
    // Only current students belong in the pool — disenrolled / quit-trial students
    // (status not active/trial) are no longer assignable.
    const ACTIVE = new Set(['active', 'trial'])
    return allStudents
      .filter(s => ACTIVE.has(s.status) && !assigned.has(s.id))
      .sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0) || (a.full_name || '').localeCompare(b.full_name || ''))
  }, [draftMode, entries, allStudents])

  // ── Draft mode (persistent, independent of the live timetable) ──────────────
  const FIELDS = ['course_id', 'class_name', 'teacher', 'room', 'day_of_week', 'start_time', 'end_time']

  const openDraft = async (id) => {
    const d = await loadDraft(id)
    if (!d) return
    const rosters = liveRosters.current || {}
    setDraftId(id)
    // Saved drafts carry their own student_ids; older drafts (pre-roster) fall
    // back to the live roster so nothing looks empty.
    setEntries((d.entries || []).map(e => ({ ...e, student_ids: e.student_ids ?? rosters[e.id] ?? [] })))
    setHiddenIds(new Set(d.hidden_ids))
    setDraftDirty(false)
  }

  // Enter draft: remember the live board, load this term's drafts, then open the
  // most recent — creating one seeded from the live timetable if none exist.
  const enterDraft = async () => {
    // Capture the live enrolment baseline, then seed every entry's draft roster
    // from it so roster edits start from the real classes.
    const rosters = await loadLiveRosters(entries)
    liveRosters.current = rosters
    const seeded = entries.map(e => ({ ...e, student_ids: rosters[e.id] || [] }))
    liveSnapshot.current = seeded
    setEntries(seeded)
    setHiddenIds(new Set()); setDraftDirty(false)
    let list = await listDrafts(termId)
    if (list.length === 0) {
      const created = await createDraft({ termId, name: 'Draft 1', entries: seeded, hiddenIds: [], createdBy: profile?.id })
      list = [created]
    }
    setDrafts(list)
    setDraftMode(true)
    await openDraft(list[0].id)
  }

  const switchDraft = async (id) => {
    if (draftDirty && !confirm('Switch drafts? Unsaved changes in the current draft will be lost.')) return
    await openDraft(id)
  }

  const newDraft = async () => {
    // Seed a new draft from the live timetable so you start from the real layout.
    const created = await createDraft({
      termId, name: `Draft ${drafts.length + 1}`,
      entries: liveSnapshot.current || entries, hiddenIds: [], createdBy: profile?.id,
    })
    setDrafts(prev => [created, ...prev])
    await openDraft(created.id)
  }

  const saveDraftNow = async () => {
    if (!draftId) return
    setSavingDraft(true)
    try {
      await saveDraft(draftId, { entries, hiddenIds: [...hiddenIds] })
      setDraftDirty(false)
      setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, updated_at: new Date().toISOString() } : d))
    } catch (e) { alert('Could not save draft: ' + (e.message || e)) }
    setSavingDraft(false)
  }

  const renameDraftNow = async () => {
    const cur = drafts.find(d => d.id === draftId)
    const name = prompt('Draft name:', cur?.name || 'Untitled draft')
    if (name == null) return
    const clean = name.trim() || 'Untitled draft'
    await renameDraft(draftId, clean)
    setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, name: clean } : d))
  }

  const removeDraft = async () => {
    if (!draftId) return
    if (!confirm('Delete this draft? This only removes the saved plan — no real classes are affected.')) return
    await deleteDraft(draftId)
    const remaining = drafts.filter(d => d.id !== draftId)
    setDrafts(remaining)
    if (remaining.length) await openDraft(remaining[0].id)
    else exitDraft()
  }

  const exitDraft = () => {
    setDraftMode(false); setDraftId(''); setDraftDirty(false); setHiddenIds(new Set())
    if (liveSnapshot.current) setEntries(liveSnapshot.current)
    liveSnapshot.current = null
  }

  // Push the open draft's arrangement onto the live classes. Guarded by a
  // two-step confirmation (impact summary + type-to-confirm) since it overwrites
  // the real timetable and can't be undone.
  const applyToLive = async () => {
    const live = new Map((liveSnapshot.current || []).map(e => [e.id, e]))
    const curIds = new Set(entries.map(e => e.id))
    // Work out the real impact up front so the prompts can show it.
    const updates = entries.filter(e => {
      const o = live.get(e.id)
      return o && FIELDS.some(f => o[f] !== e[f])
    })
    const deletions = (liveSnapshot.current || []).filter(o => !curIds.has(o.id))

    // Roster changes vs the live enrolment baseline. Only reconcile classes that
    // still exist in the draft (a deleted class handles its own enrolments).
    const baseline = liveRosters.current || {}
    const rosterAdds = []     // { class_id, student_id } — enrol / re-activate
    const rosterRemoves = []  // { class_id, student_id } — disenrol
    for (const e of entries) {
      if (!e.id) continue
      const want = new Set(e.student_ids || [])
      const have = new Set(baseline[e.id] || [])
      for (const sid of want) if (!have.has(sid)) rosterAdds.push({ class_id: e.id, student_id: sid })
      for (const sid of have) if (!want.has(sid)) rosterRemoves.push({ class_id: e.id, student_id: sid })
    }

    if (updates.length === 0 && deletions.length === 0 && rosterAdds.length === 0 && rosterRemoves.length === 0) {
      alert('This draft already matches the live timetable — nothing to apply.')
      return
    }

    const termLabel = selectedTerm ? formatTermLabel(selectedTerm) : 'this term'
    const draftName = drafts.find(d => d.id === draftId)?.name || 'this draft'
    const plural = (n, s = 's') => (n === 1 ? '' : s)

    // Step 1 — confirm, with the actual numbers.
    const summary =
      `Apply "${draftName}" to the LIVE ${termLabel} timetable?\n\n` +
      `• ${updates.length} class${plural(updates.length, 'es')} will be updated\n` +
      (deletions.length ? `• ${deletions.length} class${plural(deletions.length, 'es')} will be DELETED\n` : '') +
      (rosterAdds.length ? `• ${rosterAdds.length} student${plural(rosterAdds.length)} will be enrolled\n` : '') +
      (rosterRemoves.length ? `• ${rosterRemoves.length} student${plural(rosterRemoves.length)} will be removed from a class\n` : '') +
      `\nThis changes the real timetable and enrolments, and cannot be undone.`
    if (!confirm(summary)) return

    // Step 2 — type-to-confirm (second factor).
    const PHRASE = 'APPLY'
    const typed = prompt(`Final confirmation — type ${PHRASE} (in capitals) to push this draft to the live timetable:`)
    if ((typed || '').trim() !== PHRASE) {
      alert('Apply cancelled — the confirmation text didn’t match.')
      return
    }

    setApplying(true)
    const failures = []
    for (const e of updates) {
      const patch = Object.fromEntries(FIELDS.map(f => [f, e[f]]))
      const { error } = await supabase.from(T_CLASSES).update(patch).eq('id', e.id)
      if (error) failures.push(`${e.class_name || 'Class'}: ${error.message}`)
    }
    for (const o of deletions) {
      const { error } = await supabase.from(T_CLASSES).delete().eq('id', o.id)
      if (error) failures.push(`${o.class_name || 'Class'} (delete): ${error.message}`)
    }
    // Enrol added students (re-activating a prior enrolment rather than
    // duplicating it), then disenrol removed ones.
    for (const a of rosterAdds) {
      const name = studentsById[a.student_id]?.full_name || 'student'
      const { data: existing } = await supabase.from(T_ENROLMENTS)
        .select('id').eq('class_id', a.class_id).eq('student_id', a.student_id).limit(1)
      const { error } = existing?.length
        ? await supabase.from(T_ENROLMENTS).update({ status: 'active', ended_at: null, end_reason: null }).eq('id', existing[0].id)
        : await supabase.from(T_ENROLMENTS).insert({ class_id: a.class_id, student_id: a.student_id, status: 'active' })
      if (error) failures.push(`Enrol ${name}: ${error.message}`)
    }
    for (const r of rosterRemoves) {
      const name = studentsById[r.student_id]?.full_name || 'student'
      const { error } = await supabase.from(T_ENROLMENTS)
        .update({ status: 'disenrol' })
        .eq('class_id', r.class_id).eq('student_id', r.student_id).neq('status', 'disenrol')
      if (error) failures.push(`Remove ${name}: ${error.message}`)
    }
    setApplying(false)
    // Refresh the live snapshot + roster baseline so a later apply diffs against
    // what now exists.
    const { data } = await supabase.from(T_CLASSES).select(CLASS_COLS).eq('term_id', termId)
    liveSnapshot.current = data || []
    liveRosters.current = await loadLiveRosters(data || [])
    const bits = [
      `${updates.length} updated`,
      deletions.length ? `${deletions.length} deleted` : '',
      rosterAdds.length ? `${rosterAdds.length} enrolled` : '',
      rosterRemoves.length ? `${rosterRemoves.length} removed` : '',
    ].filter(Boolean)
    alert(failures.length
      ? `Applied with some issues:\n\n${failures.join('\n')}`
      : `Draft applied to the live timetable — ${bits.join(', ')}.`)
  }

  const onColumnDrop = (day) => (ev) => {
    ev.preventDefault()
    const id = dragId.current
    if (id == null) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const y = ev.clientY - rect.top
    let mins = DAY_START * 60 + (y / HOUR_PX) * 60
    mins = Math.round(mins / SNAP_MIN) * SNAP_MIN
    moveEntry(id, day, mins)
    dragId.current = null
  }

  const hours = []
  for (let h = DAY_START; h <= DAY_END; h++) hours.push(h)
  const gridHeight = (DAY_END - DAY_START) * HOUR_PX

  const clashCount = decorated.clash.size
  const offCount   = decorated.offAvail.size
  const placedCount = decorated.rows.length
  const offRows = decorated.rows.filter(r => decorated.offAvail.has(r.id))
  const offSummary = offRows
    .map(r => `${teacherShort(r)} — ${r.class_name || courseLabel(r.course_id) || 'Class'}, ${r.day_of_week.slice(0, 3)} ${fmtTime(r.s)}–${fmtTime(r.e)}`)
    .join('\n')

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      {editing && (() => {
        // Keep the modal's roster in sync with live draft edits.
        const liveEntry  = entries.find(e => e.id === editing.id)
        const modalEntry = liveEntry ? { ...editing, student_ids: liveEntry.student_ids } : editing
        return (
          <ClassModal
            entry={modalEntry}
            courses={courses}
            tutors={tutors}
            rooms={rooms}
            draftMode={draftMode}
            studentsById={studentsById}
            allStudents={allStudents}
            otherClasses={entries.filter(e => e.id && e.id !== editing.id).map(e => ({ id: e.id, class_name: e.class_name }))}
            onAddStudent={(sid) => addStudentToClass(editing.id, sid)}
            onRemoveStudent={(sid) => removeStudentFromClass(editing.id, sid)}
            onMoveStudent={(sid, toId) => moveStudent(sid, editing.id, toId)}
            onClose={() => setEditing(null)}
            onSave={saveEntry}
            onRemove={removeFromTimetable}
            onDelete={deleteClass}
          />
        )
      })()}

      {showUnassigned && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setShowUnassigned(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] w-[28rem] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-[#EEF2FB]">
              <div>
                <p className="text-lg font-bold text-[#062E63]">Unassigned students</p>
                <p className="text-xs text-[#325099]/60 mt-0.5">
                  {unassignedStudents.length} student{unassignedStudents.length === 1 ? '' : 's'} not in any class in this draft
                </p>
              </div>
              <button onClick={() => setShowUnassigned(false)} className="text-[#325099]/30 hover:text-[#325099] text-xl leading-none">✕</button>
            </div>
            {unassignedStudents.length === 0 ? (
              <p className="text-sm text-emerald-700 px-6 py-10 text-center">✓ Every student is assigned to a class.</p>
            ) : (
              <>
                <div className="px-6 py-3 border-b border-[#EEF2FB]">
                  <input
                    value={unassignedQuery}
                    onChange={e => setUnassignedQuery(e.target.value)}
                    placeholder="Search by name…"
                    className="w-full border border-[#DEE7FF] rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-[#325099]"
                  />
                </div>
                <div className="overflow-y-auto px-6 py-3">
                  {(() => {
                    const q = unassignedQuery.trim().toLowerCase()
                    const list = q ? unassignedStudents.filter(s => (s.full_name || '').toLowerCase().includes(q)) : unassignedStudents
                    return list.length === 0 ? (
                      <p className="text-sm text-[#325099]/40 py-6 text-center">No matches.</p>
                    ) : (
                      <div>
                        {list.map(s => (
                          <div key={s.id} className="flex items-center justify-between text-sm py-1.5 border-b border-[#F4F7FF] last:border-0">
                            <span className="text-[#062E63]">{s.full_name}</span>
                            <span className="text-xs text-[#325099]/50">{s.year ? `Year ${s.year}` : '—'}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="max-w-[1400px] mx-auto px-6 pt-10 pb-24">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Timetable Planner</h1>
            <p className="text-sm text-[#325099]/60 mt-1">
              {draftMode
                ? 'Draft plan — edits save to this draft only and never touch the live timetable until you “Apply to live”.'
                : 'Arrange this term’s classes onto the week. Drag to reschedule — every change saves to the class.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={termId}
              onChange={e => setTermId(e.target.value)}
              className="border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm font-semibold text-[#062E63] bg-white focus:outline-none focus:border-[#325099]"
            >
              {terms.map(t => <option key={t.id} value={t.id}>{formatTermLabel(t)}</option>)}
            </select>

            {/* Drafts — saved, independent plans; nothing touches live until "Apply to live" */}
            {!draftMode ? (
              <button
                onClick={enterDraft}
                title="Open a saved draft plan (or start one). Edits never touch the live timetable."
                className="text-sm font-semibold rounded-xl px-4 py-2 border bg-white text-[#062E63] border-[#DEE7FF] hover:border-[#325099] transition"
              >
                ✏️ Drafts
              </button>
            ) : (
              <>
                <select
                  value={draftId}
                  onChange={e => switchDraft(e.target.value)}
                  title="Choose a draft plan"
                  className="border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm font-semibold text-[#062E63] bg-white focus:outline-none focus:border-[#325099] max-w-[170px]"
                >
                  {drafts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button onClick={newDraft} title="New draft (seeded from the live timetable)"
                  className="text-sm font-semibold rounded-xl px-3 py-2 border bg-white text-[#062E63] border-[#DEE7FF] hover:border-[#325099] transition">+ New</button>
                <button onClick={renameDraftNow} title="Rename this draft"
                  className="text-sm rounded-xl px-2.5 py-2 border bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099] transition">✎</button>
                {hiddenIds.size > 0 && (
                  <button onClick={() => { setHiddenIds(new Set()); setDraftDirty(true) }}
                    title="Show all cards hidden in this draft"
                    className="text-sm font-semibold rounded-xl px-3 py-2 border bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099] transition">
                    Show {hiddenIds.size} hidden
                  </button>
                )}
                <button onClick={() => setShowUnassigned(true)}
                  title="Students in the database not assigned to any class in this draft"
                  className={`text-sm font-semibold rounded-xl px-3 py-2 border transition ${
                    unassignedStudents.length
                      ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                      : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                  }`}>
                  {unassignedStudents.length ? `⚠ ${unassignedStudents.length} unassigned` : '✓ All assigned'}
                </button>
                <button onClick={saveDraftNow} disabled={savingDraft || !draftDirty}
                  className="text-sm font-semibold rounded-xl px-4 py-2 border bg-[#325099] text-white border-[#325099] hover:bg-[#062E63] transition disabled:opacity-50">
                  {savingDraft ? 'Saving…' : draftDirty ? 'Save draft' : 'Saved ✓'}
                </button>
                <button onClick={applyToLive} disabled={applying}
                  title="Push this draft onto the live timetable"
                  className="text-sm font-semibold rounded-xl px-4 py-2 border bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 transition disabled:opacity-50">
                  {applying ? 'Applying…' : 'Apply to live'}
                </button>
                <button onClick={removeDraft} title="Delete this draft plan"
                  className="text-sm font-semibold rounded-xl px-3 py-2 border bg-white text-[#B23A3A] border-[#F3C0C0] hover:bg-[#FFF5F5] transition">Delete</button>
                <button onClick={exitDraft} title="Leave drafts and return to the live timetable"
                  className="text-sm font-semibold rounded-xl px-4 py-2 border bg-white text-[#062E63] border-[#DEE7FF] hover:border-[#325099] transition">Exit</button>
              </>
            )}

            {!draftMode && (
              <button
                onClick={togglePublish}
                title="Show this term's timetable on the public website"
                className={`text-sm font-semibold rounded-xl px-4 py-2 border transition ${
                  selectedTerm?.published_on_website
                    ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                    : 'bg-white text-[#062E63] border-[#DEE7FF] hover:border-[#325099]'
                }`}
              >
                {selectedTerm?.published_on_website ? '🌐 Published to website' : 'Publish to website'}
              </button>
            )}
          </div>
        </div>

        {/* Status / warnings */}
        <div className="flex items-center gap-3 mb-4 flex-wrap text-xs">
          {clashCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-semibold">
              ⚠ {clashCount} card{clashCount === 1 ? '' : 's'} clash (tutor or room double-booked)
            </span>
          )}
          {offCount > 0 && (
            <span
              title={offSummary}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold cursor-help"
            >
              ◷ outside availability: {offRows.map(r => teacherShort(r)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
            </span>
          )}
          {clashCount === 0 && offCount === 0 && placedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
              ✓ No clashes
            </span>
          )}
          <span className="text-[#325099]/40">{placedCount} class{placedCount === 1 ? '' : 'es'} on the timetable</span>
        </div>

        {/* Teacher colour legend + weekly hours tally */}
        <div className="flex items-center gap-x-2.5 gap-y-1.5 mb-4 flex-wrap">
          {tutors.map((t) => {
            const c = colorForTutor(t.id)
            const mins = hoursByTutor[t.id] || 0
            return (
              <span
                key={t.id}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border"
                style={{ background: c.bg, color: c.text, borderColor: c.border, opacity: mins ? 1 : 0.5 }}
              >
                {t.full_name.split(' ')[0]}
                <span className="font-bold">{fmtHours(mins)}</span>
              </span>
            )
          })}
          {hoursByTutor._none > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border"
              style={{ background: GREY.bg, color: GREY.text, borderColor: GREY.border }}>
              Unassigned <span className="font-bold">{fmtHours(hoursByTutor._none)}</span>
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Day headers */}
              <div className="flex border-b border-[#DEE7FF] sticky top-0 bg-white z-10">
                <div className="w-16 flex-shrink-0 border-r border-[#DEE7FF]" />
                {DAYS.map(day => (
                  <div key={day} className="flex-1 px-3 py-3 text-center border-r border-[#DEE7FF] last:border-r-0">
                    <p className="text-[11px] font-bold text-[#325099]/70 uppercase tracking-wider">{day.slice(0, 3)}</p>
                    <p className="text-[10px] text-[#325099]/35">
                      {decorated.rows.filter(r => r.day_of_week === day).length || '—'}
                    </p>
                  </div>
                ))}
              </div>

              {/* Grid body */}
              <div className="flex relative" style={{ height: gridHeight }}>
                {/* Time gutter */}
                <div className="w-16 flex-shrink-0 border-r border-[#DEE7FF] relative">
                  {hours.map((h, i) => (
                    <div key={h} className="absolute right-2 text-[10px] font-semibold text-[#325099]/50"
                      style={{ top: i * HOUR_PX - 6 }}>
                      {fmtTime(h * 60)}
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {DAYS.map(day => {
                  const evs = layoutForDay(day)
                  return (
                    <div
                      key={day}
                      className="flex-1 relative border-r border-[#DEE7FF] last:border-r-0"
                      onDragOver={e => e.preventDefault()}
                      onDrop={onColumnDrop(day)}
                    >
                      {hours.map((h, i) => (
                        <div key={h} className="absolute left-0 right-0 border-t border-[#EEF2FB]" style={{ top: i * HOUR_PX }} />
                      ))}

                      {evs.map(ev => {
                        const col = colorForTutor(ev.tutor_id)
                        const top = ((ev.s - DAY_START * 60) / 60) * HOUR_PX
                        const height = Math.max(22, ((ev.e - ev.s) / 60) * HOUR_PX - 2)
                        const lanes = ev._lanes || 1
                        const lane = ev._lane || 0
                        const isClash = decorated.clash.has(ev.id)
                        const isOff = decorated.offAvail.has(ev.id)
                        const title = ev.class_name || courseLabel(ev.course_id) || 'Class'
                        return (
                          <div
                            key={ev.id}
                            draggable
                            onDragStart={() => { dragId.current = ev.id }}
                            onClick={() => openEdit(ev)}
                            title={`${title} · ${fmtTime(ev.s)}–${fmtTime(ev.e)}${ev.room ? ' · ' + ev.room : ''}`}
                            className="absolute rounded-lg px-2 py-1 cursor-grab active:cursor-grabbing overflow-hidden shadow-sm hover:shadow-md transition"
                            style={{
                              top, height,
                              left: `calc(${(lane / lanes) * 100}% + 2px)`,
                              width: `calc(${100 / lanes}% - 4px)`,
                              background: col.bg,
                              border: `1.5px solid ${isClash ? '#ef4444' : isOff ? '#f59e0b' : col.border}`,
                              boxShadow: isClash ? '0 0 0 1px #ef4444' : isOff ? '0 0 0 1px #f59e0b' : undefined,
                            }}
                          >
                            {draftMode && (
                              <button
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); setHiddenIds(prev => { const n = new Set(prev); n.add(ev.id); return n }); setDraftDirty(true) }}
                                title="Hide from this draft (doesn’t delete the class)"
                                className="absolute top-0.5 right-0.5 z-10 w-4 h-4 flex items-center justify-center rounded bg-white/70 text-[#5B6477] hover:bg-white hover:text-[#B23A3A] text-[11px] leading-none"
                              >×</button>
                            )}
                            <p className="text-[11px] font-bold leading-tight truncate" style={{ color: col.text }}>
                              {isClash && '⚠ '}{title}
                            </p>
                            <p className="text-[9px] leading-tight truncate" style={{ color: col.text, opacity: 0.8 }}>
                              {fmtTime(ev.s)}–{fmtTime(ev.e)}
                            </p>
                            {(ev.teacher || ev.room) && (
                              <p className="text-[9px] leading-tight truncate" style={{ color: col.text, opacity: 0.7 }}>
                                {isOff && '◷ '}{teacherShort(ev)}{ev.teacher && ev.room ? ' · ' : ''}{ev.room || ''}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <p className="text-[11px] text-[#325099]/40 mt-4 text-center">
          {draftMode
            ? 'Draft plan — drag to move, click a card to edit, × to hide. Save draft to keep it; Apply to live to push it onto the real timetable.'
            : 'Drag cards to reschedule · click a card to edit · changes save to the class instantly'}
        </p>
      </div>
    </div>
  )
}

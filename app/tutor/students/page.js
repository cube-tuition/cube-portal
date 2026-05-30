'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { T_ENROLMENTS, T_PARENTS, T_STUDENTS } from '../../../lib/tables'

/*
 * Admin-only: Student & Parent directory
 * ─────────────────────────────────────────────────────────────────────────────
 * Two side-by-side panels:
 *   Left  — Students  (name, year, student ID, email, phone)
 *   Right — Parents   (name, relationship, email, phone)
 *
 * Admins can add new students via the "Add Student" button, which opens a
 * two-section modal (student info + guardian info). On submit the student row
 * is inserted into `students` and the guardian into `parents`.
 */

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function shortId(uuid = '') {
  return uuid.slice(-8).toUpperCase()
}

function Badge({ text, color = 'blue' }) {
  const palette = {
    blue:  'bg-[#DEE7FF] text-[#062E63]',
    green: 'bg-[#D1FAE5] text-[#065F46]',
    amber: 'bg-[#FEF3C7] text-[#92400E]',
    rose:  'bg-[#FCE7F3] text-[#9D174D]',
  }
  return (
    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${palette[color] || palette.blue}`}>
      {text}
    </span>
  )
}

function yearBadgeColor(yr) {
  const n = parseInt(yr, 10)
  if (n <= 6)  return 'green'
  if (n <= 10) return 'blue'
  return 'amber'
}

// ── Field component ───────────────────────────────────────────────────────────
function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">
        {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] text-[#2A2035] placeholder-[#2A2035]/35 focus:outline-none focus:border-[#BACBFF] focus:ring-1 focus:ring-[#BACBFF] transition'

// ── Add Student Modal ─────────────────────────────────────────────────────────
const BLANK_FORM = {
  // Section 1 — Student
  studentName: '',
  gender: '',
  studentEmail: '',
  studentPhone: '',
  school: '',
  // Section 2 — Guardian
  guardianName: '',
  relationship: '',
  parentEmail: '',
  parentPhone: '',
}

function AddStudentModal({ onClose, onAdded }) {
  const [form, setForm]       = useState(BLANK_FORM)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!form.studentName.trim()) { setError('Student full name is required.'); return }

    setSaving(true)
    try {
      // Insert student row (students table only holds students now)
      const { data: newStudent, error: studentErr } = await supabase
        .from(T_STUDENTS)
        .insert({
          full_name: form.studentName.trim(),
          gender:    form.gender || null,
          email:     form.studentEmail.trim() || null,
          phone:     form.studentPhone.trim() || null,
          school:    form.school.trim() || null,
        })
        .select('id, full_name, email, school, year, gender, phone')
        .single()

      if (studentErr) throw new Error(studentErr.message)

      // Insert guardian row if any guardian info was provided
      const hasGuardian = form.guardianName.trim() || form.parentEmail.trim() || form.parentPhone.trim()
      if (hasGuardian) {
        const { error: parentErr } = await supabase
          .from(T_PARENTS)
          .insert({
            student_id:   newStudent.id,
            full_name:    form.guardianName.trim() || null,
            relationship: form.relationship.trim() || null,
            email:        form.parentEmail.trim() || null,
            phone:        form.parentPhone.trim() || null,
          })
        if (parentErr) throw new Error(parentErr.message)
      }

      onAdded(newStudent)
      onClose()
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      onClick={handleBackdrop}
    >
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-[#DEE7FF] overflow-hidden max-h-[90vh] flex flex-col">

        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#DEE7FF] flex items-center justify-center text-lg">🎓</div>
            <div>
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">Admin · Directory</p>
              <p className="text-sm font-bold text-[#2A2035] font-display leading-tight">Add New Student</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#2A2035]/40 hover:text-[#2A2035] hover:bg-[#DEE7FF] transition text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="px-6 py-5 space-y-6">

            {/* ── Section 1: Student Details ── */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded-full bg-[#325099] text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</div>
                <p className="text-xs font-bold tracking-[0.15em] uppercase text-[#325099]">Student Details</p>
              </div>

              <div className="space-y-3.5">
                <Field label="Full Name" required>
                  <input
                    type="text"
                    placeholder="e.g. Sarah Johnson"
                    value={form.studentName}
                    onChange={set('studentName')}
                    className={inputCls}
                    autoFocus
                  />
                </Field>

                <Field label="Gender">
                  <select value={form.gender} onChange={set('gender')} className={inputCls}>
                    <option value="">Select gender…</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Non-binary">Non-binary</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Student Email">
                    <input
                      type="email"
                      placeholder="student@example.com"
                      value={form.studentEmail}
                      onChange={set('studentEmail')}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Student Phone">
                    <input
                      type="tel"
                      placeholder="04XX XXX XXX"
                      value={form.studentPhone}
                      onChange={set('studentPhone')}
                      className={inputCls}
                    />
                  </Field>
                </div>

                <Field label="School">
                  <input
                    type="text"
                    placeholder="e.g. Chatswood High School"
                    value={form.school}
                    onChange={set('school')}
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-[#DEE7FF]" />

            {/* ── Section 2: Guardian Details ── */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded-full bg-[#92400E] text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</div>
                <p className="text-xs font-bold tracking-[0.15em] uppercase text-[#92400E]">Guardian Details</p>
                <span className="text-[10px] text-[#2A2035]/40 font-medium">(optional)</span>
              </div>

              <div className="space-y-3.5">
                <Field label="Guardian Full Name">
                  <input
                    type="text"
                    placeholder="e.g. Michael Johnson"
                    value={form.guardianName}
                    onChange={set('guardianName')}
                    className={inputCls}
                  />
                </Field>

                <Field label="Relationship to Student">
                  <select value={form.relationship} onChange={set('relationship')} className={inputCls}>
                    <option value="">Select relationship…</option>
                    <option value="Mother">Mother</option>
                    <option value="Father">Father</option>
                    <option value="Guardian">Guardian</option>
                    <option value="Grandparent">Grandparent</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Parent Email">
                    <input
                      type="email"
                      placeholder="parent@example.com"
                      value={form.parentEmail}
                      onChange={set('parentEmail')}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Parent Phone">
                    <input
                      type="tel"
                      placeholder="04XX XXX XXX"
                      value={form.parentPhone}
                      onChange={set('parentPhone')}
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>
            </div>

          </div>

          {/* Modal footer */}
          <div className="px-6 py-4 border-t border-[#DEE7FF] bg-[#F8FAFF] shrink-0 flex items-center justify-between gap-3">
            {error ? (
              <p className="text-xs text-rose-500 font-medium flex-1">{error}</p>
            ) : (
              <p className="text-[10px] text-[#2A2035]/40 flex-1">
                Fields marked <span className="text-rose-400">*</span> are required
              </p>
            )}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-xl hover:bg-[#DEE7FF] transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 text-sm font-semibold bg-[#325099] text-white rounded-xl hover:bg-[#062E63] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving…
                  </>
                ) : 'Add Student'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function StudentsPage() {
  const [staff, setStaff]           = useState(null)
  const [students, setStudents]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [authErr, setAuthErr]       = useState(null)
  const [search, setSearch]         = useState('')
  const [selected, setSelected]     = useState(null)   // selected student index
  const [enrollments, setEnrollments] = useState({})   // { student_id: count }
  const [parents, setParents]       = useState({})     // { student_id: parent row }
  const [showModal, setShowModal]   = useState(false)
  const router = useRouter()

  const loadStudents = async (ids = null) => {
    const query = supabase
      .from(T_STUDENTS)
      .select('id, full_name, email, school, year, gender, phone')
      .order('full_name')

    const { data: studentList } = await query
    const list = studentList || []
    setStudents(list)
    return list
  }

  const loadEnrollments = async (list) => {
    if (list.length === 0) return
    const ids = list.map(s => s.id)
    const { data: links } = await supabase
      .from(T_ENROLMENTS)
      .select('student_id')
      .in('student_id', ids)
    const counts = {}
    for (const l of links || []) {
      counts[l.student_id] = (counts[l.student_id] || 0) + 1
    }
    setEnrollments(counts)
  }

  const loadParents = async (list) => {
    if (list.length === 0) return
    const ids = list.map(s => s.id)
    const { data: parentRows } = await supabase
      .from(T_PARENTS)
      .select('*')
      .in('student_id', ids)
    const map = {}
    for (const p of parentRows || []) {
      map[p.student_id] = p
    }
    setParents(map)
  }

  useEffect(() => {
    const load = async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile) { setAuthErr('No profile found'); return }
      if (profile.role !== 'admin') { router.push('/tutor'); return }
      setStaff(profile)

      const list = await loadStudents()
      await Promise.all([loadEnrollments(list), loadParents(list)])
      setLoading(false)
    }
    load()
  }, [])

  // Called after a successful add — prepend new student and refresh parents
  const handleStudentAdded = async (newStudent) => {
    setStudents(prev => {
      const next = [...prev, newStudent].sort((a, b) =>
        (a.full_name || '').localeCompare(b.full_name || '')
      )
      return next
    })
    // Re-fetch parents to pick up the newly inserted guardian row
    const list = await loadStudents()
    await loadParents(list)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return students
    return students.filter(s =>
      (s.full_name || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.year || '').includes(q)
    )
  }, [students, search])

  const selectedStudent = selected !== null ? filtered[selected] : null
  const selectedParent  = selectedStudent ? (parents[selectedStudent.id] || null) : null

  if (authErr) return (
    <div className="min-h-screen flex items-center justify-center bg-white px-6">
      <p className="text-sm text-red-500">{authErr}</p>
    </div>
  )

  if (loading || !staff) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">Loading…</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      {/* Add Student Modal */}
      {showModal && (
        <AddStudentModal
          onClose={() => setShowModal(false)}
          onAdded={handleStudentAdded}
        />
      )}

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 md:py-12">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display mb-2">
            Admin · Directory
          </p>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#2A2035] font-display mb-1">
                Students &amp; Parents
              </h1>
              <p className="text-sm text-[#2A2035]/60">
                {students.length} student{students.length !== 1 ? 's' : ''} enrolled · select a student to view their guardian details
              </p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#325099] text-white text-sm font-semibold rounded-xl hover:bg-[#062E63] transition shadow-sm shrink-0"
            >
              <span className="text-base leading-none">+</span>
              Add Student
            </button>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">

        {/* Search + Add row */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative max-w-sm flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#325099]/50 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search by name, email, or year…"
              value={search}
              onChange={e => { setSearch(e.target.value); setSelected(null) }}
              className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] text-[#2A2035] placeholder-[#2A2035]/40 focus:outline-none focus:border-[#BACBFF] focus:ring-1 focus:ring-[#BACBFF] transition"
            />
          </div>
        </div>

        {/* Side-by-side panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── LEFT: Students ────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#DEE7FF] flex items-center justify-center text-base">🎓</div>
                <div>
                  <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">Students</p>
                  <p className="text-sm font-semibold text-[#2A2035] font-display leading-tight">
                    {filtered.length} {search ? 'found' : 'enrolled'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selected !== null && (
                  <button
                    onClick={() => setSelected(null)}
                    className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63] transition px-2 py-1 rounded-lg hover:bg-[#DEE7FF]"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setShowModal(true)}
                  className="text-[11px] font-semibold text-white bg-[#325099] hover:bg-[#062E63] transition px-3 py-1.5 rounded-lg flex items-center gap-1"
                >
                  <span className="text-sm leading-none">+</span> Add
                </button>
              </div>
            </div>

            {/* Student list */}
            <div className="divide-y divide-[#DEE7FF] max-h-[60vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-3xl mb-2">🔍</p>
                  <p className="text-sm font-semibold text-[#2A2035]">No students match</p>
                  <p className="text-xs text-[#2A2035]/50 mt-1">Try a different search term</p>
                </div>
              ) : filtered.map((s, i) => {
                const isActive = selected === i
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelected(isActive ? null : i)}
                    className={`w-full text-left px-5 py-4 flex items-start gap-3.5 transition group ${
                      isActive
                        ? 'bg-[#EEF4FF] border-l-2 border-l-[#325099]'
                        : 'hover:bg-[#F8FAFF] border-l-2 border-l-transparent'
                    }`}
                  >
                    {/* Avatar */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      isActive ? 'bg-[#325099] text-white' : 'bg-[#DEE7FF] text-[#325099]'
                    }`}>
                      {(s.full_name || '?').charAt(0)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[#2A2035] font-display">
                          {s.full_name}
                        </span>
                        {s.year && (
                          <Badge text={`Yr ${s.year}`} color={yearBadgeColor(s.year)} />
                        )}
                        {enrollments[s.id] > 0 && (
                          <Badge text={`${enrollments[s.id]} class${enrollments[s.id] === 1 ? '' : 'es'}`} color="blue" />
                        )}
                        {s.gender && (
                          <Badge text={s.gender} color="rose" />
                        )}
                      </div>
                      <p className="text-[11px] text-[#2A2035]/55 mt-0.5 truncate">{s.email || '—'}</p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-[#2A2035]/45">
                        <span className="font-mono">ID: {shortId(s.id)}</span>
                        {s.school && <span>· {s.school}</span>}
                        {s.phone && <span>· {s.phone}</span>}
                      </div>
                    </div>

                    <span className={`text-sm transition-transform shrink-0 mt-1 ${isActive ? 'text-[#325099]' : 'text-[#2A2035]/30 group-hover:text-[#325099]'}`}>
                      {isActive ? '→' : '›'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── RIGHT: Parents ────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF]">
              <div className="w-8 h-8 rounded-xl bg-[#FEF3C7] flex items-center justify-center text-base">👨‍👩‍👧</div>
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">Parents / Guardians</p>
                <p className="text-sm font-semibold text-[#2A2035] font-display leading-tight">
                  {selectedStudent ? `Guardian of ${selectedStudent.full_name}` : 'Select a student'}
                </p>
              </div>
            </div>

            {/* Parent detail */}
            <div className="p-5">
              {!selectedStudent ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-[#FEF3C7] flex items-center justify-center text-3xl mb-4">
                    👈
                  </div>
                  <p className="text-sm font-semibold text-[#2A2035]">No student selected</p>
                  <p className="text-xs text-[#2A2035]/50 mt-1.5 max-w-xs">
                    Click a student on the left to view their guardian contact details.
                  </p>
                </div>
              ) : !selectedParent ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-[#DEE7FF] flex items-center justify-center text-3xl mb-4">
                    📭
                  </div>
                  <p className="text-sm font-semibold text-[#2A2035]">No guardian on file</p>
                  <p className="text-xs text-[#2A2035]/50 mt-1.5 max-w-xs">
                    Guardian details can be added when creating a student.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Linked student chip */}
                  <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#EEF4FF] border border-[#DEE7FF]">
                    <div className="w-6 h-6 rounded-full bg-[#325099] text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {(selectedStudent.full_name || '?').charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-[#325099]">{selectedStudent.full_name}</span>
                      {selectedStudent.year && (
                        <span className="text-[10px] text-[#2A2035]/50 ml-1.5">· Year {selectedStudent.year}</span>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-[#325099]/60 tracking-wide">linked student</span>
                  </div>

                  {/* Parent card */}
                  <div className="rounded-2xl border border-[#DEE7FF] p-5 bg-[#FAFBFF]">
                    <div className="flex items-start gap-3.5 mb-5">
                      <div className="w-11 h-11 rounded-full bg-[#FEF3C7] flex items-center justify-center text-lg font-bold text-[#92400E] shrink-0">
                        {(selectedParent.full_name || '?').charAt(0)}
                      </div>
                      <div>
                        <p className="text-base font-semibold text-[#2A2035] font-display">{selectedParent.full_name || '—'}</p>
                        {selectedParent.relationship && (
                          <Badge text={selectedParent.relationship} color="amber" />
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <DetailRow icon="✉️" label="Email"  value={selectedParent.email} />
                      <DetailRow icon="📞" label="Phone"  value={selectedParent.phone} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">
            © CUBE Tuition · Chatswood
          </p>
        </div>
      </footer>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function DetailRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-sm shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/60 font-semibold mb-0.5">{label}</p>
        <p className="text-sm text-[#2A2035] break-words">{value || '—'}</p>
      </div>
    </div>
  )
}

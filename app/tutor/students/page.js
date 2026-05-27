'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import TutorNav from '../../../components/TutorNav'

/*
 * Admin-only: Student & Parent directory
 * ─────────────────────────────────────────────────────────────────────────────
 * Two side-by-side panels:
 *   Left  — Students  (name, year, student ID, email, phone)
 *   Right — Parents   (name, relationship, email, phone, address)
 *
 * Student data comes from Supabase. Parent data is sample until a `parents`
 * table is wired up. Clicking a student card highlights the matching parent.
 */

// ── Sample parent data ────────────────────────────────────────────────────────
// Keyed by student full_name for easy lookup.
const SAMPLE_PARENTS = {
  'Ailin Lu':       { name: 'Wei Lu',         rel: 'Mother',   email: 'wei.lu@example.com',         phone: '0412 345 001', address: '14 Willow St, Chatswood NSW 2067' },
  'Allen Park':     { name: 'James Park',      rel: 'Father',   email: 'james.park@example.com',     phone: '0412 345 002', address: '88 Pacific Hwy, Gordon NSW 2072' },
  'Arron Park':     { name: 'James Park',      rel: 'Father',   email: 'james.park@example.com',     phone: '0412 345 002', address: '88 Pacific Hwy, Gordon NSW 2072' },
  'Branden Jung':   { name: 'Minjung Jung',    rel: 'Mother',   email: 'minjung.jung@example.com',   phone: '0412 345 003', address: '5 Boundary Rd, Killara NSW 2071' },
  'Caden Kim':      { name: 'Sooyeon Kim',     rel: 'Mother',   email: 'sooyeon.kim@example.com',    phone: '0412 345 004', address: '22 Burns Rd, Turramurra NSW 2074' },
  'Chloe Su':       { name: 'Liling Su',       rel: 'Mother',   email: 'liling.su@example.com',      phone: '0412 345 005', address: '3 Hazel Ave, Lindfield NSW 2070' },
  'Christina Kim':  { name: 'Hyunwoo Kim',     rel: 'Father',   email: 'hyunwoo.kim@example.com',    phone: '0412 345 006', address: '10 Fullers Rd, Chatswood NSW 2067' },
  'Cicely Wood':    { name: 'Margaret Wood',   rel: 'Mother',   email: 'margaret.wood@example.com',  phone: '0412 345 007', address: '67 Penshurst St, Willoughby NSW 2068' },
  'Daniel Lee':     { name: 'Jinhee Lee',      rel: 'Mother',   email: 'jinhee.lee@example.com',     phone: '0412 345 008', address: '2 Cedar St, Roseville NSW 2069' },
  'David Kim':      { name: 'Kevin Kim',       rel: 'Father',   email: 'kevin.kim@example.com',      phone: '0412 345 009', address: '45 Reserve Rd, Artarmon NSW 2064' },
}

// Fallback for any student not in the lookup above
function defaultParent(student) {
  const last = (student.full_name || '').split(' ').slice(1).join(' ') || 'Parent'
  return {
    name: `Parent of ${student.full_name}`,
    rel: 'Guardian',
    email: `parent.${last.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    phone: '—',
    address: 'Address not on file',
  }
}

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

export default function StudentsPage() {
  const [staff, setStaff]         = useState(null)
  const [students, setStudents]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [authErr, setAuthErr]     = useState(null)
  const [search, setSearch]       = useState('')
  const [selected, setSelected]   = useState(null)   // selected student index
  const [enrollments, setEnrollments] = useState({}) // { student_id: count }
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile, error } = await supabase
        .from('students')
        .select('*')
        .eq('id', user.id)
        .single()

      if (error || !profile) { setAuthErr(error?.message || 'No profile'); return }
      if (profile.role !== 'admin') { router.push('/tutor'); return }
      setStaff(profile)

      // Fetch all students
      const { data: studentList } = await supabase
        .from('students')
        .select('id, full_name, email, school, school_year')
        .eq('role', 'student')
        .order('full_name')

      const list = studentList || []
      setStudents(list)

      // Enrollment counts
      if (list.length > 0) {
        const ids = list.map(s => s.id)
        const { data: links } = await supabase
          .from('student_classes')
          .select('student_id')
          .in('student_id', ids)
        const counts = {}
        for (const l of links || []) {
          counts[l.student_id] = (counts[l.student_id] || 0) + 1
        }
        setEnrollments(counts)
      }

      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return students
    return students.filter(s =>
      (s.full_name || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.school_year || '').includes(q)
    )
  }, [students, search])

  const selectedStudent = selected !== null ? filtered[selected] : null
  const selectedParent  = selectedStudent
    ? (SAMPLE_PARENTS[selectedStudent.full_name] || defaultParent(selectedStudent))
    : null

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

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 md:py-12">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display mb-2">
            Admin · Directory
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#2A2035] font-display mb-1">
            Students &amp; Parents
          </h1>
          <p className="text-sm text-[#2A2035]/60">
            {students.length} student{students.length !== 1 ? 's' : ''} enrolled · select a student to view their parent details
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">

        {/* Search bar */}
        <div className="mb-6 max-w-sm">
          <div className="relative">
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
              {selected !== null && (
                <button
                  onClick={() => setSelected(null)}
                  className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63] transition px-2 py-1 rounded-lg hover:bg-[#DEE7FF]"
                >
                  Clear
                </button>
              )}
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
                        {s.school_year && (
                          <Badge text={`Yr ${s.school_year}`} color={yearBadgeColor(s.school_year)} />
                        )}
                        {enrollments[s.id] > 0 && (
                          <Badge text={`${enrollments[s.id]} class${enrollments[s.id] === 1 ? '' : 'es'}`} color="blue" />
                        )}
                      </div>
                      <p className="text-[11px] text-[#2A2035]/55 mt-0.5 truncate">{s.email || '—'}</p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-[#2A2035]/45">
                        <span className="font-mono">ID: {shortId(s.id)}</span>
                        {s.school && <span>· {s.school}</span>}
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
                  {selectedStudent ? `Parent of ${selectedStudent.full_name}` : 'Select a student'}
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
                    Click a student on the left to view their parent or guardian contact details.
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
                      <span className="text-[10px] text-[#2A2035]/50 ml-1.5">· Year {selectedStudent.school_year}</span>
                    </div>
                    <span className="text-[10px] font-semibold text-[#325099]/60 tracking-wide">linked student</span>
                  </div>

                  {/* Parent card */}
                  <div className="rounded-2xl border border-[#DEE7FF] p-5 bg-[#FAFBFF]">
                    <div className="flex items-start gap-3.5 mb-5">
                      <div className="w-11 h-11 rounded-full bg-[#FEF3C7] flex items-center justify-center text-lg font-bold text-[#92400E] shrink-0">
                        {(selectedParent.name || '?').charAt(0)}
                      </div>
                      <div>
                        <p className="text-base font-semibold text-[#2A2035] font-display">{selectedParent.name}</p>
                        <Badge text={selectedParent.rel} color="amber" />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <DetailRow icon="✉️" label="Email" value={selectedParent.email} />
                      <DetailRow icon="📞" label="Phone" value={selectedParent.phone} />
                      <DetailRow icon="🏠" label="Address" value={selectedParent.address} />
                    </div>
                  </div>

                  {/* Sample data disclaimer */}
                  <p className="text-[10px] text-[#2A2035]/35 text-center pt-1">
                    ℹ️ Parent data is sample — connect a <code className="font-mono">parents</code> table to show live records
                  </p>
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

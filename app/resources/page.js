'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import { useRouter } from 'next/navigation'
import PortalNav from '../../components/PortalNav'
import { inferSubject, subjectColor } from '../../components/CourseDetail'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../lib/terms'
import { T_CLASS_BOOKLETS, T_ENROLMENTS, T_STUDENTS } from '../../lib/tables'

/*
 * Resources / Booklets
 * ─────────────────────────────────────────────────────────────────────────────
 * Left:  one tab per enrolled class.
 * Right: weeks 1–10 for the current term, showing booklets uploaded by admin
 *        via the teacher portal (stored in public.class_booklets + Supabase
 *        Storage bucket "class-booklets").
 *        Click → generates a 10-minute signed URL and opens the PDF inline.
 */

export default function Resources() {
  const [student,        setStudent]        = useState(null)
  const [enrolledClasses, setEnrolledClasses] = useState([])   // [{ id, class_name, subject }]
  const [selectedClass,  setSelectedClass]  = useState(null)   // { id, class_name, subject }
  const [classBooklets,  setClassBooklets]  = useState([])     // rows from class_booklets
  const [currentTerm,    setCurrentTerm]    = useState(null)
  const [viewing,        setViewing]        = useState(null)   // { storagePath, name, week }
  const [loading,        setLoading]        = useState(true)
  const [bookletsLoading, setBookletsLoading] = useState(false)
  const router = useRouter()

  // ── Auth + enrolled classes + current term ──────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!requireStudent(user, router)) return

      const { data: profile } = await supabase
        .from(T_STUDENTS).select('*').eq('id', user.id).single()
      setStudent(profile)

      const terms = await fetchAllTerms()
      setCurrentTerm(getCurrentTerm(terms))

      // Fetch enrolled classes with IDs so we can look up class_booklets.
      // Note: classes table has no 'subject' column — subject is inferred
      // from class_name by inferSubject() in CourseDetail.js.
      const { data: links } = await supabase
        .from(T_ENROLMENTS)
        .select('classes(id, class_name)')
        .eq('student_id', user.id)

      const classes = (links || []).map(l => l.classes).filter(Boolean)

      // Deduplicate by class_id (students shouldn't be in the same class twice,
      // but guard against it anyway)
      const seen = new Set()
      const unique = []
      for (const c of classes) {
        if (c?.id && !seen.has(c.id)) {
          seen.add(c.id)
          unique.push(c)
        }
      }
      setEnrolledClasses(unique)
      setSelectedClass(unique[0] || null)
      setLoading(false)
    }
    load()
  }, [])

  // ── Fetch booklets whenever the selected class or term changes ───────────────
  useEffect(() => {
    if (!selectedClass?.id || !currentTerm?.term_number) {
      setClassBooklets([])
      return
    }
    let cancelled = false
    const load = async () => {
      setBookletsLoading(true)
      const { data } = await supabase
        .from(T_CLASS_BOOKLETS)
        .select('id, booklet_name, storage_path, week, updated_at')
        .eq('class_id', selectedClass.id)
        .eq('term_number', currentTerm.term_number)
        .order('week', { ascending: true })
      if (!cancelled) {
        setClassBooklets(data || [])
        setBookletsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedClass?.id, currentTerm?.term_number])

  const selectedSubject = selectedClass ? inferSubject(selectedClass) : null
  const accent          = subjectColor(selectedSubject)

  // Map week → booklet row for quick lookup
  const weeksMap = useMemo(() => {
    const map = new Map()
    for (const b of classBooklets) {
      if (b.week) map.set(b.week, b)
    }
    return map
  }, [classBooklets])

  return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student?.full_name} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">
              Booklets & materials
            </p>
            {currentTerm && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#325099]" />
                {formatTermLabel(currentTerm)}
              </span>
            )}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Resources
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            Just the booklets for the courses you're enrolled in — ready to view straight from the portal.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {loading ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center text-sm text-[#2A2035]/50">
            Loading your booklets…
          </div>
        ) : enrolledClasses.length === 0 ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center">
            <div className="text-4xl mb-2">📚</div>
            <p className="text-sm font-semibold text-[#2A2035]">No courses yet, so no booklets to show.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">Once you're enrolled, booklets for your courses will appear here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* LEFT — Course tabs */}
            <div className="md:col-span-1">
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-3 font-display">
                Choose a course
              </p>
              <div className="space-y-3">
                {enrolledClasses.map(cls => {
                  const subj = inferSubject(cls)
                  const a    = subjectColor(subj)
                  const isActive = selectedClass?.id === cls.id
                  return (
                    <button
                      key={cls.id}
                      onClick={() => { setSelectedClass(cls); setViewing(null) }}
                      className={`w-full text-left rounded-2xl border p-4 transition ${
                        isActive
                          ? 'border-[#062E63] bg-[#F8FAFF]'
                          : 'border-[#DEE7FF] bg-white hover:border-[#BACBFF] hover:bg-[#F8FAFF]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                          style={{ background: a.bg }}
                        >
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: a.fg }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[#2A2035] font-display">{cls.class_name}</p>
                          <p className="text-[11px] text-[#2A2035]/50 mt-0.5">{subj}</p>
                        </div>
                        <span
                          className={`text-lg transition-transform ${isActive ? 'translate-x-0.5' : ''}`}
                          style={{ color: a.fg }}
                        >
                          →
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* RIGHT — Week-by-week list, or PDF viewer */}
            <div className="md:col-span-2">
              {viewing ? (
                <BookletViewer viewing={viewing} onClose={() => setViewing(null)} accent={accent} />
              ) : (
                <WeekList
                  cls={selectedClass}
                  accent={accent}
                  weeksMap={weeksMap}
                  loading={bookletsLoading}
                  onOpen={setViewing}
                />
              )}
            </div>

          </div>
        )}
      </section>

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

// ── Week-by-week list ──────────────────────────────────────────────────────────
function WeekList({ cls, accent, weeksMap, loading, onOpen }) {
  const weeks = Array.from({ length: 10 }, (_, i) => i + 1)

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#DEE7FF] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: accent.bg }}>
            <span className="w-2 h-2 rounded-full" style={{ background: accent.fg }} />
          </div>
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase font-semibold font-display" style={{ color: accent.fg }}>
              Term booklets
            </p>
            <p className="font-semibold text-[#2A2035] font-display">{cls?.class_name || 'Choose a course'}</p>
          </div>
        </div>
        <p className="text-[11px] tracking-widest uppercase font-semibold text-[#325099]/60">Week 1 – 10</p>
      </div>

      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-[#2A2035]/40">
          Loading booklets…
        </div>
      ) : (
        <ul className="divide-y divide-[#DEE7FF]">
          {weeks.map(w => {
            const booklet = weeksMap.get(w)

            if (!booklet) {
              return (
                <li key={w} className="px-5 py-3.5 flex items-center gap-3">
                  <WeekChip n={w} />
                  <span className="text-sm text-[#2A2035]/40">— not uploaded yet</span>
                </li>
              )
            }

            return (
              <li key={w} className="px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <WeekChip n={w} accent={accent} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#2A2035] truncate">
                      {booklet.booklet_name || `Week ${w} Booklet`}
                    </p>
                    <p className="text-[11px] text-[#2A2035]/50">
                      {booklet.updated_at
                        ? `Updated ${new Date(booklet.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : 'PDF available'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onOpen({
                    storagePath: booklet.storage_path,
                    name: booklet.booklet_name || `Week ${w} Booklet`,
                    week: w,
                  })}
                  className="shrink-0 text-xs font-semibold text-white rounded-full px-4 py-2 transition hover:opacity-90"
                  style={{ background: accent.fg }}
                >
                  View →
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Week chip ──────────────────────────────────────────────────────────────────
function WeekChip({ n, accent }) {
  return (
    <div
      className="w-10 h-10 rounded-xl flex flex-col items-center justify-center shrink-0 border"
      style={{
        background:   accent ? accent.bg  : '#F8FAFF',
        borderColor:  accent ? accent.fg + '33' : '#DEE7FF',
        color:        accent ? accent.fg  : '#325099',
      }}
    >
      <span className="text-[8px] tracking-widest uppercase font-bold leading-none">Wk</span>
      <span className="text-sm font-bold tabular-nums leading-tight mt-0.5">{n}</span>
    </div>
  )
}

// ── PDF viewer ─────────────────────────────────────────────────────────────────
// Generates a fresh signed URL the moment the viewer mounts, then
// renders an iframe. Signed URLs expire after 10 minutes (600 s).
function BookletViewer({ viewing, onClose, accent }) {
  const [signedUrl,  setSignedUrl]  = useState(null)
  const [urlLoading, setUrlLoading] = useState(true)
  const [urlError,   setUrlError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setUrlLoading(true)
      setUrlError(null)
      const { data, error } = await supabase.storage
        .from('class-booklets')
        .createSignedUrl(viewing.storagePath, 600)
      if (cancelled) return
      if (error || !data?.signedUrl) {
        setUrlError('Could not load the PDF. Please try again.')
      } else {
        setSignedUrl(data.signedUrl)
      }
      setUrlLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [viewing.storagePath])

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-[#DEE7FF]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="text-xs font-semibold text-[#325099] hover:text-[#062E63] px-3 py-1.5 rounded-full hover:bg-[#F8FAFF] transition"
          >
            ← Back
          </button>
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.3em] uppercase font-semibold" style={{ color: accent.fg }}>
              Week {viewing.week}
            </p>
            <p className="font-semibold text-[#2A2035] font-display truncate">{viewing.name}</p>
          </div>
        </div>
        {signedUrl && (
          <div className="flex items-center gap-3 shrink-0">
            <a
              href={signedUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] px-3 py-1.5 rounded-full hover:bg-[#F8FAFF] transition"
            >
              ↓ Download
            </a>
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] transition"
            >
              Open in new tab ↗
            </a>
          </div>
        )}
      </div>

      {/* Body */}
      {urlLoading ? (
        <div className="flex items-center justify-center" style={{ height: '75vh' }}>
          <p className="text-sm text-[#2A2035]/40">Loading PDF…</p>
        </div>
      ) : urlError ? (
        <div className="flex items-center justify-center" style={{ height: '75vh' }}>
          <p className="text-sm font-semibold text-[#991B1B]">{urlError}</p>
        </div>
      ) : (
        <iframe
          key={viewing.storagePath}
          src={signedUrl}
          className="w-full"
          style={{ height: '75vh', border: 'none' }}
          title={viewing.name}
        />
      )}
    </div>
  )
}

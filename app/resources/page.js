'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import PortalNav from '../../components/PortalNav'
import { inferSubject, subjectColor, subjectsMatch } from '../../components/CourseDetail'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../lib/terms'

/*
 * Resources / Booklets
 * ─────────────────────────────────────────────────────────────────────────────
 * Left:  one tab per enrolled course (e.g. "Y11 Chem"), deduped by class_name.
 * Right: the 10 weeks of the current term as rows. Each row is the booklet for
 *        that week (pulled from Supabase public.booklets which is synced from
 *        Airtable). If a booklet has multiple PDFs they show as separate
 *        rows under the same week.
 *        Click → opens the PDF inline in a viewer pane.
 */

// Year is parsed from the class name, e.g. "Y11 Chem" → 11
function parseYearFromCourse(courseName) {
  if (!courseName) return null
  const m = String(courseName).match(/Y(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

export default function Resources() {
  const [student, setStudent] = useState(null)
  const [enrolledCourses, setEnrolledCourses] = useState([])
  const [selectedCourse, setSelectedCourse] = useState(null)
  const [booklets, setBooklets] = useState([])
  const [currentTerm, setCurrentTerm] = useState(null)
  const [viewing, setViewing] = useState(null) // { bookletId, idx, name, filename }
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile } = await supabase
        .from('students').select('*').eq('id', user.id).single()
      setStudent(profile)

      // Current term — drives which booklets to surface
      const terms = await fetchAllTerms()
      setCurrentTerm(getCurrentTerm(terms))

      // Enrolled classes (subject column optional)
      let classData
      const r1 = await supabase
        .from('student_classes')
        .select('classes(class_name, subject)')
        .eq('student_id', user.id)
      if (r1.error) {
        const r2 = await supabase
          .from('student_classes')
          .select('classes(class_name)')
          .eq('student_id', user.id)
        classData = r2.data
      } else {
        classData = r1.data
      }
      const classes = (classData?.map(d => d.classes) || []).filter(Boolean)

      // Unique course names, in first-seen order
      const seen = new Set()
      const courses = []
      for (const c of classes) {
        const name = (c?.class_name || '').trim()
        if (name && !seen.has(name)) {
          seen.add(name)
          courses.push(name)
        }
      }
      setEnrolledCourses(courses)
      setSelectedCourse(courses[0] || null)

      // All booklets — we filter client-side by year + subject + term
      const { data: bks } = await supabase
        .from('booklets')
        .select('id, booklet_name, year, subject, week, term_number, pdf_attachment_ids, pdf_filenames')
        .order('week', { ascending: true })
      setBooklets(bks || [])

      setLoading(false)
    }
    load()
  }, [])

  const selectedYear    = selectedCourse ? parseYearFromCourse(selectedCourse) : null
  const selectedSubject = selectedCourse ? inferSubject({ class_name: selectedCourse }) : null
  const accent          = subjectColor(selectedSubject)

  // Filter booklets down to this course's year + subject + current term
  const courseBooklets = useMemo(() => {
    if (!selectedCourse) return []
    return booklets.filter(b => {
      if (selectedYear != null && b.year != null && b.year !== selectedYear) return false
      if (!subjectsMatch(b.subject, selectedSubject) && !subjectsMatch(b.subject, selectedCourse)) return false
      if (currentTerm && b.term_number != null && b.term_number !== currentTerm.term_number) return false
      return true
    })
  }, [booklets, selectedCourse, selectedYear, selectedSubject, currentTerm])

  // Bucket by week (1..10)
  const weeksMap = useMemo(() => {
    const map = new Map()
    for (const b of courseBooklets) {
      if (!b.week) continue
      const list = map.get(b.week) || []
      list.push(b)
      map.set(b.week, list)
    }
    return map
  }, [courseBooklets])

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
        ) : enrolledCourses.length === 0 ? (
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
                {enrolledCourses.map(course => {
                  const subj = inferSubject({ class_name: course })
                  const a = subjectColor(subj)
                  const isActive = selectedCourse === course
                  return (
                    <button
                      key={course}
                      onClick={() => { setSelectedCourse(course); setViewing(null) }}
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
                          <p className="font-semibold text-[#2A2035] font-display">{course}</p>
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
                  course={selectedCourse}
                  accent={accent}
                  weeksMap={weeksMap}
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

// ── Week-by-week list ──────────────────────────────────────────────────────
function WeekList({ course, accent, weeksMap, onOpen }) {
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
            <p className="font-semibold text-[#2A2035] font-display">{course || 'Choose a course'}</p>
          </div>
        </div>
        <p className="text-[11px] tracking-widest uppercase font-semibold text-[#325099]/60">Week 1 – 10</p>
      </div>

      <ul className="divide-y divide-[#DEE7FF]">
        {weeks.map(w => {
          const items = weeksMap.get(w) || []
          if (items.length === 0) {
            return (
              <li key={w} className="px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <WeekChip n={w} />
                  <span className="text-sm text-[#2A2035]/40">— coming soon</span>
                </div>
              </li>
            )
          }
          // One booklet row per PDF (so a row with two PDFs becomes two list items)
          return items.flatMap(b => {
            const pdfCount = (b.pdf_attachment_ids || []).length
            if (pdfCount === 0) {
              return [
                <li key={`${b.id}-empty`} className="px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <WeekChip n={w} accent={accent} />
                    <div>
                      <p className="text-sm font-semibold text-[#2A2035]">{b.booklet_name}</p>
                      <p className="text-[11px] text-[#2A2035]/40">No PDF attached yet</p>
                    </div>
                  </div>
                </li>
              ]
            }
            return (b.pdf_attachment_ids || []).map((attId, i) => {
              const filename = (b.pdf_filenames || [])[i] || `Booklet ${i + 1}.pdf`
              return (
                <li key={`${b.id}-${i}`} className="px-5 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <WeekChip n={w} accent={accent} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#2A2035] truncate">{b.booklet_name}</p>
                      <p className="text-[11px] text-[#2A2035]/50 truncate">
                        {pdfCount > 1 ? `${filename} · ${i + 1} of ${pdfCount}` : filename}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => onOpen({
                      bookletId: b.id,
                      idx: i,
                      name: b.booklet_name,
                      filename,
                      week: w,
                    })}
                    className="shrink-0 text-xs font-semibold text-white rounded-full px-4 py-2 transition"
                    style={{ background: accent.fg }}
                  >
                    View →
                  </button>
                </li>
              )
            })
          })
        })}
      </ul>
    </div>
  )
}

function WeekChip({ n, accent }) {
  return (
    <div
      className="w-10 h-10 rounded-xl flex flex-col items-center justify-center shrink-0 border"
      style={{
        background: accent ? accent.bg : '#F8FAFF',
        borderColor: accent ? accent.fg + '33' : '#DEE7FF',
        color: accent ? accent.fg : '#325099',
      }}
    >
      <span className="text-[8px] tracking-widest uppercase font-bold leading-none">Wk</span>
      <span className="text-sm font-bold tabular-nums leading-tight mt-0.5">{n}</span>
    </div>
  )
}

// ── PDF viewer ─────────────────────────────────────────────────────────────
function BookletViewer({ viewing, onClose, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
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
        <a
          href={`/api/booklet/${viewing.bookletId}/pdf/${viewing.idx}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold text-[#325099] hover:text-[#062E63] transition"
        >
          Open in new tab ↗
        </a>
      </div>
      <iframe
        key={`${viewing.bookletId}-${viewing.idx}`}
        src={`/api/booklet/${viewing.bookletId}/pdf/${viewing.idx}`}
        className="w-full"
        style={{ height: '75vh', border: 'none' }}
        title={viewing.name}
      />
    </div>
  )
}

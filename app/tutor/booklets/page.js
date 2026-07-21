'use client'
import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { fetchAllTerms, getEnrolmentTerm } from '../../../lib/terms'
import { classesForTerm, classesAllTerms } from '../../../lib/classes'
import { fmtTime, weekLabel, fmtWorkbookCode, isChemistry } from '../../../lib/format'
import ExamPdfButtons from '../../../components/ExamPdfButtons'
import BookletContentView from '../../../components/booklet/BookletContentView'

const SUBJECTS_BY_YEAR = {
  11: ['English', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Chemistry'],
  12: ['English', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths', 'Chemistry'],
}
const getSubjects = (year) => SUBJECTS_BY_YEAR[year] || ['Maths', 'English']

// Subject-hub scoping (?subject=Maths|English|Chemistry): each scope covers a
// family of curriculum subjects — Maths spans the junior + senior variants.
const SUBJECT_FAMILY = {
  Maths: ['Maths', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths'],
  English: ['English'],
  Chemistry: ['Chemistry'],
}
const SCOPE_LABEL = { Maths: 'Mathematics', English: 'English', Chemistry: 'Chemistry' }

// Subject inferred from a course code like "9.M1" / "7.E" / "11.C" — the same
// rule the class-tab filter uses.
function subjectFromCourseCode(code) {
  const parts = String(code || '').split('.')
  const yr = parseInt(parts[0])
  const suffix = parts[1] || ''
  if (!suffix) return null
  return yr >= 11
    ? (suffix.startsWith('M1') ? 'Standard Maths'
      : suffix.startsWith('M2') ? 'Adv Maths'
      : suffix.startsWith('M3') ? 'Ext 1 Maths'
      : suffix.startsWith('M4') ? 'Ext 2 Maths'
      : suffix.startsWith('E') ? 'English'
      : suffix.startsWith('C') ? 'Chemistry'
      : null)
    : (suffix.startsWith('M') ? 'Maths' : suffix.startsWith('E') ? 'English' : null)
}

const SUBJECT_CODE = {
  'Maths': 'M', 'English': 'ET',
  'Standard Maths': 'MS', 'Adv Maths': 'MA',
  'Ext 1 Maths': 'M1', 'Ext 2 Maths': 'M2',
  'Chemistry': 'C', 'Physics': 'P',
}
const isMathsSubject = (s) => s === 'Maths' || s?.includes('Maths')
const getAccentColor = (s) => isMathsSubject(s) ? '#325099' : s === 'Chemistry' || s === 'Physics' ? '#0F766E' : '#7C3AED'
const getAccentBg    = (s) => isMathsSubject(s) ? '#EEF4FF'  : s === 'Chemistry' || s === 'Physics' ? '#F0FDF4' : '#F5F3FF'

const bookletLabel = (b) => {
  if (!b?.year) return fmtWorkbookCode(b?.booklet_name, b?.subject)
  const code = SUBJECT_CODE[b.subject] || (b.subject || '')[0] || ''
  // Chemistry names like "M3W2" display as "M3L2" (Chemistry counts in Lessons).
  return `${b.year}.${code}. ${fmtWorkbookCode(b.booklet_name, b.subject)}`
}

// Workbook status badge — mirrors the master database's status column.
const STATUS_BADGE_CLS = {
  'Complete':          'bg-emerald-100 text-emerald-800',
  'Needs Improvement': 'bg-amber-100 text-amber-800',
  'In Progress':       'bg-blue-100 text-blue-800',
  'Not Started':       'bg-gray-100 text-gray-500',
}
const StatusBadge = ({ status }) => status ? (
  <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_BADGE_CLS[status] || STATUS_BADGE_CLS['Not Started']}`}>
    {status}
  </span>
) : null

// Read-only modal that shows what's inside a booklet (its content field), so
// teachers can see what a curriculum booklet covers.
function ContentModal({ booklet, onClose }) {
  if (!booklet) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">Booklet content</p>
            <h2 className="text-sm font-bold text-[#062E63]">{bookletLabel(booklet)}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg shrink-0">×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">
          <BookletContentView text={booklet.content} />
        </div>
      </div>
    </div>
  )
}

// ── Class Assign Modal ────────────────────────────────────────────────────────
function ClassAssignModal({ classId, className, year, subject, term, week, accentColor, accentBg, onClose, onAssigned }) {
  const [tab,      setTab]      = useState('booklet')   // 'booklet' | 'exam'
  const [booklets, setBooklets] = useState([])
  const [exams,    setExams]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [query,    setQuery]    = useState('')
  const [saving,   setSaving]   = useState(null)
  const [error,    setError]    = useState('')

  useEffect(() => {
    supabase
      .from('booklets')
      .select('id, booklet_name, topic, file_paths, file_path, pdf_filenames, is_exam')
      .eq('year', year).eq('subject', subject)
      .order('topic', { nullsFirst: false }).order('booklet_name')
      .then(({ data }) => { setBooklets((data || []).filter(b => !b.is_exam)); setLoading(false) })
    supabase
      .from('qbank_exams')
      .select('id, title, year_label, term, updated_at')
      .order('updated_at', { ascending: false })
      .then(({ data }) => setExams(data || []))
  }, [year, subject])

  const q = query.trim().toLowerCase()
  const filtered = booklets.filter(b => !q || b.booklet_name?.toLowerCase().includes(q) || b.topic?.toLowerCase().includes(q))
  const examsFiltered = (exams || []).filter(e => !q || (e.title || '').toLowerCase().includes(q))

  const handleAssign = async (b) => {
    setSaving(b.id)
    await supabase.from('class_booklet_assignments')
      .upsert({ class_id: classId, booklet_id: b.id, term_number: term, week }, { onConflict: 'class_id,term_number,week' })
    onAssigned()
  }

  // Assign an exam by REFERENCE only — no PDF is generated or stored. We keep a
  // lightweight exam-flagged booklet (exam_id) so it slots into the week; the
  // paper/solutions are built on demand when a teacher clicks to download.
  const handleAssignExam = async (ex) => {
    setError(''); setSaving(ex.id)
    try {
      const row = {
        booklet_name: ex.title || 'Exam', year, subject, is_exam: true, exam_id: ex.id,
        file_paths: null, pdf_filenames: null, updated_at: new Date().toISOString(),
      }
      const { data: existing } = await supabase.from('booklets').select('id').eq('exam_id', ex.id).maybeSingle()
      let bookletId
      if (existing) { await supabase.from('booklets').update(row).eq('id', existing.id); bookletId = existing.id }
      else {
        const { data: ins, error: insErr } = await supabase.from('booklets').insert(row).select('id').single()
        if (insErr) throw insErr
        bookletId = ins.id
      }
      await supabase.from('class_booklet_assignments')
        .upsert({ class_id: classId, booklet_id: bookletId, term_number: term, week }, { onConflict: 'class_id,term_number,week' })
      onAssigned()
    } catch (e) {
      setError(e.message || 'Could not assign the exam.'); setSaving(null)
    }
  }

  const tabCls = (t) => `flex-1 px-3 py-1.5 text-xs font-bold rounded-lg transition ${tab === t ? 'bg-[#325099] text-white' : 'text-[#2A2035]/50 hover:bg-[#F0F4FF]'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <h2 className="text-sm font-bold text-[#062E63]">Assign to week</h2>
            <p className="text-[10px] text-[#2A2035]/40 mt-0.5">{className} · Term {term}, {weekLabel(subject, week)}</p>
          </div>
          <button onClick={onClose} disabled={!!saving} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg disabled:opacity-40">×</button>
        </div>

        <div className="px-4 pt-3">
          <div className="flex gap-1 bg-[#F4F7FF] rounded-xl p-1">
            <button onClick={() => { setTab('booklet'); setQuery('') }} className={tabCls('booklet')}>Add booklet</button>
            <button onClick={() => { setTab('exam'); setQuery('') }} className={tabCls('exam')}>Add exam</button>
          </div>
        </div>

        <div className="px-4 pt-3 pb-2">
          <input autoFocus type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={tab === 'booklet' ? 'Search workbooks…' : 'Search exams…'}
            className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-[#F8FAFF]" />
        </div>

        {error && <p className="px-5 text-[11px] text-[#DC2626] pb-1">{error}</p>}

        <div className="overflow-y-auto flex-1 px-4 pb-4">
          {tab === 'booklet' ? (
            loading ? (
              <p className="text-xs text-center text-[#2A2035]/40 py-8 animate-pulse">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-center text-[#2A2035]/40 py-8 italic">
                {query ? 'No booklets match.' : `No booklets in master database for Year ${year} ${subject}.`}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {filtered.map(b => {
                  const pdfCount = b.file_paths?.length || (b.file_path ? 1 : 0)
                  return (
                    <button key={b.id} onClick={() => handleAssign(b)} disabled={!!saving}
                      className="w-full text-left px-4 py-3 rounded-xl border border-[#E8EDF8] hover:border-[#C7D7FF] hover:bg-[#F8FAFF] transition flex items-start justify-between gap-3 group disabled:opacity-60">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#062E63] truncate">{bookletLabel(b)}</p>
                        {b.topic && <p className="text-[10px] font-medium mt-0.5" style={{ color: accentColor }}>{b.topic}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {pdfCount > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: accentBg, color: accentColor }}>
                            {pdfCount} PDF{pdfCount > 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition" style={{ color: accentColor }}>
                          {saving === b.id ? 'Saving…' : 'Assign →'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          ) : (
            exams === null ? (
              <p className="text-xs text-center text-[#2A2035]/40 py-8 animate-pulse">Loading…</p>
            ) : examsFiltered.length === 0 ? (
              <p className="text-xs text-center text-[#2A2035]/40 py-8 italic">{query ? 'No exams match.' : 'No exams in the exam database yet.'}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {examsFiltered.map(ex => (
                  <button key={ex.id} onClick={() => handleAssignExam(ex)} disabled={!!saving}
                    className="w-full text-left px-4 py-3 rounded-xl border border-[#E8EDF8] hover:border-[#C7D7FF] hover:bg-[#F8FAFF] transition flex items-start justify-between gap-3 group disabled:opacity-60">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#062E63] truncate">{ex.title || 'Untitled exam'}</p>
                      <p className="text-[10px] font-medium mt-0.5 text-[#2A2035]/45">
                        {ex.year_label ? `Year ${ex.year_label}` : ''}{ex.year_label && ex.term ? ' · ' : ''}{ex.term || ''}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold shrink-0 self-center" style={{ color: accentColor }}>
                      {saving === ex.id ? 'Assigning…' : 'Assign →'}
                    </span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ── Class Term Board ──────────────────────────────────────────────────────────
function ClassTermBoard({ cls, year, subject, accentColor, accentBg }) {
  const [assignments, setAssignments] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [assignSlot,  setAssignSlot]  = useState(null)
  const [viewContent, setViewContent] = useState(null)
  const [dragA,       setDragA]       = useState(null)  // assignment being dragged
  const [overSlot,    setOverSlot]    = useState(null)  // 'term-week' under the drag

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('class_booklet_assignments')
      .select('id, booklet_id, term_number, week, booklets(booklet_name, year, subject, topic, status, content, file_paths, file_path, pdf_filenames, is_exam, exam_id)')
      .eq('class_id', cls.id)
    setAssignments(data || [])
    setLoading(false)
  }, [cls.id])

  useEffect(() => { load() }, [load])

  const handleUnassign = async (id) => {
    await supabase.from('class_booklet_assignments').delete().eq('id', id)
    setAssignments(a => a.filter(x => x.id !== id))
  }

  const slotMap = {}
  for (const a of assignments) slotMap[`${a.term_number}-${a.week}`] = a

  // Drag a booklet card onto another week: move it there, or swap with the
  // occupant. The unique (class_id, term, week) constraint means a swap has to
  // delete the occupant first, move the dragged row, then re-insert.
  const moveAssignment = async (a, term, week) => {
    setDragA(null); setOverSlot(null)
    if (a.term_number === term && a.week === week) return
    const occ = slotMap[`${term}-${week}`]
    if (occ && occ.id !== a.id) {
      await supabase.from('class_booklet_assignments').delete().eq('id', occ.id)
      await supabase.from('class_booklet_assignments').update({ term_number: term, week }).eq('id', a.id)
      await supabase.from('class_booklet_assignments')
        .insert({ class_id: cls.id, booklet_id: occ.booklet_id, term_number: a.term_number, week: a.week })
    } else {
      await supabase.from('class_booklet_assignments').update({ term_number: term, week }).eq('id', a.id)
    }
    load()
  }

  if (loading) return <div className="py-6 text-center"><p className="text-[10px] text-[#2A2035]/30 animate-pulse">Loading…</p></div>

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        {[1, 2, 3, 4].map(term => (
          <div key={term} className="flex flex-col min-w-0">
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg mb-2" style={{ background: accentBg }}>
              <span className="text-[10px] font-bold tracking-wide" style={{ color: accentColor }}>Term {term}</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: accentColor }}>
                {[...Array(10)].filter((_, i) => slotMap[`${term}-${i + 1}`]).length}/10
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(week => {
                const a = slotMap[`${term}-${week}`]
                const b = a?.booklets
                if (a && b) {
                  const pdfPaths = b.file_paths?.length ? b.file_paths : (b.file_path ? [b.file_path] : [])
                  const pdfNames = b.pdf_filenames || []
                  return (
                    <div
                      key={week}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragA(a) }}
                      onDragEnd={() => { setDragA(null); setOverSlot(null) }}
                      onDragOver={(e) => { if (dragA && dragA.id !== a.id) { e.preventDefault(); setOverSlot(`${term}-${week}`) } }}
                      onDragLeave={() => setOverSlot(s => (s === `${term}-${week}` ? null : s))}
                      onDrop={(e) => { e.preventDefault(); if (dragA) moveAssignment(dragA, term, week) }}
                      className={`bg-white rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${overSlot === `${term}-${week}` ? 'border-[#325099] ring-2 ring-[#325099]/30' : 'border-[#E8EDF8] hover:border-[#C7D7FF]'} ${dragA?.id === a.id ? 'opacity-40' : ''}`}
                    >
                      <div className="h-[3px] w-full" style={{ background: accentColor }} />
                      <div className="px-3 pt-2 pb-1.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: accentColor }}>{isChemistry(subject) ? 'Ln' : 'Wk'} {week}</span>
                          {b.is_exam && <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">Exam</span>}
                                  <StatusBadge status={b.status} />
                        </div>
                        <p className="text-[11px] font-bold text-[#062E63] leading-snug">{b.is_exam ? b.booklet_name : bookletLabel(b)}</p>
                        {b.topic && <p className="text-[9px] mt-0.5 font-medium truncate" style={{ color: accentColor }}>{b.topic}</p>}
                      </div>
                      <div className="px-3 pb-2 flex items-center justify-between gap-1">
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleUnassign(a.id)}
                            className="text-[9px] font-semibold text-[#2A2035]/25 hover:text-amber-500 transition">Unassign</button>
                          <button onClick={() => setViewContent(b)}
                            className="text-[9px] font-semibold text-[#325099]/60 hover:text-[#325099] transition">📄 Content</button>
                        </div>
                        {b.is_exam ? (
                          <ExamPdfButtons examId={b.exam_id} accentColor={accentColor} accentBg={accentBg} />
                        ) : (
                          <div className="flex gap-1">
                            {pdfPaths.slice(0, 2).map((path, pi) => {
                              const { data } = supabase.storage.from('booklets').getPublicUrl(path)
                              return data?.publicUrl ? (
                                <a key={pi} href={data.publicUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-md hover:opacity-80 transition"
                                  style={{ background: accentBg, color: accentColor }}>
                                  {pdfNames[pi] ? pdfNames[pi].slice(0, 8) + (pdfNames[pi].length > 8 ? '…' : '') : `PDF ${pi + 1}`}
                                </a>
                              ) : null
                            })}
                            {pdfPaths.length > 2 && <span className="text-[9px] text-[#2A2035]/30">+{pdfPaths.length - 2}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }
                return (
                  <button key={week} onClick={() => setAssignSlot({ term, week })}
                    onDragOver={(e) => { if (dragA) { e.preventDefault(); setOverSlot(`${term}-${week}`) } }}
                    onDragLeave={() => setOverSlot(s => (s === `${term}-${week}` ? null : s))}
                    onDrop={(e) => { e.preventDefault(); if (dragA) moveAssignment(dragA, term, week) }}
                    className={`group w-full border border-dashed rounded-xl overflow-hidden transition text-left ${overSlot === `${term}-${week}` ? 'border-[#325099] bg-[#F0F4FF] ring-2 ring-[#325099]/30' : 'border-[#DEE7FF] bg-[#FBFCFF] hover:border-[#325099] hover:bg-[#F8FAFF]'}`}>
                    <div className="h-[3px] w-full bg-[#EEF2FB]" />
                    <div className="px-3 pt-2 pb-2.5">
                      <span className="text-[9px] font-bold uppercase tracking-widest block mb-0.5 text-[#A9B4CC] group-hover:text-[#325099] transition">{isChemistry(subject) ? 'Ln' : 'Wk'} {week}</span>
                      <p className="text-[11px] font-semibold text-[#2A2035]/30 group-hover:text-[#325099]/60 transition">+ assign booklet</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {assignSlot && (
        <ClassAssignModal
          classId={cls.id}
          className={cls.class_name}
          year={year}
          subject={subject}
          term={assignSlot.term}
          week={assignSlot.week}
          accentColor={accentColor}
          accentBg={accentBg}
          onClose={() => setAssignSlot(null)}
          onAssigned={() => { setAssignSlot(null); load() }}
        />
      )}
      <ContentModal booklet={viewContent} onClose={() => setViewContent(null)} />
    </>
  )
}

const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]
const TERMS = [1, 2, 3, 4]
const INP      = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

// ── Booklet Modal (add + edit) ────────────────────────────────────────────────
function BookletModal({ booklet, defaultYear, defaultSubject, defaultTerm, defaultWeek, onClose, onSaved }) {
  const isEdit = !!booklet
  const [form, setForm] = useState({
    booklet_name: booklet?.booklet_name ?? '',
    year:         booklet?.year         ?? defaultYear,
    subject:      booklet?.subject      ?? defaultSubject,
    term_number:  booklet?.term_number  ?? defaultTerm ?? '',
    week:         booklet?.week         ?? defaultWeek  ?? '',
    notes:        booklet?.notes        ?? '',
    topic:        booklet?.topic        ?? '',
    status:       booklet?.status       ?? 'Not Started',
  })
  const [newFiles, setNewFiles]           = useState([])
  const [existingPaths, setExistingPaths] = useState(
    booklet?.file_paths?.length ? booklet.file_paths : (booklet?.file_path ? [booklet.file_path] : [])
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')
  const fileRef             = useRef()

  // ── Syllabus content picker ────────────────────────────────────────────────
  // Chapters/sections from the master syllabus for this year+subject. Ticked
  // sections become the booklet's Content (one line each) and auto-fill Topic.
  const [syll, setSyll]                 = useState(null)   // [{ id, name, chapters: [{ id, name, points: [{ id, text }] }] }]
  const [selected, setSelected]         = useState(() => new Set())
  const [openChapters, setOpenChapters] = useState(() => new Set())
  const [syllDirty, setSyllDirty]       = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setSyll(null)
      const { data: mods } = await supabase.from('syllabus_modules')
        .select('id, name, sort_order').eq('subject', form.subject).eq('year', Number(form.year)).order('sort_order')
      if (cancelled) return
      if (!mods?.length) { setSyll([]); return }
      const { data: tops } = await supabase.from('syllabus_topics')
        .select('id, module_id, name, sort_order').in('module_id', mods.map(m => m.id)).order('sort_order')
      const { data: dps } = await supabase.from('syllabus_dotpoints')
        .select('id, topic_id, text, sort_order').in('topic_id', (tops || []).map(t => t.id)).order('sort_order')
      if (cancelled) return
      const structure = mods.map(m => ({
        ...m,
        chapters: (tops || []).filter(t => t.module_id === m.id).map(t => ({
          ...t,
          points: (dps || []).filter(d => d.topic_id === t.id),
        })),
      }))
      setSyll(structure)
      // Rebuild the selection for the (possibly new) year/subject — a stale
      // selection from another syllabus would silently save nothing.
      setSelected(new Set())
      // Pre-tick this booklet's saved dotpoint ids; fall back to matching
      // Content lines by text for booklets saved before ids were recorded.
      if (Array.isArray(booklet?.syllabus_points) && booklet.syllabus_points.length) {
        setSelected(new Set(booklet.syllabus_points))
      } else if (booklet?.content) {
        const lines = new Set(booklet.content.split('\n').map(l => l.trim()).filter(Boolean))
        const pre = new Set()
        for (const m of structure) for (const ch of m.chapters) for (const p of ch.points) {
          if (lines.has(p.text.trim())) pre.add(p.id)
        }
        if (pre.size) setSelected(pre)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.year, form.subject])

  const togglePoint = (id) => {
    setSyllDirty(true)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const chapterTopicName = (name) => (name.includes(' — ') ? name.split(' — ').slice(1).join(' — ') : name)

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleFileChange = e => {
    const picked = Array.from(e.target.files || [])
    setNewFiles(prev => [...prev, ...picked])
    e.target.value = ''
  }

  const removeExisting = idx => setExistingPaths(p => p.filter((_, i) => i !== idx))
  const removeNew      = idx => setNewFiles(p => p.filter((_, i) => i !== idx))

  const handleSubmit = async () => {
    if (!form.booklet_name.trim()) { setErr('Booklet name is required.'); return }
    setSaving(true); setErr('')

    // Upload new files
    const uploadedPaths = []
    for (const file of newFiles) {
      const ext  = file.name.split('.').pop()
      const path = `y${form.year}/${form.subject.toLowerCase()}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('booklets').upload(path, file, { upsert: true })
      if (upErr) { setErr('Upload failed: ' + upErr.message); setSaving(false); return }
      uploadedPaths.push(path)
    }

    // Remove storage files the user deleted
    const originalPaths = booklet?.file_paths?.length ? booklet.file_paths : (booklet?.file_path ? [booklet.file_path] : [])
    const removedPaths  = originalPaths.filter(p => !existingPaths.includes(p))
    if (removedPaths.length) await supabase.storage.from('booklets').remove(removedPaths)

    const finalPaths = [...existingPaths, ...uploadedPaths]

    const payload = {
      booklet_name: form.booklet_name.trim(),
      year:         Number(form.year),
      subject:      form.subject,
      term_number:  form.term_number !== '' ? Number(form.term_number) : null,
      week:         form.week        !== '' ? Number(form.week)        : null,
      notes:        form.notes.trim() || null,
      topic:        form.topic.trim()  || null,
      status:       form.status,
      file_path:    finalPaths[0] ?? null,
      file_paths:   finalPaths,
    }

    // Ticked syllabus sections become the booklet's Content (in syllabus
    // order); Topic auto-fills from the first ticked chapter when left blank.
    // Content is only touched when the picker was actually used, so
    // builder-generated content on other booklets is never clobbered.
    if (syllDirty && syll?.length) {
      const ordered = []
      const orderedIds = []
      let firstChapter = null
      for (const m of syll) for (const ch of m.chapters) for (const p of ch.points) {
        if (selected.has(p.id)) { ordered.push(p.text); orderedIds.push(p.id); if (!firstChapter) firstChapter = ch.name }
      }
      payload.content = ordered.length ? ordered.join('\n') : null
      // Dotpoint ids drive the syllabus page's covered ticks.
      payload.syllabus_points = orderedIds.length ? orderedIds : null
      if (!payload.topic && firstChapter) payload.topic = chapterTopicName(firstChapter)
    }

    const { error } = isEdit
      ? await supabase.from('booklets').update(payload).eq('id', booklet.id)
      : await supabase.from('booklets').insert(payload)

    if (error) { setErr(error.message); setSaving(false); return }
    onSaved()
  }

  const totalFiles = existingPaths.length + newFiles.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <h2 className="text-sm font-bold text-[#062E63]">{isEdit ? 'Edit Booklet' : 'Add Booklet'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Booklet Name</label>
            <input type="text" value={form.booklet_name} onChange={set('booklet_name')} placeholder="e.g. Linear Relationships 1" className={INP} />
          </div>
          {/* Year + Subject */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Year</label>
              <select value={form.year} onChange={set('year')} className={INP}>
                {YEARS.map(y => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Subject</label>
              <select value={form.subject} onChange={set('subject')} className={INP}>
                {getSubjects(Number(form.year)).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {/* Term + Week */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Term <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
              <select value={form.term_number} onChange={set('term_number')} className={INP}>
                <option value="">—</option>
                {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Week <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
              <input type="number" min={1} max={10} value={form.week} onChange={set('week')} placeholder="e.g. 3" className={INP} />
            </div>
          </div>
          {/* Status */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Status</label>
            <div className="flex gap-1.5 flex-wrap">
              {['Not Started', 'In Progress', 'Needs Improvement', 'Complete'].map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, status: s }))}
                  className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-full border transition ${form.status === s
                    ? `${STATUS_BADGE_CLS[s]} border-current`
                    : 'bg-white text-[#2A2035]/40 border-[#DEE7FF] hover:border-[#325099]'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {/* Topic */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Topic <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
            <input type="text" value={form.topic} onChange={set('topic')} placeholder="e.g. Linear Relationships" className={INP} list="topic-suggestions" />
            <datalist id="topic-suggestions">
              {['Number & Algebra','Fractions & Decimals','Ratios & Rates','Percentages','Linear Relationships','Equations & Inequalities','Quadratics','Functions & Graphs','Measurement & Geometry','Trigonometry','Probability & Statistics','Financial Mathematics','Calculus','Reading Comprehension','Creative Writing','Persuasive Writing','Grammar & Punctuation','Vocabulary','Poetry','Narrative Techniques','Essay Writing'].map(t => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          {/* Syllabus content picker */}
          {syll && syll.length > 0 && (
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">
                Syllabus content <span className="font-normal text-[#2A2035]/40">(tick the sections this booklet covers)</span>
              </label>
              <div className="border border-[#DEE7FF] rounded-xl max-h-56 overflow-y-auto">
                {syll.map(m => (
                  <div key={m.id}>
                    {syll.length > 1 && (
                      <div className="px-3 py-1.5 bg-[#EEF4FF] text-[10px] font-bold text-[#325099] sticky top-0">{m.name}</div>
                    )}
                    {m.chapters.map(ch => {
                      const open  = openChapters.has(ch.id)
                      const count = ch.points.filter(p => selected.has(p.id)).length
                      return (
                        <div key={ch.id} className="border-b border-[#F0F4FF] last:border-0">
                          <button
                            type="button"
                            onClick={() => setOpenChapters(prev => { const n = new Set(prev); if (n.has(ch.id)) n.delete(ch.id); else n.add(ch.id); return n })}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#F8FAFF] transition"
                          >
                            <span className={`text-[11px] ${count ? 'font-bold text-[#062E63]' : 'font-semibold text-[#2A2035]/70'}`}>{ch.name}</span>
                            <span className="text-[10px] text-[#325099] shrink-0">{count ? `${count} ✓ ` : ''}{open ? '▾' : '▸'}</span>
                          </button>
                          {open && ch.points.map(p => (
                            <label key={p.id} className="flex items-start gap-2 px-4 py-1 cursor-pointer hover:bg-[#F8FAFF]">
                              <input type="checkbox" checked={selected.has(p.id)} onChange={() => togglePoint(p.id)} className="mt-0.5 accent-[#325099]" />
                              <span className="text-[11px] text-[#2A2035]/80 leading-snug">{p.text}</span>
                            </label>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[#2A2035]/40 mt-1">
                {selected.size > 0
                  ? `${selected.size} section${selected.size === 1 ? '' : 's'} selected — saved as the booklet's Content; Topic auto-fills from the chapter.`
                  : 'Selections are saved as the booklet’s Content (visible here and in the master database).'}
              </p>
            </div>
          )}
          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Notes <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Any notes about this booklet…" className={INP + ' resize-none'} />
          </div>
          {/* PDF uploads */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">PDFs</label>
            {existingPaths.map((path, i) => (
              <div key={path} className="flex items-center justify-between px-3 py-2 mb-1.5 bg-[#F0F4FF] rounded-lg">
                <span className="text-xs font-semibold text-[#325099]">📄 PDF {i + 1} <span className="font-normal text-[#2A2035]/40">(uploaded)</span></span>
                <button onClick={() => removeExisting(i)} className="text-[10px] text-red-400 hover:text-red-600 font-semibold">Remove</button>
              </div>
            ))}
            {newFiles.map((file, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 mb-1.5 bg-[#F5F3FF] rounded-lg">
                <span className="text-xs font-semibold text-[#7C3AED]">📄 {file.name}</span>
                <button onClick={() => removeNew(i)} className="text-[10px] text-red-400 hover:text-red-600 font-semibold">Remove</button>
              </div>
            ))}
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-[#DEE7FF] rounded-xl px-4 py-3 text-center cursor-pointer hover:border-[#325099] hover:bg-[#F8FAFF] transition mt-1"
            >
              <p className="text-xs text-[#2A2035]/40">{totalFiles > 0 ? '+ Add another PDF' : 'Click to select PDF(s)'}</p>
            </div>
            <input ref={fileRef} type="file" accept="application/pdf" multiple className="hidden" onChange={handleFileChange} />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-[#F0F4FF] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 text-xs font-semibold bg-[#325099] text-white rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? (newFiles.length ? 'Uploading…' : 'Saving…') : isEdit ? 'Save Changes' : 'Add Booklet'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Assign Booklet Modal (pick from master database) ─────────────────────────
function AssignBookletModal({ year, subject, term, week, onClose, onAssigned, onCreateNew }) {
  const [tab, setTab]                 = useState('booklet')   // 'booklet' | 'exam'
  const [allBooklets, setAllBooklets] = useState([])
  const [exams, setExams]             = useState(null)
  const [loading, setLoading]         = useState(true)
  const [query, setQuery]             = useState('')
  const [assigning, setAssigning]     = useState(null)
  const [error, setError]             = useState('')

  useEffect(() => {
    supabase
      .from('booklets')
      .select('id, booklet_name, topic, term_number, week, pdf_filenames, file_paths, file_path, is_exam')
      .eq('year', year)
      .eq('subject', subject)
      .order('topic', { nullsFirst: false })
      .order('booklet_name')
      .then(({ data }) => { setAllBooklets((data || []).filter(b => !b.is_exam)); setLoading(false) })
    supabase
      .from('qbank_exams')
      .select('id, title, year_label, term, updated_at')
      .order('updated_at', { ascending: false })
      .then(({ data }) => setExams(data || []))
  }, [year, subject])

  const q = query.trim().toLowerCase()
  const filtered = allBooklets.filter(b => !q || b.booklet_name?.toLowerCase().includes(q) || b.topic?.toLowerCase().includes(q))
  const examsFiltered = (exams || []).filter(e => !q || (e.title || '').toLowerCase().includes(q))

  const handleAssign = async (booklet) => {
    setAssigning(booklet.id)
    await supabase.from('booklets').update({ term_number: term, week }).eq('id', booklet.id)
    onAssigned()
  }

  // Assign an exam by REFERENCE only — no PDF is generated or stored. Keep a
  // lightweight exam-flagged booklet (exam_id) slotted into the week; the
  // paper/solutions are built on demand when a teacher clicks to download.
  const handleAssignExam = async (ex) => {
    setError(''); setAssigning(ex.id)
    try {
      const row = {
        booklet_name: ex.title || 'Exam', year, subject, is_exam: true, exam_id: ex.id, term_number: term, week,
        file_paths: null, pdf_filenames: null, updated_at: new Date().toISOString(),
      }
      const { data: existing } = await supabase.from('booklets').select('id').eq('exam_id', ex.id).maybeSingle()
      if (existing) await supabase.from('booklets').update(row).eq('id', existing.id)
      else { const { error: insErr } = await supabase.from('booklets').insert(row); if (insErr) throw insErr }
      onAssigned()
    } catch (e) {
      setError(e.message || 'Could not assign the exam.'); setAssigning(null)
    }
  }

  const accentColor = getAccentColor(subject)
  const accentBg    = getAccentBg(subject)
  const tabCls = (t) => `flex-1 px-3 py-1.5 text-xs font-bold rounded-lg transition ${tab === t ? 'bg-[#325099] text-white' : 'text-[#2A2035]/50 hover:bg-[#F0F4FF]'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <h2 className="text-sm font-bold text-[#062E63]">Assign to week</h2>
            <p className="text-[10px] text-[#2A2035]/40 mt-0.5">Year {year} {subject} · Term {term}, {weekLabel(subject, week)}</p>
          </div>
          <button onClick={onClose} disabled={!!assigning} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg disabled:opacity-40">×</button>
        </div>

        <div className="px-4 pt-3">
          <div className="flex gap-1 bg-[#F4F7FF] rounded-xl p-1">
            <button onClick={() => { setTab('booklet'); setQuery('') }} className={tabCls('booklet')}>Add booklet</button>
            <button onClick={() => { setTab('exam'); setQuery('') }} className={tabCls('exam')}>Add exam</button>
          </div>
        </div>

        {onCreateNew && (
          <div className="px-4 pt-3">
            <button
              onClick={onCreateNew}
              disabled={!!assigning}
              className="w-full border border-dashed border-[#325099]/40 rounded-xl px-3 py-2 text-xs font-semibold text-[#325099] hover:bg-[#F0F4FF] transition disabled:opacity-40"
            >
              ＋ Create a new booklet for this week
            </button>
          </div>
        )}

        <div className="px-4 pt-3 pb-2">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tab === 'booklet' ? 'Search workbooks…' : 'Search exams…'}
            className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-[#F8FAFF]"
          />
        </div>

        {error && <p className="px-5 text-[11px] text-[#DC2626] pb-1">{error}</p>}

        <div className="overflow-y-auto flex-1 px-4 pb-4">
          {tab === 'booklet' ? (
            loading ? (
              <p className="text-xs text-center text-[#2A2035]/40 py-8 animate-pulse">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-center text-[#2A2035]/40 py-8">
                {query ? 'No booklets match your search.' : `No booklets in master database for Year ${year} ${subject}.`}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {filtered.map(b => {
                  const pdfCount = b.file_paths?.length || (b.file_path ? 1 : 0)
                  const isCurrentlyAssigned = b.term_number != null && b.week != null
                  return (
                    <button
                      key={b.id}
                      onClick={() => handleAssign(b)}
                      disabled={!!assigning}
                      className="w-full text-left px-4 py-3 rounded-xl border border-[#E8EDF8] hover:border-[#C7D7FF] hover:bg-[#F8FAFF] transition flex items-start justify-between gap-3 group disabled:opacity-60"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#062E63] truncate">{bookletLabel(b)}</p>
                        {b.topic && (
                          <p className="text-[10px] font-medium mt-0.5 truncate" style={{ color: accentColor }}>
                            {b.topic}
                          </p>
                        )}
                        {isCurrentlyAssigned && (
                          <p className="text-[10px] text-[#2A2035]/30 mt-0.5">
                            Currently: T{b.term_number} W{b.week}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {pdfCount > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: accentBg, color: accentColor }}>
                            {pdfCount} PDF{pdfCount > 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="text-[10px] font-semibold text-[#325099] opacity-0 group-hover:opacity-100 transition">
                          {assigning === b.id ? 'Assigning…' : 'Assign →'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          ) : (
            exams === null ? (
              <p className="text-xs text-center text-[#2A2035]/40 py-8 animate-pulse">Loading…</p>
            ) : examsFiltered.length === 0 ? (
              <p className="text-xs text-center text-[#2A2035]/40 py-8 italic">{query ? 'No exams match.' : 'No exams in the exam database yet.'}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {examsFiltered.map(ex => (
                  <button key={ex.id} onClick={() => handleAssignExam(ex)} disabled={!!assigning}
                    className="w-full text-left px-4 py-3 rounded-xl border border-[#E8EDF8] hover:border-[#C7D7FF] hover:bg-[#F8FAFF] transition flex items-start justify-between gap-3 group disabled:opacity-60">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#062E63] truncate">{ex.title || 'Untitled exam'}</p>
                      <p className="text-[10px] font-medium mt-0.5 text-[#2A2035]/45">
                        {ex.year_label ? `Year ${ex.year_label}` : ''}{ex.year_label && ex.term ? ' · ' : ''}{ex.term || ''}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold shrink-0 self-center" style={{ color: accentColor }}>
                      {assigning === ex.id ? 'Assigning…' : 'Assign →'}
                    </span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BookletsPage() {
  return <Suspense><BookletsPageInner /></Suspense>
}

function BookletsPageInner() {
  const router = useRouter()
  // Subject-hub scope (?subject=Maths|English|Chemistry). Invalid/absent → unscoped.
  const searchParams = useSearchParams()
  const scopeParam = searchParams.get('subject')
  const scope = SUBJECT_FAMILY[scopeParam] ? scopeParam : null
  const [staff, setStaff]           = useState(null)
  const [booklets, setBooklets]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [activeYear, setActiveYear] = useState(8)
  const [activeSub, setActiveSub]   = useState('Maths')
  const [addPrefill, setAddPrefill] = useState({})
  const [editing, setEditing]       = useState(null)
  const [creating, setCreating]     = useState(false)   // "+ New booklet" (inserts into the master DB)
  const [viewContent, setViewContent] = useState(null)
  const [assignSlot, setAssignSlot] = useState(null) // { term, week }
  const [dragB,      setDragB]      = useState(null) // booklet being dragged (General grid)
  const [overGSlot,  setOverGSlot]  = useState(null) // 'term-week' under the drag
  const [classes,      setClasses]      = useState([])
  const [activeClass,  setActiveClass]  = useState(null) // class id

  // Auth
  useEffect(() => {
    getAuthProfile().then(({ user, profile }) => {
      if (!user) { router.push('/'); return }
      if (!profile || (profile.role !== 'admin' && profile.role !== 'director' && profile.role !== 'tutor')) { router.push('/tutor'); return }
      setStaff(profile)
    })
  }, [router])

  // Load booklets
  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('booklets')
      .select('id, booklet_name, year, subject, topic, status, term_number, week, notes, content, file_path, file_paths, is_exam, exam_id, syllabus_points')
      .order('year').order('subject').order('term_number', { nullsFirst: false }).order('week', { nullsFirst: false })
    setBooklets(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { if (staff) load() }, [staff, load])

  const loadClasses = useCallback(async () => {
    // Classes are per-term rows (the rollover copies them), so scope to the
    // current term or each class shows once per term it has existed in.
    const term = getEnrolmentTerm(await fetchAllTerms())
    const cols = 'id, class_name, day_of_week, start_time, teacher, courses(course_code)'
    let { data } = term?.id ? await classesForTerm(term.id, cols) : { data: null }
    if (!data?.length) {
      // Term with no classes yet — fall back to all terms (mirrors the tutor
      // view below).
      ;({ data } = await classesAllTerms(cols))
    }
    if (!data) return
    const filtered = data.filter(c => {
      const code = c.courses?.course_code || ''
      const yr   = parseInt(code.split('.')[0])
      return yr === activeYear && subjectFromCourseCode(code) === activeSub
    })
    const dayOrder = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
    filtered.sort((a, b) => {
      const da = dayOrder.indexOf(a.day_of_week), db = dayOrder.indexOf(b.day_of_week)
      return da !== db ? da - db : (a.start_time || '').localeCompare(b.start_time || '')
    })
    setClasses(filtered)
    setActiveClass(null) // always reset to General when year/subject changes
  }, [activeYear, activeSub])

  useEffect(() => { if (staff) loadClasses() }, [staff, loadClasses])

  // Subjects for a year, narrowed to the hub scope when one is active.
  const subjectsFor = useCallback((year) => {
    const all = getSubjects(year)
    return scope ? all.filter(s => SUBJECT_FAMILY[scope].includes(s)) : all
  }, [scope])
  // Years that have at least one subject in scope (Chemistry → 11–12 only).
  const visibleYears = YEARS.filter(y => subjectsFor(y).length > 0)

  // Keep year + subject valid for the scope (and when the year changes).
  useEffect(() => {
    if (!visibleYears.includes(activeYear)) { setActiveYear(visibleYears[0]); return }
    const subjects = subjectsFor(activeYear)
    if (!subjects.includes(activeSub)) setActiveSub(subjects[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeYear, scope, subjectsFor])


  // Get public URL for a stored PDF
  const getPdfUrl = (path) => {
    if (!path) return null
    const { data } = supabase.storage.from('booklets').getPublicUrl(path)
    return data?.publicUrl ?? null
  }

  // Filtered view
  const visible = booklets.filter(b => b.year === activeYear && b.subject === activeSub)

  // Drag a booklet card onto another week box: move it there, or swap the two
  // when the target is occupied. Master-DB booklets carry their own term/week.
  const moveGeneral = async (b, term, week) => {
    setDragB(null); setOverGSlot(null)
    if (b.term_number === term && b.week === week) return
    const occ = visible.find(x => x.id !== b.id && x.term_number === term && x.week === week)
    if (occ) await supabase.from('booklets').update({ term_number: b.term_number, week: b.week }).eq('id', occ.id)
    await supabase.from('booklets').update({ term_number: term, week }).eq('id', b.id)
    load()
  }

  // Group by term
  const grouped = visible.reduce((acc, b) => {
    const key = b.term_number ? `Term ${b.term_number}` : 'No term'
    if (!acc[key]) acc[key] = []
    acc[key].push(b)
    return acc
  }, {})
  const termKeys = Object.keys(grouped).sort((a, b) => {
    const na = a === 'No term' ? 99 : parseInt(a.split(' ')[1])
    const nb = b === 'No term' ? 99 : parseInt(b.split(' ')[1])
    return na - nb
  })

  if (!staff) return null

  // Tutors get a read-only curriculum view of their own classes
  if (staff.role === 'tutor') return <TutorCurriculumPage staff={staff} scope={scope} />

  // The unscoped admin curriculum was retired in favour of the subject hubs —
  // old bookmarks land on the Mathematics hub.
  if (!scope) { router.replace('/tutor/resources/maths'); return null }

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      {/* Header */}
      <div className="bg-white border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Curriculum{scope ? ` — ${SCOPE_LABEL[scope]}` : ''}</h1>
            <p className="text-sm text-[#2A2035]/50 mt-0.5">
              {booklets.filter(b => SUBJECT_FAMILY[scope].includes(b.subject)).length} {SCOPE_LABEL[scope]} booklets · <a href={`/tutor/resources/${scope.toLowerCase()}`} className="text-[#325099] hover:underline">back to hub</a>
            </p>
          </div>
          <button
            onClick={() => { setAddPrefill({}); setCreating(true) }}
            className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition"
          >
            + New booklet
          </button>
        </div>

        {/* Year tabs */}
        <div className="max-w-7xl mx-auto px-6 md:px-10 flex gap-1 overflow-x-auto pb-0">
          {visibleYears.map(y => (
            <button key={y} onClick={() => setActiveYear(y)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeYear === y
                  ? 'border-[#325099] text-[#325099]'
                  : 'border-transparent text-[#2A2035]/50 hover:text-[#325099]'
              }`}>
              Year {y}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-10 pt-6">
        {/* Subject tabs (narrowed to the hub scope when one is active) */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {subjectsFor(activeYear).map(s => (
            <button key={s} onClick={() => setActiveSub(s)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold border transition ${
                activeSub === s
                  ? 'bg-[#325099] text-white border-[#325099]'
                  : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
              }`}>
              {s}
            </button>
          ))}
        </div>

        {/* Class tabs: General + one per class (tabs only if ≥1 class) */}
        {classes.length > 0 && (
          <div className="flex gap-1 mb-5 overflow-x-auto">
            {/* General tab */}
            <button onClick={() => setActiveClass(null)}
              className={`px-4 py-2 text-xs font-semibold rounded-xl border transition whitespace-nowrap ${
                activeClass === null
                  ? 'bg-[#325099] text-white border-[#325099]'
                  : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
              }`}>
              General
            </button>
            {/* One tab per class (show day+time if multiple, or just class name if one) */}
            {classes.map(cls => (
              <button key={cls.id} onClick={() => setActiveClass(cls.id)}
                className={`px-4 py-2 text-xs font-semibold rounded-xl border transition whitespace-nowrap ${
                  activeClass === cls.id
                    ? 'bg-[#325099] text-white border-[#325099]'
                    : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
                }`}>
                {classes.length === 1
                  ? `${cls.class_name} · ${cls.day_of_week} ${cls.start_time}`
                  : `${cls.day_of_week} ${cls.start_time}`}
                {classes.length > 1 && <span className="ml-1 opacity-60">· {cls.teacher}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Class term board */}
        {activeClass !== null && (() => {
          const cls         = classes.find(c => c.id === activeClass)
          const accentColor = getAccentColor(activeSub)
          const accentBg    = getAccentBg(activeSub)
          return cls ? <ClassTermBoard key={cls.id} cls={cls} year={activeYear} subject={activeSub} accentColor={accentColor} accentBg={accentBg} /> : null
        })()}

        {/* General curriculum (booklets from master DB, shown when General tab active or no classes) */}
        {activeClass === null && (loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase animate-pulse">Loading…</p>
          </div>
        ) : (
          <div className="pb-12">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {TERMS.map(termNum => {
                const byWeek = {}
                visible.filter(b => b.term_number === termNum).forEach(b => {
                  if (b.week != null) byWeek[b.week] = b
                })
                const assignedCount = Object.keys(byWeek).length
                const accentColor = getAccentColor(activeSub)
                const accentBg    = getAccentBg(activeSub)

                return (
                  <div key={termNum} className="flex flex-col min-w-0">
                    {/* Column header */}
                    <div
                      className="flex items-center justify-between px-3 py-2 rounded-xl mb-3"
                      style={{ background: accentBg }}
                    >
                      <span className="text-xs font-bold tracking-wide" style={{ color: accentColor }}>
                        Term {termNum}
                      </span>
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                        style={{ background: accentColor }}
                      >
                        {assignedCount}/10
                      </span>
                    </div>

                    {/* One row per week 1–10 */}
                    <div className="flex flex-col gap-2">
                      {Array.from({ length: 10 }, (_, i) => i + 1).map(week => {
                        const b = byWeek[week]
                        // Resolve all PDF paths for this booklet
                        const pdfPaths = b
                          ? (b.file_paths?.length ? b.file_paths : (b.file_path ? [b.file_path] : []))
                          : []

                        if (b) {
                          // ── Assigned card ──────────────────────────────
                          return (
                            <div
                              key={week}
                              draggable
                              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragB(b) }}
                              onDragEnd={() => { setDragB(null); setOverGSlot(null) }}
                              onDragOver={(e) => { if (dragB && dragB.id !== b.id) { e.preventDefault(); setOverGSlot(`${termNum}-${week}`) } }}
                              onDragLeave={() => setOverGSlot(s => (s === `${termNum}-${week}` ? null : s))}
                              onDrop={(e) => { e.preventDefault(); if (dragB) moveGeneral(dragB, termNum, week) }}
                              className={`bg-white rounded-xl border shadow-sm flex flex-col overflow-hidden hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${overGSlot === `${termNum}-${week}` ? 'border-[#325099] ring-2 ring-[#325099]/30' : 'border-[#E8EDF8] hover:border-[#C7D7FF]'} ${dragB?.id === b.id ? 'opacity-40' : ''}`}
                            >
                              <div className="h-[3px] w-full" style={{ background: accentColor }} />
                              <div className="px-3 pt-2.5 pb-2 flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="text-[9px] font-bold uppercase tracking-widest"
                                    style={{ color: accentColor }}
                                  >
                                    {weekLabel(activeSub, week)}
                                  </span>
                                  {b.is_exam && <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">Exam</span>}
                                  <StatusBadge status={b.status} />
                                </div>
                                <p className="text-[12px] font-bold text-[#062E63] leading-snug">{b.is_exam ? b.booklet_name : bookletLabel(b)}</p>
                                {b.notes && (
                                  <p className="text-[10px] text-[#2A2035]/45 line-clamp-1">{b.notes}</p>
                                )}
                              </div>
                              <div className="px-3 pb-2.5 flex items-center justify-between gap-2">
                                <div className="flex gap-2.5">
                                  <button onClick={() => setEditing(b)}
                                    className="text-[10px] font-semibold text-[#325099] hover:underline">Edit</button>
                                  <button onClick={() => setViewContent(b)}
                                    className="text-[10px] font-semibold text-[#325099]/70 hover:underline">Content</button>
                                  <button onClick={async () => {
                                    await supabase.from('booklets').update({ term_number: null, week: null }).eq('id', b.id)
                                    load()
                                  }} className="text-[10px] font-semibold text-[#2A2035]/30 hover:text-[#D97706] hover:underline transition">Unassign</button>
                                </div>
                                {b.is_exam ? (
                                  <ExamPdfButtons examId={b.exam_id} accentColor={accentColor} accentBg={accentBg} />
                                ) : pdfPaths.length > 0 ? (
                                  <div className="flex gap-1">
                                    {pdfPaths.map((path, i) => {
                                      const url = getPdfUrl(path)
                                      return url ? (
                                        <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-lg transition"
                                          style={{ background: accentBg, color: accentColor }}>
                                          📄 {pdfPaths.length > 1 ? `PDF ${i + 1}` : 'PDF'}
                                        </a>
                                      ) : null
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-[#2A2035]/20">No PDF</span>
                                )}
                              </div>
                            </div>
                          )
                        }

                        // ── Blank / unassigned slot ────────────────────
                        return (
                          <button
                            key={week}
                            onClick={() => setAssignSlot({ term: termNum, week })}
                            onDragOver={(e) => { if (dragB) { e.preventDefault(); setOverGSlot(`${termNum}-${week}`) } }}
                            onDragLeave={() => setOverGSlot(s => (s === `${termNum}-${week}` ? null : s))}
                            onDrop={(e) => { e.preventDefault(); if (dragB) moveGeneral(dragB, termNum, week) }}
                            className={`group w-full border border-dashed rounded-xl flex flex-col overflow-hidden transition text-left ${overGSlot === `${termNum}-${week}` ? 'border-[#325099] bg-[#F0F4FF] ring-2 ring-[#325099]/30' : 'border-[#DEE7FF] bg-[#FBFCFF] hover:border-[#325099] hover:bg-[#F8FAFF]'}`}
                          >
                            <div className="h-[3px] w-full bg-[#EEF2FB]" />
                            <div className="px-3 pt-2.5 pb-2 flex flex-col gap-0.5 flex-1">
                              <span
                                className="text-[9px] font-bold uppercase tracking-widest text-[#A9B4CC] group-hover:text-[#325099] transition"
                              >
                                {isChemistry(activeSub) ? 'Ln' : 'Wk'} {week}
                              </span>
                              <p className="text-[12px] font-semibold text-[#2A2035]/30 group-hover:text-[#325099]/60 transition leading-snug">
                                + assign booklet
                              </p>
                            </div>
                            <div className="px-3 pb-2.5 flex items-center justify-between gap-2">
                              <div className="flex gap-2.5">
                                <span className="text-[10px] text-transparent select-none">Edit</span>
                              </div>
                              <span className="text-[10px] text-transparent select-none">No PDF</span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Assign modal (General view) */}
      {assignSlot && (
        <AssignBookletModal
          year={activeYear}
          subject={activeSub}
          term={assignSlot.term}
          week={assignSlot.week}
          onClose={() => setAssignSlot(null)}
          onAssigned={() => { setAssignSlot(null); load() }}
          onCreateNew={() => {
            // Create a brand-new booklet prefilled to this term/week slot.
            setAddPrefill({ term_number: assignSlot.term, week: assignSlot.week })
            setAssignSlot(null)
            setCreating(true)
          }}
        />
      )}

      {/* Modals */}
      <ContentModal booklet={viewContent} onClose={() => setViewContent(null)} />
      {(editing || creating) && (
        <BookletModal
          booklet={editing}
          defaultYear={activeYear}
          defaultSubject={activeSub}
          defaultTerm={addPrefill.term_number}
          defaultWeek={addPrefill.week}
          onClose={() => { setEditing(null); setCreating(false); setAddPrefill({}) }}
          onSaved={() => { setEditing(null); setCreating(false); setAddPrefill({}); load() }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tutor-facing curriculum view — read-only, scoped to their own classes
// ─────────────────────────────────────────────────────────────────────────────
function TutorCurriculumPage({ staff, scope = null }) {
  const [classes,       setClasses]       = useState([])  // classes this tutor teaches this term
  const [activeClassId, setActiveClassId] = useState(null)
  const [assignments,   setAssignments]   = useState([])  // class_booklet_assignments rows
  const [currentTerm,   setCurrentTerm]   = useState(null)
  const [loadingCls,    setLoadingCls]    = useState(true)
  const [loadingAsgn,   setLoadingAsgn]   = useState(false)

  // ── Load current term + tutor's classes ────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const terms = await fetchAllTerms()
      const term  = getEnrolmentTerm(terms)
      setCurrentTerm(term)

      const firstName = (staff.full_name || '').split(' ')[0]

      // Classes for this term where teacher name starts with tutor's first name
      const teacherCols = 'id, class_name, teacher, day_of_week, start_time, end_time, courses(course_code)'
      const { data: rows } = term?.id
        ? await classesForTerm(term.id, teacherCols)
            .ilike('teacher', firstName + '%')
            .order('day_of_week')
            .order('start_time')
        : { data: null }

      // Hub scope: keep only classes whose course belongs to the subject family.
      const inScope = (list) => scope
        ? list.filter(c => SUBJECT_FAMILY[scope].includes(subjectFromCourseCode(c.courses?.course_code)))
        : list
      const cls = inScope(rows || [])

      // If no classes found in current term, fall back to all terms (tutor may
      // be viewing between terms)
      if (cls.length === 0) {
        const { data: fallback } = await classesAllTerms(teacherCols)
          .ilike('teacher', firstName + '%')
          .order('day_of_week')
          .order('start_time')
        const all = inScope(fallback || [])
        setClasses(all)
        if (all.length) setActiveClassId(all[0].id)
      } else {
        setClasses(cls)
        setActiveClassId(cls[0].id)
      }

      setLoadingCls(false)
    }
    init()
  }, [staff, scope])

  // ── Load assignments for selected class ────────────────────────────────────
  useEffect(() => {
    if (!activeClassId) return
    setLoadingAsgn(true)
    supabase
      .from('class_booklet_assignments')
      .select('term_number, week, booklets(id, booklet_name, topic, status, file_paths, file_path, year, subject, is_exam, exam_id)')
      .eq('class_id', activeClassId)
      .then(({ data }) => {
        setAssignments(data || [])
        setLoadingAsgn(false)
      })
  }, [activeClassId])

  // Build slot lookup: "termNum-week" → booklet object
  const slotMap = useMemo(() => {
    const m = {}
    for (const a of assignments) m[`${a.term_number}-${a.week}`] = a.booklets
    return m
  }, [assignments])

  // Current week within the current term
  const currentWeek = useMemo(() => {
    if (!currentTerm) return null
    const today = new Date()
    const start = new Date(currentTerm.start_date + 'T00:00:00')
    const diff  = today - start
    if (diff < 0) return null
    const w = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1
    return w >= 1 && w <= 10 ? w : null
  }, [currentTerm])

  const curTermNum = currentTerm?.term_number

  // Infer subject accent from course_code (mirrors admin logic)
  const inferSubject = (cls) => {
    const code   = cls?.courses?.course_code || ''
    const parts  = code.split('.')
    const yr     = parseInt(parts[0])
    const suffix = (parts[1] || '').toUpperCase()
    if (yr >= 11) {
      if (suffix.startsWith('M1')) return 'Standard Maths'
      if (suffix.startsWith('M2')) return 'Adv Maths'
      if (suffix.startsWith('M3')) return 'Ext 1 Maths'
      if (suffix.startsWith('M4')) return 'Ext 2 Maths'
      if (suffix.startsWith('E'))  return 'English'
      if (suffix.startsWith('C'))  return 'Chemistry'
    }
    if (suffix.startsWith('M')) return 'Maths'
    if (suffix.startsWith('E')) return 'English'
    if (suffix.startsWith('C')) return 'Chemistry'
    return 'Maths'
  }

  const getPdfUrl = (path) => {
    if (!path) return null
    const { data } = supabase.storage.from('booklets').getPublicUrl(path)
    return data?.publicUrl ?? null
  }

  const activeClass = classes.find(c => c.id === activeClassId) ?? null
  const subject     = inferSubject(activeClass)
  const accent      = getAccentColor(subject)
  const accentBg    = getAccentBg(subject)

  const totalAssigned = assignments.length

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin={false} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">My Curriculum</h1>
            <p className="text-sm text-[#2A2035]/50 mt-0.5">
              {classes.length === 0
                ? 'Booklet schedule across your classes'
                : `${classes.length} class${classes.length !== 1 ? 'es' : ''} this term`}
              {currentTerm && (
                <span className="ml-2 text-[#325099]/60">· {currentTerm.name}</span>
              )}
            </p>
          </div>
          {currentTerm && curTermNum && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#EEF4FF] text-[#325099] border border-[#DEE7FF] px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#325099]" />
              Term {curTermNum}{currentWeek ? `, Week ${currentWeek}` : ''}
            </span>
          )}
        </div>

        {/* Class tabs */}
        {classes.length > 0 && (
          <div className="max-w-7xl mx-auto px-6 md:px-10 flex gap-0 overflow-x-auto">
            {classes.map(cls => {
              const sub = inferSubject(cls)
              const col = getAccentColor(sub)
              const isActive = cls.id === activeClassId
              return (
                <button
                  key={cls.id}
                  onClick={() => setActiveClassId(cls.id)}
                  className={`px-4 py-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap flex flex-col items-start ${
                    isActive
                      ? 'border-[#325099] text-[#062E63]'
                      : 'border-transparent text-[#2A2035]/50 hover:text-[#325099] hover:border-[#DEE7FF]'
                  }`}
                >
                  <span>{cls.class_name || 'Untitled'}</span>
                  {(cls.day_of_week || cls.start_time) && (
                    <span className="text-[10px] font-normal mt-0.5" style={{ color: isActive ? col : undefined }}>
                      {cls.day_of_week?.slice(0, 3)}{cls.start_time ? ` · ${fmtTime(cls.start_time)}` : ''}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 md:px-10 pt-6 pb-20">

        {/* Loading / empty states */}
        {loadingCls ? (
          <div className="flex justify-center py-20">
            <div className="w-5 h-5 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : classes.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-[#DEE7FF]">
            <p className="text-3xl mb-3">📚</p>
            <p className="text-sm font-semibold text-[#2A2035]">No classes found for this term.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1 max-w-xs mx-auto">
              Classes are matched to your name. If something looks wrong, let a director know.
            </p>
          </div>
        ) : (
          <>
            {/* Class info strip */}
            {activeClass && (
              <div className="flex items-center gap-3 mb-6 flex-wrap">
                <div
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border"
                  style={{ background: accentBg, color: accent, borderColor: accent + '33' }}
                >
                  <span>{activeClass.class_name}</span>
                  {activeClass.day_of_week && (
                    <span className="opacity-60 font-normal">
                      {activeClass.day_of_week} · {fmtTime(activeClass.start_time)}–{fmtTime(activeClass.end_time)}
                    </span>
                  )}
                </div>
                <span className="text-xs text-[#325099]/50">
                  {totalAssigned} booklet{totalAssigned !== 1 ? 's' : ''} scheduled across all terms
                </span>
              </div>
            )}

            {/* No assignments yet */}
            {!loadingAsgn && totalAssigned === 0 && (
              <div className="text-center py-16 bg-white rounded-2xl border border-[#DEE7FF]">
                <p className="text-3xl mb-3">📋</p>
                <p className="text-sm font-semibold text-[#2A2035]">No curriculum set for this class yet.</p>
                <p className="text-xs text-[#2A2035]/50 mt-1">A director will assign booklets to each week shortly.</p>
              </div>
            )}

            {/* Loading assignments */}
            {loadingAsgn && (
              <div className="flex justify-center py-16">
                <div className="w-5 h-5 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* ── 4-term curriculum grid ──────────────────────────────────── */}
            {!loadingAsgn && totalAssigned > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(termNum => {
                  const isCurTerm  = termNum === curTermNum
                  const termColor  = isCurTerm ? accent    : '#64748B'
                  const termBgCol  = isCurTerm ? accentBg  : '#F1F5F9'
                  const scheduled  = Array.from({ length: 10 }, (_, i) => i + 1)
                    .filter(w => slotMap[`${termNum}-${w}`]).length

                  return (
                    <div key={termNum}>
                      {/* Term header */}
                      <div
                        className="flex items-center justify-between px-3 py-2 rounded-xl mb-2"
                        style={{ background: termBgCol }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold tracking-wide" style={{ color: termColor }}>
                            Term {termNum}
                          </span>
                          {isCurTerm && (
                            <span
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white"
                              style={{ background: termColor }}
                            >
                              current
                            </span>
                          )}
                        </div>
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: termColor, color: 'white' }}
                        >
                          {scheduled}/10
                        </span>
                      </div>

                      {/* Week rows */}
                      <div className="flex flex-col gap-1.5">
                        {Array.from({ length: 10 }, (_, i) => i + 1).map(week => {
                          const b            = slotMap[`${termNum}-${week}`]
                          const isCurWeek    = isCurTerm && week === currentWeek
                          const pdfPaths     = b
                            ? (b.file_paths?.length ? b.file_paths : (b.file_path ? [b.file_path] : []))
                            : []

                          if (b) {
                            return (
                              <div
                                key={week}
                                className={`bg-white rounded-xl overflow-hidden transition-all ${
                                  isCurWeek
                                    ? 'border-2 shadow-md ring-2 ring-offset-1'
                                    : 'border border-[#E8EDF8] shadow-sm hover:shadow-md hover:border-[#C7D7FF]'
                                }`}
                                style={isCurWeek ? { borderColor: accent, ringColor: accent + '30' } : {}}
                              >
                                {/* Colour bar */}
                                <div className="h-[3px] w-full" style={{ background: isCurWeek ? accent : accent + '80' }} />
                                <div className="px-3 pt-2 pb-2">
                                  {/* Week label + PDF links */}
                                  <div className="flex items-start justify-between gap-1 mb-0.5">
                                    <span
                                      className="text-[9px] font-bold uppercase tracking-widest leading-none"
                                      style={{ color: isCurWeek ? accent : accent + 'AA' }}
                                    >
                                      Wk {week}{isCurWeek ? ' ●' : ''}
                                    </span>
                                    {b.is_exam ? (
                                      <ExamPdfButtons examId={b.exam_id} accentColor={accent} accentBg={accentBg} />
                                    ) : pdfPaths.length > 0 ? (
                                      <div className="flex gap-1 flex-wrap justify-end">
                                        {pdfPaths.slice(0, 3).map((path, pi) => {
                                          const url = getPdfUrl(path)
                                          return url ? (
                                            <a
                                              key={pi}
                                              href={url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-[9px] font-bold px-1.5 py-0.5 rounded-md hover:opacity-75 transition"
                                              style={{ background: accentBg, color: accent }}
                                            >
                                              {pdfPaths.length > 1 ? `PDF ${pi + 1}` : '📄 PDF'}
                                            </a>
                                          ) : null
                                        })}
                                        {pdfPaths.length > 3 && (
                                          <span className="text-[9px] text-[#2A2035]/30">+{pdfPaths.length - 3}</span>
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                  {/* Booklet name */}
                                  <p className="text-[11px] font-bold text-[#062E63] leading-snug">
                                    {b.is_exam ? <><span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] mr-1">Exam</span>{b.booklet_name}</> : bookletLabel(b)}
                                    <span className="ml-1.5"><StatusBadge status={b.status} /></span>
                                  </p>
                                  {/* Topic */}
                                  {b.topic && (
                                    <p
                                      className="text-[9px] font-medium mt-0.5 truncate"
                                      style={{ color: accent }}
                                    >
                                      {b.topic}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )
                          }

                          // Unscheduled slot
                          return (
                            <div
                              key={week}
                              className={`rounded-xl overflow-hidden ${
                                isCurWeek
                                  ? 'border border-[#CBD5E1] bg-[#F8FAFF]'
                                  : 'border border-dashed border-[#E2E8F0]'
                              }`}
                            >
                              <div className="h-[3px] w-full" />
                              <div className="px-3 pt-2 pb-2">
                                <span className={`text-[9px] font-bold uppercase tracking-widest ${isCurWeek ? 'text-[#94A3B8]' : 'text-[#CBD5E1]'}`}>
                                  Wk {week}{isCurWeek ? ' ●' : ''}
                                </span>
                                <p className="text-[10px] text-[#CBD5E1] mt-0.5">Not scheduled</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

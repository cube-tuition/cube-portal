'use client'
import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import BookletContentView from '../../../../components/booklet/BookletContentView'
import BookletInfoModal from '../../../../components/booklet/BookletInfoModal'
import { openTotal } from '../../../../lib/bookletChecklist'
import { SUBJECT_FAMILIES, SCOPE_LABEL } from '../../../../lib/qbank'
import { curriculumTerms } from '../../../../lib/terms'
import { fetchModuleNames } from '../../../../lib/syllabus'
import {
  isChemistry, chemModuleNumber, chemLessonNumber, chemModuleLabel,
} from '../../../../lib/format'

const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]

const SUBJECTS_BY_YEAR = {
  11: ['English', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Chemistry'],
  12: ['English', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths', 'Chemistry'],
}
const getSubjects = (year) => SUBJECTS_BY_YEAR[year] || ['Maths', 'English']

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
  if (!b?.year) return b?.booklet_name ?? ''
  const code = SUBJECT_CODE[b.subject] || (b.subject || '')[0] || ''
  return `${b.year}.${code}. ${b.booklet_name}`
}

// Bucket for booklets with nothing to group them by — a missing topic, or a
// Chemistry name that doesn't follow M<module>L<lesson>. Always sorts last.
const UNGROUPED = '__ungrouped'

// Workbook readiness statuses (booklets.status) and their badge styles.
const WORKBOOK_STATUSES = ['Not Started', 'In Progress', 'Needs Improvement', 'Complete']
const STATUS_CLS = {
  'Complete':          'bg-emerald-50 text-emerald-800 border-emerald-300',
  'Needs Improvement': 'bg-amber-50 text-amber-800 border-amber-300',
  'In Progress':       'bg-blue-50 text-blue-800 border-blue-300',
  'Not Started':       'bg-gray-50 text-gray-500 border-gray-300',
}

// ── Manage Topics Panel ───────────────────────────────────────────────────────
function ManageTopicsPanel({ year, subject, accentColor, accentBg, onClose, onTopicsChanged }) {
  const [topics,    setTopics]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [newName,   setNewName]   = useState('')
  const [adding,    setAdding]    = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deletingId,  setDeletingId]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('topics')
      .select('id, name')
      .eq('year', year)
      .eq('subject', subject)
      .order('name')
    setTopics(data || [])
    setLoading(false)
  }, [year, subject])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    const { data, error } = await supabase.from('topics').insert({ year, subject, name }).select().single()
    if (!error && data) { setTopics(t => [...t, data].sort((a, b) => a.name.localeCompare(b.name))) }
    setNewName(''); setAdding(false)
    onTopicsChanged()
  }

  const handleRename = async (id) => {
    const name = renameDraft.trim()
    if (!name) return
    const oldName = topics.find(t => t.id === id)?.name
    const { error } = await supabase.from('topics').update({ name }).eq('id', id)
    if (!error) {
      // Also update booklets that used the old topic name
      await supabase.from('booklets').update({ topic: name }).eq('year', year).eq('subject', subject).eq('topic', oldName)
      setTopics(t => t.map(x => x.id === id ? { ...x, name } : x).sort((a, b) => a.name.localeCompare(b.name)))
      onTopicsChanged()
    }
    setRenamingId(null)
  }

  const handleDelete = async (id) => {
    if (deletingId !== id) { setDeletingId(id); return }
    const name = topics.find(t => t.id === id)?.name
    await supabase.from('topics').delete().eq('id', id)
    // Null out topic on booklets that used it
    await supabase.from('booklets').update({ topic: null }).eq('year', year).eq('subject', subject).eq('topic', name)
    setTopics(t => t.filter(x => x.id !== id))
    setDeletingId(null)
    onTopicsChanged()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white w-full sm:w-80 sm:h-full sm:max-h-screen h-[70vh] rounded-t-2xl sm:rounded-none shadow-2xl flex flex-col border-l border-[#E8EDF8]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0F4FF]">
          <div>
            <p className="text-xs font-bold text-[#062E63]">Topic Bank</p>
            <p className="text-[10px] text-[#2A2035]/40 mt-0.5">Year {year} · {subject}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full text-[#2A2035]/30 hover:bg-[#F0F4FF] transition text-base">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3">
          {loading ? (
            <p className="text-xs text-[#2A2035]/30 animate-pulse text-center py-6">Loading…</p>
          ) : topics.length === 0 ? (
            <p className="text-xs text-[#2A2035]/30 text-center py-6 italic">No topics yet for this year/subject.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {topics.map(t => (
                <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-[#F8FAFF] group">
                  {renamingId === t.id ? (
                    <>
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={e => setRenameDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(t.id); if (e.key === 'Escape') setRenamingId(null) }}
                        className="flex-1 border border-[#325099] rounded px-2 py-1 text-xs focus:outline-none"
                      />
                      <button onClick={() => handleRename(t.id)} className="text-[10px] font-bold text-[#059669] shrink-0">✓</button>
                      <button onClick={() => setRenamingId(null)} className="text-[10px] font-bold text-[#2A2035]/30 hover:text-red-400 shrink-0">✕</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-xs font-medium text-[#2A2035] truncate">{t.name}</span>
                      <button
                        onClick={() => { setRenamingId(t.id); setRenameDraft(t.name) }}
                        className="text-[9px] font-semibold opacity-0 group-hover:opacity-100 transition"
                        style={{ color: accentColor }}
                      >Rename</button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className={`text-[9px] font-semibold opacity-0 group-hover:opacity-100 transition ${deletingId === t.id ? 'text-red-500 opacity-100' : 'text-[#2A2035]/30'}`}
                        title={deletingId === t.id ? 'Click again to confirm' : 'Delete topic'}
                      >{deletingId === t.id ? 'Confirm?' : 'Delete'}</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#F0F4FF]">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="New topic name…"
              className="flex-1 border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="px-3 py-2 text-xs font-bold text-white rounded-lg transition disabled:opacity-40"
              style={{ background: accentColor }}
            >
              {adding ? '…' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const INP   = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'


// ── Booklet Form Modal (add + edit) ──────────────────────────────────────────
function BookletFormModal({ booklet, defaultYear, defaultSubject, topicBank = [], moduleNames = {}, onClose, onSaved }) {
  const isEdit = !!booklet
  const [form, setForm] = useState({
    booklet_name: booklet?.booklet_name ?? '',
    year:         booklet?.year         ?? defaultYear,
    subject:      booklet?.subject      ?? defaultSubject,
    topic:        booklet?.topic        ?? '',
    term_number:  booklet?.term_number  ?? '',
    week:         booklet?.week         ?? '',
    notes:        booklet?.notes        ?? '',
    content:      booklet?.content      ?? '',
  })

  // Terms follow the year level (Year 11 has no Term 4). A value already stored
  // outside that range stays selectable so editing can't silently clear it.
  const termOptions = useCallback(() => {
    const base = curriculumTerms(form.year)
    const cur = Number(form.term_number)
    return Number.isFinite(cur) && cur > 0 && !base.includes(cur) ? [...base, cur].sort() : base
  }, [form.year, form.term_number])()

  // Existing files (edit mode)
  const [existingPdfPaths,  setExistingPdfPaths]  = useState(
    booklet ? (booklet.file_paths?.length ? booklet.file_paths : (booklet.file_path ? [booklet.file_path] : [])) : []
  )
  const [existingPdfNames,  setExistingPdfNames]  = useState(booklet?.pdf_filenames  || [])

  // New files staged for upload
  const [newPdfFiles,  setNewPdfFiles]  = useState([])

  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const pdfRef  = useRef()

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const uploadFiles = async (files, folder) => {
    const paths = [], names = []
    for (const file of files) {
      const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error } = await supabase.storage.from('booklets').upload(path, file, { upsert: true })
      if (error) throw new Error(error.message)
      paths.push(path)
      names.push(file.name.replace(/\.[^.]+$/, ''))
    }
    return { paths, names }
  }

  const handleSubmit = async () => {
    if (!form.booklet_name.trim()) { setErr('Booklet name is required.'); return }
    setSaving(true); setErr('')
    const folder = `y${form.year}/${String(form.subject).toLowerCase()}`

    try {
      // Remove deleted existing files from storage
      if (isEdit) {
        const origPdf  = booklet.file_paths?.length ? booklet.file_paths : (booklet.file_path ? [booklet.file_path] : [])
        const removedPdf  = origPdf.filter(p => !existingPdfPaths.includes(p))
        if (removedPdf.length)  await supabase.storage.from('booklets').remove(removedPdf)
      }

      const { paths: newPdfPaths,  names: newPdfNames  } = await uploadFiles(newPdfFiles,  folder)

      const finalPdfPaths  = [...existingPdfPaths,  ...newPdfPaths]
      const finalPdfNames  = [...existingPdfNames,  ...newPdfNames]

      const payload = {
        booklet_name:   form.booklet_name.trim(),
        year:           Number(form.year),
        subject:        form.subject,
        topic:          form.topic.trim() || null,
        term_number:    form.term_number !== '' ? Number(form.term_number) : null,
        week:           form.week        !== '' ? Number(form.week)        : null,
        notes:          form.notes.trim() || null,
        content:        form.content.trim() || null,
        file_path:      finalPdfPaths[0]  ?? null,
        file_paths:     finalPdfPaths,
        pdf_filenames:  finalPdfNames,
      }

      const { error } = isEdit
        ? await supabase.from('booklets').update(payload).eq('id', booklet.id)
        : await supabase.from('booklets').insert(payload)
      if (error) throw new Error(error.message)
      onSaved()
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
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

          {/* Topic — or, for Chemistry, the module the name already states. */}
          {isChemistry(form.subject) ? (
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Module</label>
              <p className="text-[11px] text-[#2A2035]/50 bg-[#F8FAFF] border border-[#E8EDF8] rounded-lg px-3 py-2.5">
                {chemModuleNumber(form.booklet_name) != null ? (
                  <>Read from the name: <span className="font-semibold text-[#0F766E]">{chemModuleLabel(chemModuleNumber(form.booklet_name), moduleNames)}</span></>
                ) : (
                  <>Name this booklet <span className="font-semibold">M&lt;module&gt;L&lt;lesson&gt;</span> — e.g. <span className="font-semibold">M3L2</span> — and it files itself under Module 3.</>
                )}
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Topic <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
              <select value={form.topic} onChange={set('topic')} className={INP}>
                <option value="">— No topic —</option>
                {topicBank.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              {topicBank.length === 0 && (
                <p className="text-[10px] text-[#2A2035]/40 mt-1">No topics in the bank yet for this year/subject. Add some via the 🏷 Topics button.</p>
              )}
            </div>
          )}

          {/* Term + Week */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Term <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
              <select value={form.term_number} onChange={set('term_number')} className={INP}>
                <option value="">—</option>
                {termOptions.map(t => <option key={t} value={t}>Term {t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Week <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
              <input type="number" min={1} max={10} value={form.week} onChange={set('week')} placeholder="e.g. 3" className={INP} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Notes <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
            <textarea value={form.notes} onChange={set('notes')} rows={6} placeholder="Notes about this booklet — what to emphasise, what to skip, how it went, anything the next tutor should know…" className={INP + ' resize-y leading-relaxed'} />
            <p className="text-[10px] text-[#2A2035]/40 mt-1">Staff only — never shown to students and never printed in the PDF.</p>
          </div>

          {/* Content — free text for most subjects. Chemistry generates it from the
              syllabus dotpoints drawn on each section header in the builder, so a
              typed summary here would only go stale. */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Content{form.subject !== 'Chemistry' && <span className="font-normal text-[#2A2035]/40"> (optional)</span>}</label>
            {form.subject === 'Chemistry' ? (
              <p className="text-[11px] text-[#2A2035]/50 bg-[#F8FAFF] border border-[#E8EDF8] rounded-lg px-3 py-2.5">
                Generated from the syllabus dotpoints each section header draws — edit it on the
                booklet’s <span className="font-semibold">Content page</span> in the workbook builder.
              </p>
            ) : (
              <>
                <textarea value={form.content} onChange={set('content')} rows={5} placeholder={'What\'s in this booklet? e.g.\n• Area of triangles\n• Area of composite shapes\n• 12 practice questions'} className={INP + ' resize-y'} />
                <p className="text-[10px] text-[#2A2035]/40 mt-1">Shown via the “Content” link on the booklet row.</p>
              </>
            )}
          </div>

          {/* PDFs */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">PDFs <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
            {existingPdfPaths.map((path, i) => (
              <div key={path} className="flex items-center justify-between px-3 py-2 mb-1.5 bg-[#EEF4FF] rounded-lg">
                <span className="text-xs font-semibold text-[#325099] truncate">📄 {existingPdfNames[i] || `PDF ${i + 1}`}</span>
                <button onClick={() => { setExistingPdfPaths(p => p.filter((_, j) => j !== i)); setExistingPdfNames(p => p.filter((_, j) => j !== i)) }}
                  className="text-[10px] text-red-400 hover:text-red-600 font-semibold ml-2 shrink-0">Remove</button>
              </div>
            ))}
            {newPdfFiles.map((f, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 mb-1.5 bg-[#F0F4FF] rounded-lg">
                <span className="text-xs font-semibold text-[#325099] truncate">📄 {f.name}</span>
                <button onClick={() => setNewPdfFiles(p => p.filter((_, j) => j !== i))}
                  className="text-[10px] text-red-400 hover:text-red-600 font-semibold ml-2 shrink-0">Remove</button>
              </div>
            ))}
            <div onClick={() => pdfRef.current?.click()}
              className="border-2 border-dashed border-[#DEE7FF] rounded-xl px-4 py-3 text-center cursor-pointer hover:border-[#325099] hover:bg-[#F8FAFF] transition">
              <p className="text-xs text-[#2A2035]/40">{(existingPdfPaths.length + newPdfFiles.length) > 0 ? '+ Add another PDF' : 'Click to attach PDF(s)'}</p>
            </div>
            <input ref={pdfRef} type="file" accept="application/pdf" multiple className="hidden"
              onChange={e => { setNewPdfFiles(p => [...p, ...Array.from(e.target.files || [])]); e.target.value = '' }} />
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#F0F4FF] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 text-xs font-semibold bg-[#325099] text-white rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Booklet'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MasterDatabasePage() {
  return <Suspense><MasterDatabaseInner /></Suspense>
}

function MasterDatabaseInner() {
  const router = useRouter()
  // Subject-hub scope (?subject=Maths|English|Chemistry): narrows the year and
  // subject tabs to that family. Absent → unchanged behaviour.
  const searchParams = useSearchParams()
  const scopeParam = searchParams.get('subject')
  const scope = SUBJECT_FAMILIES[scopeParam] ? scopeParam : null

  // The unscoped master database was retired in favour of the subject hubs —
  // old bookmarks land on the Mathematics hub.
  useEffect(() => {
    if (!scope) router.replace('/tutor/resources/maths')
  }, [scope, router])
  const [staff,    setStaff]    = useState(null)
  const [booklets, setBooklets] = useState([])
  const [builds,   setBuilds]   = useState([])   // booklet_builds (workbook builder)
  const [creatingWb, setCreatingWb] = useState(false)
  const [loading,  setLoading]  = useState(true)

  const [activeYear, setActiveYear] = useState(5)
  const [activeSub,  setActiveSub]  = useState('Maths')
  const [search,     setSearch]     = useState('')
  const [groupFilter, setGroupFilter] = useState('')   // '' = every topic/module
  const [showAdd,    setShowAdd]    = useState(false)

  const [infoFor,        setInfoFor]        = useState(null)   // booklet whose info modal is open
  const [deleteBooklet,  setDeleteBooklet]  = useState(null)   // booklet pending deletion
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting,       setDeleting]       = useState(false)
  const [showTopics,     setShowTopics]     = useState(false)
  const [topicBank,      setTopicBank]      = useState([])
  // Chemistry module number → syllabus module name, for the group headings.
  const [moduleNames,    setModuleNames]    = useState({})

  useEffect(() => {
    getAuthProfile().then(({ user, profile }) => {
      if (!user) { router.push('/'); return }
      if (!profile || profile.role !== 'admin') { router.push('/tutor'); return }
      setStaff(profile)
    })
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: bd }] = await Promise.all([
      supabase
        .from('booklets')
        .select('id, booklet_name, year, subject, topic, status, term_number, week, notes, fixes, suggestions, content, file_path, file_paths, pdf_filenames, delivery')
        .order('topic', { nullsFirst: false })
        .order('booklet_name'),
      supabase
        // `content` comes along because Chemistry booklets generate their content
        // summary from the sections' drawn syllabus dotpoints — it lives on the
        // build, not on the booklets row.
        .from('booklet_builds')
        .select('id, title, year, subject, topic, status, booklet_id, updated_at, content, doc_type')
        .order('updated_at', { ascending: false }),
    ])
    setBooklets(data || [])
    setBuilds(bd || [])
    setLoading(false)
  }, [])

  // Create a new workbook (builder) and jump straight into it. Senior English
  // (Year 7+) workbooks first choose Physical vs Online: an online workbook is
  // built with the same blocks but delivered as a typeable student doc instead
  // of a printed PDF.
  const [deliveryChoice, setDeliveryChoice] = useState(false)
  const createWorkbook = async (delivery = 'physical') => {
    if (delivery === 'ask') { setDeliveryChoice(true); return }
    setDeliveryChoice(false)
    setCreatingWb(true)
    const { data, error } = await supabase.from('booklet_builds')
      .insert({ title: 'Untitled workbook', subject: activeSub, year: activeYear, blocks: [], delivery })
      .select('id').single()
    setCreatingWb(false)
    if (error) { alert('Could not create workbook: ' + error.message); return }
    router.push(`/tutor/booklets/builder/${data.id}`)
  }
  const asksDelivery = activeSub === 'English' && Number(activeYear) >= 7

  const deleteWorkbook = async (wb) => {
    if (!confirm(`Delete "${wb.title || 'Untitled workbook'}"? This can't be undone.`)) return
    await supabase.from('booklet_builds').delete().eq('id', wb.id)
    setBuilds(bs => bs.filter(x => x.id !== wb.id))
  }

  // Duplicate an existing workbook build into a fresh, unlinked draft — e.g. copy
  // the Year 5 booklet and adjust it into a Year 6 one, without rebuilding it. The
  // copy keeps all content (blocks, cover, topic, doc type) but starts as a draft
  // with no booklet_id, so you set its year/title in the builder and save it as a
  // new curriculum booklet.
  const [duplicating, setDuplicating] = useState(null)
  const duplicateWorkbook = async (sourceId) => {
    setDuplicating(sourceId)
    // The list rows omit blocks/cover/etc., so pull the full source row first.
    const { data: src, error: e1 } = await supabase.from('booklet_builds')
      .select('title, year, subject, topic, blocks, doc_type, cover, syllabus_points, content, qbank_topic_ids')
      .eq('id', sourceId).single()
    if (e1 || !src) { setDuplicating(null); alert('Could not read the source workbook: ' + (e1?.message || 'not found')); return }
    const { data, error } = await supabase.from('booklet_builds')
      .insert({
        title: `${src.title || 'Untitled workbook'} (copy)`,
        year: src.year, subject: src.subject, topic: src.topic || null,
        blocks: src.blocks || [], doc_type: src.doc_type || 'booklet',
        cover: src.cover ?? null, syllabus_points: src.syllabus_points ?? [],
        content: src.content ?? null, qbank_topic_ids: src.qbank_topic_ids ?? null,
        status: 'draft', booklet_id: null,
      })
      .select('id').single()
    setDuplicating(null)
    if (error) { alert('Could not duplicate the workbook: ' + error.message); return }
    router.push(`/tutor/booklets/builder/${data.id}`)
  }

  useEffect(() => { if (staff) load() }, [staff, load])

  // Subjects for a year, narrowed to the hub scope when one is active.
  const subjectsFor = useCallback((year) => {
    const all = getSubjects(year)
    return scope ? all.filter(su => SUBJECT_FAMILIES[scope].includes(su)) : all
  }, [scope])
  // Years with at least one subject in scope (Chemistry → 11–12 only).
  const visibleYears = YEARS.filter(y => subjectsFor(y).length > 0)

  // Keep year + subject valid for the scope (and when the year changes).
  useEffect(() => {
    if (!visibleYears.includes(activeYear)) { setActiveYear(visibleYears[0]); return }
    const subjects = subjectsFor(activeYear)
    if (!subjects.includes(activeSub)) setActiveSub(subjects[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeYear, scope, subjectsFor])

  const loadTopicBank = useCallback(async () => {
    const { data } = await supabase
      .from('topics').select('id, name')
      .eq('year', activeYear).eq('subject', activeSub)
      .order('name')
    setTopicBank(data || [])
  }, [activeYear, activeSub])

  useEffect(() => { if (staff) loadTopicBank() }, [staff, loadTopicBank])

  // Module names for the Chemistry headings — four rows, and the numbering runs
  // 1–8 across both years, so one fetch covers every Chemistry tab.
  useEffect(() => {
    if (!staff || !isChemistry(activeSub)) return
    fetchModuleNames('Chemistry').then(setModuleNames)
  }, [staff, activeSub])


  const handleBookletUpdated = (updated) => {
    setBooklets(bs => bs.map(b => b.id === updated.id ? updated : b))
  }

  // Workbook readiness status — saved on change from the inline badge select.
  const saveStatus = async (id, status) => {
    setBooklets(bs => bs.map(b => b.id === id ? { ...b, status } : b))
    const { error } = await supabase.from('booklets').update({ status }).eq('id', id)
    if (error) { alert('Could not save status: ' + error.message); load() }
  }

  // Every workbook is editable in the builder at any time: open its linked
  // build, creating an empty draft linked to the booklet on first open.
  const [openingBuilder, setOpeningBuilder] = useState(null)
  const openInBuilder = async (b) => {
    setOpeningBuilder(b.id)
    const { data, error } = await supabase.from('booklet_builds')
      .insert({ title: b.booklet_name, year: b.year, subject: b.subject, topic: b.topic || null, blocks: [], status: 'draft', booklet_id: b.id })
      .select('id').single()
    setOpeningBuilder(null)
    if (error) { alert('Could not create the workbook in the builder: ' + error.message); return }
    router.push(`/tutor/booklets/builder/${data.id}`)
  }

  // Permanently delete a booklet: its PDFs in storage, any curriculum
  // assignments, and unlink any workbook build (reverting it to a draft).
  const handleDeleteBooklet = async () => {
    const b = deleteBooklet
    if (!b) return
    setDeleting(true)
    try {
      const pdfPaths = b.file_paths?.length ? b.file_paths : (b.file_path ? [b.file_path] : [])
      if (pdfPaths.length) await supabase.storage.from('booklets').remove(pdfPaths)
      await supabase.from('class_booklet_assignments').delete().eq('booklet_id', b.id)
      await supabase.from('booklet_builds').update({ booklet_id: null, status: 'draft' }).eq('booklet_id', b.id)
      const { error } = await supabase.from('booklets').delete().eq('id', b.id)
      if (error) throw error
      setBooklets(bs => bs.filter(x => x.id !== b.id))
      setDeleteBooklet(null); setDeleteConfirmText('')
    } catch (e) {
      alert('Could not delete booklet: ' + e.message)
    } finally {
      setDeleting(false)
    }
  }

  const tabBooklets = booklets.filter(b => {
    if (b.year !== activeYear || b.subject !== activeSub) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      // Chemistry has no topic to search — its module heading stands in, so
      // "module 3" and "reactive" both find the M3 lessons.
      const grouping = isChemistry(b.subject)
        ? chemModuleLabel(chemModuleNumber(b.booklet_name), moduleNames)
        : b.topic
      return (
        b.booklet_name?.toLowerCase().includes(q) ||
        grouping?.toLowerCase().includes(q) ||
        b.notes?.toLowerCase().includes(q)
      )
    }
    return true
  })

  // Grouping: every subject groups by its topic bank — except Chemistry, which
  // runs to the module sequence and carries the module in the booklet name
  // ("M3L2" → module 3), so its groups are derived rather than assigned.
  const chemTab = isChemistry(activeSub)
  const groupMap = {}
  for (const b of tabBooklets) {
    const key = chemTab
      ? (chemModuleNumber(b.booklet_name) ?? UNGROUPED)
      : (b.topic || UNGROUPED)
    if (!groupMap[key]) groupMap[key] = []
    groupMap[key].push(b)
  }
  // Chemistry: modules in sequence, lessons in order within them (M3L10 after
  // M3L9, which a plain name sort would get wrong). Everything else: A–Z.
  const groupKeys = Object.keys(groupMap).sort((a, b) => {
    if (a === UNGROUPED) return 1
    if (b === UNGROUPED) return -1
    return chemTab ? Number(a) - Number(b) : a.localeCompare(b)
  })
  if (chemTab) {
    for (const k of groupKeys) {
      groupMap[k].sort((x, y) =>
        (chemLessonNumber(x.booklet_name) ?? Infinity) - (chemLessonNumber(y.booklet_name) ?? Infinity)
        || String(x.booklet_name || '').localeCompare(String(y.booklet_name || '')))
    }
  }
  const groupLabel = (key) => {
    if (key === UNGROUPED) return chemTab ? 'No module in the name' : 'No topic assigned'
    return chemTab ? chemModuleLabel(Number(key), moduleNames) : key
  }

  /*
   * Topic filter. Its options are the groups actually present in this tab, so it
   * can never offer a topic with nothing under it. The selection is DERIVED
   * against those keys rather than reset in an effect: change year/subject, or
   * narrow the search until the chosen topic has no matches, and it falls back
   * to showing everything instead of rendering an empty page with a stale
   * heading. On a Chemistry tab the same control filters by module.
   */
  const activeGroup = groupKeys.includes(groupFilter) ? groupFilter : ''
  const visibleKeys = activeGroup ? [activeGroup] : groupKeys

  const accentColor = getAccentColor(activeSub)
  const accentBg    = getAccentBg(activeSub)

  // Builder workbooks: drafts (not yet saved to the database) shown in a strip;
  // published ones are matched to their master row so we can offer "Open in builder".
  // Hub scope: the in-progress panel only shows drafts from the scoped family.
  // Workbooks only. A pre-test / level test is a build too, but it belongs to
  // its own page — listing one here put it in the workbook database by another
  // door, where it reads as a workbook someone forgot to finish.
  const draftBuilds = builds.filter(wb => wb.status !== 'published'
    && (wb.doc_type ?? 'booklet') === 'booklet'
    && (!scope || SUBJECT_FAMILIES[scope].includes(wb.subject)))
  const buildByBookletId = {}
  for (const wb of builds) if (wb.booklet_id) buildByBookletId[wb.booklet_id] = wb

  if (!scope || !staff) return null

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      {/* Header */}
      <div className="bg-white border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 pt-6 flex items-start justify-between gap-4">
          <div>
            <Link href={scope ? `/tutor/resources/${scope.toLowerCase()}` : '/tutor/booklets'}
              className="text-xs font-semibold text-[#325099]/50 hover:text-[#325099] transition block mb-1">
              {scope ? '← Back to hub' : '← Curriculum'}
            </Link>
            <h1 className="text-2xl font-bold text-[#062E63]">Master Database{scope ? ` — ${SCOPE_LABEL[scope]}` : ''}</h1>
            <p className="text-sm text-[#2A2035]/50 mt-0.5">
              {(scope ? booklets.filter(b => SUBJECT_FAMILIES[scope].includes(b.subject)) : booklets).length} booklet{booklets.length !== 1 ? 's' : ''}{scope ? '' : ' total'}
            </p>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="border border-[#DEE7FF] rounded-lg px-3 py-1.5 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] w-44"
            />
            <select
              value={activeGroup}
              onChange={e => setGroupFilter(e.target.value)}
              title={chemTab ? 'Show one module' : 'Show one topic'}
              className={`border rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099] max-w-[220px] ${
                activeGroup ? 'border-[#325099] text-[#062E63] font-semibold' : 'border-[#DEE7FF] text-[#2A2035]'}`}
            >
              <option value="">{chemTab ? 'All modules' : 'All topics'} ({tabBooklets.length})</option>
              {groupKeys.map(key => (
                <option key={key} value={key}>{groupLabel(key)} ({groupMap[key].length})</option>
              ))}
            </select>
            {/* Chemistry groups by module, read off the booklet name — there is
                no topic bank to keep. */}
            {!isChemistry(activeSub) && (
              <button
                onClick={() => setShowTopics(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] transition whitespace-nowrap text-[#325099]"
              >
                🏷 Topics
              </button>
            )}
            <button
              onClick={() => createWorkbook(asksDelivery ? 'ask' : 'physical')}
              disabled={creatingWb}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-[#325099] text-[#325099] bg-white hover:bg-[#F0F4FF] transition whitespace-nowrap disabled:opacity-40"
            >
              📓 {creatingWb ? 'Creating…' : 'Create workbook'}
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#325099] text-white text-xs font-semibold rounded-xl hover:bg-[#062E63] transition whitespace-nowrap"
            >
              <span className="text-sm leading-none">+</span> Add Booklet
            </button>
          </div>
        </div>

        {/* Year tabs */}
        <div className="max-w-7xl mx-auto px-6 md:px-10 flex gap-1 overflow-x-auto mt-4">
          {visibleYears.map(y => (
            <button key={y} onClick={() => setActiveYear(y)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeYear === y ? 'border-[#325099] text-[#325099]' : 'border-transparent text-[#2A2035]/50 hover:text-[#325099]'
              }`}>
              Year {y}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-10 py-6">
        {/* Subject tabs */}
        <div className="flex gap-2 mb-7 flex-wrap">
          {subjectsFor(activeYear).map(s => (
            <button key={s} onClick={() => setActiveSub(s)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold border transition ${
                activeSub === s ? 'text-white border-transparent' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
              }`}
              style={activeSub === s ? { background: accentColor } : {}}>
              {s}
            </button>
          ))}
        </div>

        {/* Workbooks in progress (builder drafts not yet saved to the database) */}
        {draftBuilds.length > 0 && (
          <div className="mb-7 bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden shadow-sm">
            <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-5 py-2.5 flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-[#325099]">📝 Workbooks in progress · {draftBuilds.length}</span>
              <span className="text-[11px] text-[#2A2035]/40">Save to curriculum from the builder to add them to the database below</span>
            </div>
            <div className="divide-y divide-[#F0F4FF]">
              {draftBuilds.map(wb => (
                <div key={wb.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <button onClick={() => router.push(`/tutor/booklets/builder/${wb.id}`)} className="text-left min-w-0 truncate">
                    <span className="font-semibold text-sm text-[#062E63]">{wb.title || 'Untitled workbook'}</span>
                    <span className="text-xs text-[#2A2035]/50 ml-2">{[wb.subject, wb.year ? `Year ${wb.year}` : null, wb.topic].filter(Boolean).join(' · ') || 'No details yet'}</span>
                  </button>
                  <div className="flex items-center gap-3 shrink-0 text-[11px]">
                    <button onClick={() => router.push(`/tutor/booklets/builder/${wb.id}`)} className="font-semibold text-[#325099] hover:underline">Open →</button>
                    <button onClick={() => duplicateWorkbook(wb.id)} disabled={duplicating === wb.id} className="text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-40" title="Copy this workbook into a new draft (e.g. for another year)">{duplicating === wb.id ? 'Duplicating…' : 'Duplicate'}</button>
                    <button onClick={() => deleteWorkbook(wb)} className="text-[#2A2035]/40 hover:text-rose-500">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm font-semibold tracking-[0.2em] uppercase animate-pulse" style={{ color: accentColor }}>Loading…</p>
          </div>
        ) : visibleKeys.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-sm font-semibold text-[#2A2035]">No booklets for Year {activeYear} {activeSub}</p>
            <Link href="/tutor/booklets" className="text-xs text-[#325099] hover:underline mt-1 block">Add some from the library →</Link>
          </div>
        ) : (
          <div className="space-y-8 pb-12">
            {visibleKeys.map(key => {
              const bks       = groupMap[key]
              const isNoGroup = key === UNGROUPED
              return (
                <div key={key}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-bold px-3 py-1 rounded-full"
                      style={{ background: isNoGroup ? '#F4F4F4' : accentBg, color: isNoGroup ? '#9CA3AF' : accentColor }}>
                      {groupLabel(key)}
                    </span>
                    <span className="text-[10px] text-[#2A2035]/30 font-medium">{bks.length} booklet{bks.length !== 1 ? 's' : ''}</span>
                    <div className="flex-1 h-px bg-[#E8EDF8]" />
                  </div>

                  {/* Two per row: with only a name, Info, status and the
                      builder button left, one booklet per full-width row wasted
                      most of the line. Drops to one column on narrow screens. */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                    {bks.map(b => (
                      <div key={b.id}
                        className="bg-white rounded-xl border border-[#E8EDF8] shadow-sm px-4 py-3 flex items-center gap-3 hover:border-[#C7D7FF] hover:shadow-md transition">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-[#2A2035] truncate">
                            {bookletLabel(b)}
                            {b.delivery === 'online' && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-[#CBEBDF] bg-[#ECF9F4] text-[#0E7A5F] align-middle" title="Online workbook — a typeable student doc, no printed PDFs">🌐 Online</span>}
                          </p>
                          {/* Info — term, week, topic, content, notes and the
                              improvement checklists all live in this modal. */}
                          <button
                            onClick={() => setInfoFor(b)}
                            title={openTotal(b) ? `${openTotal(b)} open item${openTotal(b) === 1 ? '' : 's'} on the improvement checklist` : 'All info for this booklet'}
                            className={`mt-0.5 text-[10px] font-semibold transition ${openTotal(b) ? 'text-[#B45309] hover:text-[#92400E] hover:underline' : 'text-[#325099]/70 hover:text-[#325099] hover:underline'}`}
                          >
                            {`\u2139\uFE0F Info${openTotal(b) ? ` \u00B7 ${openTotal(b)}` : ''}`}
                          </button>
                        </div>

                        <select
                          value={b.status || 'Not Started'}
                          onChange={e => saveStatus(b.id, e.target.value)}
                          className={`shrink-0 text-[10px] font-semibold rounded-full px-2 py-1 border cursor-pointer focus:outline-none transition ${STATUS_CLS[b.status || 'Not Started']}`}
                          title="Workbook status"
                        >
                          {WORKBOOK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>

                        {/* Builder — every workbook opens in the builder; a linked
                            draft is created on first open. */}
                        <div className="shrink-0">
                          {buildByBookletId[b.id] ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => router.push(`/tutor/booklets/builder/${buildByBookletId[b.id].id}`)}
                                className="text-[10px] font-bold px-2.5 py-1 rounded-lg transition hover:opacity-80 whitespace-nowrap"
                                style={{ background: accentBg, color: accentColor }}
                                title="Open this workbook in the builder"
                              >
                                Open builder ↗
                              </button>
                              <button
                                onClick={() => duplicateWorkbook(buildByBookletId[b.id].id)}
                                disabled={duplicating === buildByBookletId[b.id].id}
                                className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-[#DEE7FF] text-[#325099]/70 hover:text-[#325099] hover:border-[#325099] transition disabled:opacity-40 whitespace-nowrap"
                                title="Duplicate this workbook into a new draft (e.g. for another year)"
                              >
                                {duplicating === buildByBookletId[b.id].id ? '…' : 'Duplicate'}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => openInBuilder(b)}
                              disabled={openingBuilder === b.id}
                              className="text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-dashed border-[#BACBFF] text-[#325099]/70 hover:text-[#325099] hover:border-[#325099] transition disabled:opacity-40 whitespace-nowrap"
                              title="Create this workbook in the builder and open it"
                            >
                              {openingBuilder === b.id ? 'Opening…' : '＋ Open in builder'}
                            </button>
                          )}
                        </div>

                        <div className="shrink-0 flex items-center gap-2.5 pl-1 border-l border-[#F0F4FF]">
                          <button
                            onClick={() => { setDeleteBooklet(b); setDeleteConfirmText('') }}
                            className="text-[10px] font-semibold text-red-400/70 hover:text-red-600 transition"
                            title="Delete booklet"
                          >Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showTopics && (
        <ManageTopicsPanel
          year={activeYear}
          subject={activeSub}
          accentColor={accentColor}
          accentBg={accentBg}
          onClose={() => setShowTopics(false)}
          onTopicsChanged={() => { loadTopicBank(); load() }}
        />
      )}

      {/* Senior English: choose how the new workbook is delivered. */}
      {deliveryChoice && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setDeliveryChoice(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-[#062E63]">New Year {activeYear} English workbook</h2>
              <button onClick={() => setDeliveryChoice(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] text-lg">×</button>
            </div>
            <p className="text-xs text-[#2A2035]/55 mb-4">Both are built with the same workbook builder — the choice is how students work on it. You can switch later from the builder.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <button onClick={() => createWorkbook('physical')}
                className="text-left rounded-xl border border-[#DEE7FF] hover:border-[#325099] hover:bg-[#F8FAFF] transition p-4">
                <div className="text-2xl mb-1.5">🖨</div>
                <p className="text-sm font-bold text-[#062E63]">Physical</p>
                <p className="text-[11px] text-[#2A2035]/55 mt-1">Printed as PDFs and handed out — the normal workbook flow.</p>
              </button>
              <button onClick={() => createWorkbook('online')}
                className="text-left rounded-xl border border-[#DEE7FF] hover:border-[#0E7A5F] hover:bg-[#ECF9F4] transition p-4">
                <div className="text-2xl mb-1.5">🌐</div>
                <p className="text-sm font-bold text-[#0E7A5F]">Online</p>
                <p className="text-[11px] text-[#2A2035]/55 mt-1">A typeable student doc — students write into it on their laptops and the teacher reviews on screen. No printing.</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add only — editing an existing booklet happens in the Info modal. */}
      {showAdd && (
        <BookletFormModal
          booklet={null}
          defaultYear={activeYear}
          defaultSubject={activeSub}
          topicBank={topicBank}
          moduleNames={moduleNames}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}

      {/* Chemistry content is generated from the sections' drawn syllabus
          dotpoints — that lives on the linked BUILD (booklets rows have no
          blocks) — so pass it in as the Content override. */}
      <BookletInfoModal
        booklet={infoFor}
        title={infoFor ? bookletLabel(infoFor) : ''}
        staff={staff}
        content={infoFor && infoFor.subject === 'Chemistry'
          ? (buildByBookletId[infoFor.id]?.content || infoFor.content)
          : undefined}
        topicBank={topicBank}
        onClose={() => { setInfoFor(null); load() }}
        onChanged={(p) => setBooklets(bs => bs.map(x => (x.id === infoFor.id ? { ...x, ...p } : x)))}
      />

      {deleteBooklet && (() => {
        const confirmTarget = (deleteBooklet.booklet_name || '').trim()
        const ready = deleteConfirmText.trim() === confirmTarget && confirmTarget.length > 0
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget && !deleting) { setDeleteBooklet(null); setDeleteConfirmText('') } }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
              <div className="px-6 py-4 border-b border-[#F0F4FF]">
                <h2 className="text-sm font-bold text-red-600">Delete booklet</h2>
              </div>
              <div className="px-6 py-5 space-y-3">
                <p className="text-sm text-[#2A2035]">
                  This permanently deletes <span className="font-bold text-[#062E63]">{bookletLabel(deleteBooklet)}</span>, its PDF files, and any curriculum assignments. This cannot be undone.
                </p>
                <p className="text-xs text-[#2A2035]/60">
                  To confirm, type the booklet name <span className="font-semibold text-[#062E63]">{confirmTarget}</span> below:
                </p>
                <input
                  autoFocus
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  placeholder={confirmTarget}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] focus:outline-none focus:border-red-400 bg-white"
                />
              </div>
              <div className="px-6 py-4 border-t border-[#F0F4FF] flex justify-end gap-2">
                <button onClick={() => { setDeleteBooklet(null); setDeleteConfirmText('') }} disabled={deleting}
                  className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition disabled:opacity-40">Cancel</button>
                <button onClick={handleDeleteBooklet} disabled={!ready || deleting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
                  {deleting ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

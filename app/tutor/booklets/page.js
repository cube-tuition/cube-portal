'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'

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

// ── Class Assign Modal ────────────────────────────────────────────────────────
function ClassAssignModal({ classId, className, year, subject, term, week, accentColor, accentBg, onClose, onAssigned }) {
  const [booklets, setBooklets] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [query,    setQuery]    = useState('')
  const [saving,   setSaving]   = useState(null)

  useEffect(() => {
    supabase
      .from('booklets')
      .select('id, booklet_name, topic, file_paths, file_path, pdf_filenames')
      .eq('year', year).eq('subject', subject)
      .order('topic', { nullsFirst: false }).order('booklet_name')
      .then(({ data }) => { setBooklets(data || []); setLoading(false) })
  }, [year, subject])

  const filtered = booklets.filter(b => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return b.booklet_name?.toLowerCase().includes(q) || b.topic?.toLowerCase().includes(q)
  })

  const handleAssign = async (b) => {
    setSaving(b.id)
    await supabase.from('class_booklet_assignments')
      .upsert({ class_id: classId, booklet_id: b.id, term_number: term, week }, { onConflict: 'class_id,term_number,week' })
    onAssigned()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <h2 className="text-sm font-bold text-[#062E63]">Assign Booklet</h2>
            <p className="text-[10px] text-[#2A2035]/40 mt-0.5">{className} · Term {term}, Week {week}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
        </div>
        <div className="px-4 pt-3 pb-2">
          <input autoFocus type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search booklets…"
            className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-[#F8FAFF]" />
        </div>
        <div className="overflow-y-auto flex-1 px-4 pb-4">
          {loading ? (
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

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('class_booklet_assignments')
      .select('id, term_number, week, booklets(booklet_name, topic, file_paths, file_path, pdf_filenames)')
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
                    <div key={week} className="bg-white rounded-xl border border-[#E8EDF8] shadow-sm overflow-hidden hover:shadow-md hover:border-[#C7D7FF] transition-all">
                      <div className="h-[3px] w-full" style={{ background: accentColor }} />
                      <div className="px-3 pt-2 pb-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-widest block mb-0.5" style={{ color: accentColor }}>Wk {week}</span>
                        <p className="text-[11px] font-bold text-[#062E63] leading-snug">{bookletLabel(b)}</p>
                        {b.topic && <p className="text-[9px] mt-0.5 font-medium truncate" style={{ color: accentColor }}>{b.topic}</p>}
                      </div>
                      <div className="px-3 pb-2 flex items-center justify-between gap-1">
                        <button onClick={() => handleUnassign(a.id)}
                          className="text-[9px] font-semibold text-[#2A2035]/25 hover:text-amber-500 transition">Unassign</button>
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
                      </div>
                    </div>
                  )
                }
                return (
                  <button key={week} onClick={() => setAssignSlot({ term, week })}
                    className="group w-full border-2 border-dashed border-[#FDE68A] rounded-xl overflow-hidden hover:border-[#F59E0B] hover:bg-[#FFFBEB] transition text-left">
                    <div className="h-[3px] w-full" style={{ background: '#FDE68A' }} />
                    <div className="px-3 pt-2 pb-2.5">
                      <span className="text-[9px] font-bold uppercase tracking-widest block mb-0.5" style={{ color: '#D97706' }}>Wk {week}</span>
                      <p className="text-[11px] font-semibold text-[#2A2035]/20 group-hover:text-[#325099]/40 transition">+ assign booklet</p>
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
  })
  const [newFiles, setNewFiles]           = useState([])
  const [existingPaths, setExistingPaths] = useState(
    booklet?.file_paths?.length ? booklet.file_paths : (booklet?.file_path ? [booklet.file_path] : [])
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')
  const fileRef             = useRef()

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
      file_path:    finalPaths[0] ?? null,
      file_paths:   finalPaths,
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
function AssignBookletModal({ year, subject, term, week, onClose, onAssigned }) {
  const [allBooklets, setAllBooklets] = useState([])
  const [loading, setLoading]         = useState(true)
  const [query, setQuery]             = useState('')
  const [assigning, setAssigning]     = useState(null)

  useEffect(() => {
    supabase
      .from('booklets')
      .select('id, booklet_name, topic, term_number, week, pdf_filenames, file_paths, file_path')
      .eq('year', year)
      .eq('subject', subject)
      .order('topic', { nullsFirst: false })
      .order('booklet_name')
      .then(({ data }) => { setAllBooklets(data || []); setLoading(false) })
  }, [year, subject])

  const filtered = allBooklets.filter(b => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return b.booklet_name?.toLowerCase().includes(q) || b.topic?.toLowerCase().includes(q)
  })

  const handleAssign = async (booklet) => {
    setAssigning(booklet.id)
    await supabase.from('booklets').update({ term_number: term, week }).eq('id', booklet.id)
    onAssigned()
  }

  const accentColor = getAccentColor(subject)
  const accentBg    = getAccentBg(subject)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <div>
            <h2 className="text-sm font-bold text-[#062E63]">Assign Booklet</h2>
            <p className="text-[10px] text-[#2A2035]/40 mt-0.5">Year {year} {subject} · Term {term}, Week {week}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
        </div>

        <div className="px-4 pt-3 pb-2">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search booklets…"
            className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-[#F8FAFF]"
          />
        </div>

        <div className="overflow-y-auto flex-1 px-4 pb-4">
          {loading ? (
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
                    disabled={assigning === b.id}
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
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BookletsPage() {
  const router = useRouter()
  const [staff, setStaff]           = useState(null)
  const [booklets, setBooklets]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [activeYear, setActiveYear] = useState(8)
  const [activeSub, setActiveSub]   = useState('Maths')
  const [showAdd, setShowAdd]       = useState(false)
  const [addPrefill, setAddPrefill] = useState({})
  const [editing, setEditing]       = useState(null)
  const [deleteId, setDeleteId]     = useState(null)
  const [deleteFilePaths, setDeleteFilePaths] = useState([])
  const [assignSlot, setAssignSlot] = useState(null) // { term, week }
  const [classes,      setClasses]      = useState([])
  const [activeClass,  setActiveClass]  = useState(null) // class id

  // Auth
  useEffect(() => {
    getAuthProfile().then(({ user, profile }) => {
      if (!user) { router.push('/'); return }
      if (!profile || profile.role !== 'admin') { router.push('/tutor'); return }
      setStaff(profile)
    })
  }, [router])

  // Load booklets
  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('booklets')
      .select('id, booklet_name, year, subject, topic, term_number, week, notes, file_path, file_paths')
      .order('year').order('subject').order('term_number', { nullsFirst: false }).order('week', { nullsFirst: false })
    setBooklets(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { if (staff) load() }, [staff, load])

  const loadClasses = useCallback(async () => {
    const { data } = await supabase
      .from('classes')
      .select('id, class_name, day_of_week, start_time, teacher, courses(course_code)')
    if (!data) return
    const filtered = data.filter(c => {
      const code   = c.courses?.course_code || ''
      const parts  = code.split('.')
      const yr     = parseInt(parts[0])
      const suffix = parts[1] || ''
      const subj = yr >= 11
        ? (suffix.startsWith('M1') ? 'Standard Maths'
          : suffix.startsWith('M2') ? 'Adv Maths'
          : suffix.startsWith('M3') ? 'Ext 1 Maths'
          : suffix.startsWith('M4') ? 'Ext 2 Maths'
          : suffix.startsWith('E') ? 'English'
          : suffix.startsWith('C') ? 'Chemistry'
          : null)
        : (suffix.startsWith('M') ? 'Maths' : suffix.startsWith('E') ? 'English' : null)
      return yr === activeYear && subj === activeSub
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

  // Reset activeSub when year changes if subject isn't valid for new year
  useEffect(() => {
    const subjects = getSubjects(activeYear)
    if (!subjects.includes(activeSub)) setActiveSub(subjects[0])
  }, [activeYear])

  // Delete
  const handleDelete = async () => {
    if (deleteFilePaths.length) await supabase.storage.from('booklets').remove(deleteFilePaths)
    await supabase.from('booklets').delete().eq('id', deleteId)
    setBooklets(b => b.filter(x => x.id !== deleteId))
    setDeleteId(null); setDeleteFilePaths([])
  }

  // Get public URL for a stored PDF
  const getPdfUrl = (path) => {
    if (!path) return null
    const { data } = supabase.storage.from('booklets').getPublicUrl(path)
    return data?.publicUrl ?? null
  }

  // Filtered view
  const visible = booklets.filter(b => b.year === activeYear && b.subject === activeSub)

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

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      {/* Header */}
      <div className="bg-white border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Curriculum</h1>
            <p className="text-sm text-[#2A2035]/50 mt-0.5">{booklets.length} booklet{booklets.length !== 1 ? 's' : ''} across all years and subjects</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/tutor/booklets/master"
              className="px-4 py-2 text-sm font-semibold text-[#325099] border border-[#DEE7FF] rounded-xl hover:bg-[#F0F4FF] transition">
              📚 Booklet Database
            </Link>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#325099] text-white text-sm font-semibold rounded-xl hover:bg-[#062E63] transition"
            >
              <span className="text-base leading-none">+</span> Add Booklet
            </button>
          </div>
        </div>

        {/* Year tabs */}
        <div className="max-w-7xl mx-auto px-6 md:px-10 flex gap-1 overflow-x-auto pb-0">
          {YEARS.map(y => (
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
        {/* Subject tabs */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {getSubjects(activeYear).map(s => (
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
                            <div key={week} className="bg-white rounded-xl border border-[#E8EDF8] shadow-sm flex flex-col overflow-hidden hover:shadow-md hover:border-[#C7D7FF] transition-all">
                              <div className="h-[3px] w-full" style={{ background: accentColor }} />
                              <div className="px-3 pt-2.5 pb-2 flex flex-col gap-0.5">
                                <span
                                  className="text-[9px] font-bold uppercase tracking-widest"
                                  style={{ color: accentColor }}
                                >
                                  Week {week}
                                </span>
                                <p className="text-[12px] font-bold text-[#062E63] leading-snug">{bookletLabel(b)}</p>
                                {b.notes && (
                                  <p className="text-[10px] text-[#2A2035]/45 line-clamp-1">{b.notes}</p>
                                )}
                              </div>
                              <div className="px-3 pb-2.5 flex items-center justify-between gap-2">
                                <div className="flex gap-2.5">
                                  <button onClick={() => setEditing(b)}
                                    className="text-[10px] font-semibold text-[#325099] hover:underline">Edit</button>
                                  <button onClick={async () => {
                                    await supabase.from('booklets').update({ term_number: null, week: null }).eq('id', b.id)
                                    load()
                                  }} className="text-[10px] font-semibold text-[#2A2035]/30 hover:text-[#D97706] hover:underline transition">Unassign</button>
                                  <button onClick={() => { setDeleteId(b.id); setDeleteFilePaths(pdfPaths) }}
                                    className="text-[10px] font-semibold text-red-400 hover:underline">Delete</button>
                                </div>
                                {pdfPaths.length > 0 ? (
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
                            className="group w-full border-2 border-dashed border-[#FDE68A] rounded-xl flex flex-col overflow-hidden hover:border-[#F59E0B] hover:bg-[#FFFBEB] transition text-left"
                          >
                            <div className="h-[3px] w-full" style={{ background: '#FDE68A' }} />
                            <div className="px-3 pt-2.5 pb-2 flex flex-col gap-0.5 flex-1">
                              <span
                                className="text-[9px] font-bold uppercase tracking-widest"
                                style={{ color: '#D97706' }}
                              >
                                Wk {week}
                              </span>
                              <p className="text-[12px] font-semibold text-[#2A2035]/20 group-hover:text-[#325099]/40 transition leading-snug">
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
        />
      )}

      {/* Modals */}
      {(showAdd || editing) && (
        <BookletModal
          booklet={editing}
          defaultYear={activeYear}
          defaultSubject={activeSub}
          defaultTerm={addPrefill.term_number}
          defaultWeek={addPrefill.week}
          onClose={() => { setShowAdd(false); setEditing(null); setAddPrefill({}) }}
          onSaved={() => { setShowAdd(false); setEditing(null); setAddPrefill({}); load() }}
        />
      )}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-80 border border-[#DEE7FF]">
            <div className="px-6 py-5">
              <p className="text-sm font-bold text-[#062E63] mb-2">Delete this booklet?</p>
              <p className="text-xs text-[#2A2035]/60 leading-relaxed">
                {deleteFilePaths.length
                  ? `The booklet record and its ${deleteFilePaths.length} uploaded PDF${deleteFilePaths.length > 1 ? 's' : ''} will both be permanently deleted.`
                  : 'The booklet record will be permanently deleted.'}
              </p>
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button onClick={() => { setDeleteId(null); setDeleteFilePaths([]) }}
                className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
              <button onClick={handleDelete}
                className="px-4 py-2 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 transition">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

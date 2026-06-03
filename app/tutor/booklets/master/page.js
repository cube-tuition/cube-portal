'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'

const YEARS    = [5, 6, 7, 8, 9, 10, 11, 12]
const SUBJECTS = ['Maths', 'English']

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

// ── Inline file upload cell ───────────────────────────────────────────────────
function FileCell({ booklet, type, accentColor, accentBg, onUpdated }) {
  const isPdf  = type === 'pdf'
  const paths  = isPdf
    ? (booklet.file_paths?.length ? booklet.file_paths : (booklet.file_path ? [booklet.file_path] : []))
    : (booklet.word_paths || [])
  const names  = isPdf ? (booklet.pdf_filenames || []) : (booklet.word_filenames || [])
  const bucket = 'booklets'

  const fileRef   = useRef()
  const [uploading, setUploading]   = useState(false)
  const [deletingIdx, setDeletingIdx] = useState(null)

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    const newPaths = [...paths]
    const newNames = [...names]
    for (const file of files) {
      const ext      = file.name.split('.').pop()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path     = `y${booklet.year}/${booklet.subject?.toLowerCase()}/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`
      const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true })
      if (!error) {
        newPaths.push(path)
        newNames.push(file.name.replace(/\.[^.]+$/, ''))
      }
    }
    const update = isPdf
      ? { file_path: newPaths[0] ?? null, file_paths: newPaths, pdf_filenames: newNames }
      : { word_paths: newPaths, word_filenames: newNames }
    await supabase.from('booklets').update(update).eq('id', booklet.id)
    onUpdated({ ...booklet, ...update })
    setUploading(false)
    e.target.value = ''
  }

  const handleDelete = async (idx) => {
    if (deletingIdx !== idx) { setDeletingIdx(idx); setTimeout(() => setDeletingIdx(null), 3000); return }
    await supabase.storage.from(bucket).remove([paths[idx]])
    const newPaths = paths.filter((_, i) => i !== idx)
    const newNames = names.filter((_, i) => i !== idx)
    const update = isPdf
      ? { file_path: newPaths[0] ?? null, file_paths: newPaths, pdf_filenames: newNames }
      : { word_paths: newPaths, word_filenames: newNames }
    await supabase.from('booklets').update(update).eq('id', booklet.id)
    onUpdated({ ...booklet, ...update })
    setDeletingIdx(null)
  }

  const getUrl = (path) => {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return data?.publicUrl ?? null
  }

  const accept = isPdf ? 'application/pdf' : '.docx,.doc,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const label  = isPdf ? 'PDF' : 'DOC'
  const color  = isPdf ? accentColor : '#0F766E'
  const bg     = isPdf ? accentBg    : '#F0FDF4'

  return (
    <div className="flex flex-wrap items-center gap-1">
      {paths.map((path, i) => {
        const url      = getUrl(path)
        const filename = names[i] || (isPdf ? `PDF ${i + 1}` : `Doc ${i + 1}`)
        return (
          <div key={path} className="flex items-center gap-0.5 group/file">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-bold px-2 py-0.5 rounded-l-lg hover:opacity-80 transition max-w-[100px] truncate"
                style={{ background: bg, color }}
                title={filename}
              >
                {filename}
              </a>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-l-lg max-w-[100px] truncate"
                style={{ background: bg, color }} title={filename}>{filename}</span>
            )}
            <button
              onClick={() => handleDelete(i)}
              className="text-[10px] px-1 py-0.5 rounded-r-lg opacity-0 group-hover/file:opacity-100 transition font-bold"
              style={{ background: bg, color: deletingIdx === i ? '#EF4444' : color }}
              title={deletingIdx === i ? 'Click again to confirm delete' : 'Remove'}
            >
              {deletingIdx === i ? '✕' : '×'}
            </button>
          </div>
        )
      })}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-dashed transition disabled:opacity-50 hover:opacity-80"
        style={{ borderColor: color, color, background: 'transparent' }}
        title={`Upload ${label}`}
      >
        {uploading ? '…' : `+ ${label}`}
      </button>
      <input ref={fileRef} type="file" accept={accept} multiple className="hidden" onChange={handleUpload} />
    </div>
  )
}

const TERMS = [1, 2, 3, 4]
const INP   = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

// ── Booklet Form Modal (add + edit) ──────────────────────────────────────────
function BookletFormModal({ booklet, defaultYear, defaultSubject, topicBank = [], onClose, onSaved }) {
  const isEdit = !!booklet
  const [form, setForm] = useState({
    booklet_name: booklet?.booklet_name ?? '',
    year:         booklet?.year         ?? defaultYear,
    subject:      booklet?.subject      ?? defaultSubject,
    topic:        booklet?.topic        ?? '',
    term_number:  booklet?.term_number  ?? '',
    week:         booklet?.week         ?? '',
    notes:        booklet?.notes        ?? '',
  })

  // Existing files (edit mode)
  const [existingPdfPaths,  setExistingPdfPaths]  = useState(
    booklet ? (booklet.file_paths?.length ? booklet.file_paths : (booklet.file_path ? [booklet.file_path] : [])) : []
  )
  const [existingPdfNames,  setExistingPdfNames]  = useState(booklet?.pdf_filenames  || [])
  const [existingWordPaths, setExistingWordPaths] = useState(booklet?.word_paths     || [])
  const [existingWordNames, setExistingWordNames] = useState(booklet?.word_filenames || [])

  // New files staged for upload
  const [newPdfFiles,  setNewPdfFiles]  = useState([])
  const [newWordFiles, setNewWordFiles] = useState([])

  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const pdfRef  = useRef()
  const wordRef = useRef()

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
        const origWord = booklet.word_paths || []
        const removedPdf  = origPdf.filter(p => !existingPdfPaths.includes(p))
        const removedWord = origWord.filter(p => !existingWordPaths.includes(p))
        if (removedPdf.length)  await supabase.storage.from('booklets').remove(removedPdf)
        if (removedWord.length) await supabase.storage.from('booklets').remove(removedWord)
      }

      const { paths: newPdfPaths,  names: newPdfNames  } = await uploadFiles(newPdfFiles,  folder)
      const { paths: newWordPaths, names: newWordNames } = await uploadFiles(newWordFiles, folder)

      const finalPdfPaths  = [...existingPdfPaths,  ...newPdfPaths]
      const finalPdfNames  = [...existingPdfNames,  ...newPdfNames]
      const finalWordPaths = [...existingWordPaths, ...newWordPaths]
      const finalWordNames = [...existingWordNames, ...newWordNames]

      const payload = {
        booklet_name:   form.booklet_name.trim(),
        year:           Number(form.year),
        subject:        form.subject,
        topic:          form.topic.trim() || null,
        term_number:    form.term_number !== '' ? Number(form.term_number) : null,
        week:           form.week        !== '' ? Number(form.week)        : null,
        notes:          form.notes.trim() || null,
        file_path:      finalPdfPaths[0]  ?? null,
        file_paths:     finalPdfPaths,
        pdf_filenames:  finalPdfNames,
        word_paths:     finalWordPaths,
        word_filenames: finalWordNames,
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
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Topic */}
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

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Notes <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Any notes…" className={INP + ' resize-none'} />
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

          {/* Word docs */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">Word Documents <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
            {existingWordPaths.map((path, i) => (
              <div key={path} className="flex items-center justify-between px-3 py-2 mb-1.5 bg-[#F0FDF4] rounded-lg">
                <span className="text-xs font-semibold text-[#0F766E] truncate">📝 {existingWordNames[i] || `Doc ${i + 1}`}</span>
                <button onClick={() => { setExistingWordPaths(p => p.filter((_, j) => j !== i)); setExistingWordNames(p => p.filter((_, j) => j !== i)) }}
                  className="text-[10px] text-red-400 hover:text-red-600 font-semibold ml-2 shrink-0">Remove</button>
              </div>
            ))}
            {newWordFiles.map((f, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 mb-1.5 bg-[#ECFDF5] rounded-lg">
                <span className="text-xs font-semibold text-[#0F766E] truncate">📝 {f.name}</span>
                <button onClick={() => setNewWordFiles(p => p.filter((_, j) => j !== i))}
                  className="text-[10px] text-red-400 hover:text-red-600 font-semibold ml-2 shrink-0">Remove</button>
              </div>
            ))}
            <div onClick={() => wordRef.current?.click()}
              className="border-2 border-dashed border-[#D1FAE5] rounded-xl px-4 py-3 text-center cursor-pointer hover:border-[#0F766E] hover:bg-[#F0FDF4] transition">
              <p className="text-xs text-[#2A2035]/40">{(existingWordPaths.length + newWordFiles.length) > 0 ? '+ Add another Word doc' : 'Click to attach Word document(s)'}</p>
            </div>
            <input ref={wordRef} type="file" accept=".docx,.doc,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple className="hidden"
              onChange={e => { setNewWordFiles(p => [...p, ...Array.from(e.target.files || [])]); e.target.value = '' }} />
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
  const router = useRouter()
  const [staff,    setStaff]    = useState(null)
  const [booklets, setBooklets] = useState([])
  const [loading,  setLoading]  = useState(true)

  const [activeYear, setActiveYear] = useState(5)
  const [activeSub,  setActiveSub]  = useState('Maths')
  const [search,     setSearch]     = useState('')
  const [showAdd,    setShowAdd]    = useState(false)

  const [editingTopic,   setEditingTopic]   = useState(null)
  const [topicDraft,     setTopicDraft]     = useState('')
  const [editingBooklet, setEditingBooklet] = useState(null)
  const [showTopics,     setShowTopics]     = useState(false)
  const [topicBank,      setTopicBank]      = useState([]) // topics for active year+subject

  useEffect(() => {
    getAuthProfile().then(({ user, profile }) => {
      if (!user) { router.push('/'); return }
      if (!profile || profile.role !== 'admin') { router.push('/tutor'); return }
      setStaff(profile)
    })
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('booklets')
      .select('id, booklet_name, year, subject, topic, term_number, week, notes, file_path, file_paths, pdf_filenames, word_paths, word_filenames')
      .order('topic', { nullsFirst: false })
      .order('booklet_name')
    setBooklets(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { if (staff) load() }, [staff, load])

  const loadTopicBank = useCallback(async () => {
    const { data } = await supabase
      .from('topics').select('id, name')
      .eq('year', activeYear).eq('subject', activeSub)
      .order('name')
    setTopicBank(data || [])
  }, [activeYear, activeSub])

  useEffect(() => { if (staff) loadTopicBank() }, [staff, loadTopicBank])

  const handleBookletUpdated = (updated) => {
    setBooklets(bs => bs.map(b => b.id === updated.id ? updated : b))
  }

  const saveTopic = async (id, topic) => {
    const val = topic.trim() || null
    await supabase.from('booklets').update({ topic: val }).eq('id', id)
    setBooklets(bs => bs.map(b => b.id === id ? { ...b, topic: val } : b))
    setEditingTopic(null)
  }

  const tabBooklets = booklets.filter(b => {
    if (b.year !== activeYear || b.subject !== activeSub) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return (
        b.booklet_name?.toLowerCase().includes(q) ||
        b.topic?.toLowerCase().includes(q) ||
        b.notes?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const topicMap = {}
  for (const b of tabBooklets) {
    const key = b.topic || '— No topic assigned'
    if (!topicMap[key]) topicMap[key] = []
    topicMap[key].push(b)
  }
  const topicKeys = Object.keys(topicMap).sort((a, b) => {
    if (a === '— No topic assigned') return 1
    if (b === '— No topic assigned') return -1
    return a.localeCompare(b)
  })

  const accentColor = activeSub === 'Maths' ? '#325099' : '#7C3AED'
  const accentBg    = activeSub === 'Maths' ? '#EEF4FF'  : '#F5F3FF'

  if (!staff) return null

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      {/* Header */}
      <div className="bg-white border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 pt-6 flex items-start justify-between gap-4">
          <div>
            <Link href="/tutor/booklets"
              className="text-xs font-semibold text-[#325099]/50 hover:text-[#325099] transition block mb-1">
              ← Booklet Library
            </Link>
            <h1 className="text-2xl font-bold text-[#062E63]">Master Database</h1>
            <p className="text-sm text-[#2A2035]/50 mt-0.5">
              {booklets.length} booklet{booklets.length !== 1 ? 's' : ''} total · click a topic to edit · hover a file to remove it
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
            <button
              onClick={() => setShowTopics(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] transition whitespace-nowrap text-[#325099]"
            >
              🏷 Topics
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
          {YEARS.map(y => (
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
        <div className="flex gap-2 mb-7">
          {SUBJECTS.map(s => (
            <button key={s} onClick={() => setActiveSub(s)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold border transition ${
                activeSub === s ? 'text-white border-transparent' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
              }`}
              style={activeSub === s ? { background: accentColor } : {}}>
              {s}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm font-semibold tracking-[0.2em] uppercase animate-pulse" style={{ color: accentColor }}>Loading…</p>
          </div>
        ) : topicKeys.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-sm font-semibold text-[#2A2035]">No booklets for Year {activeYear} {activeSub}</p>
            <Link href="/tutor/booklets" className="text-xs text-[#325099] hover:underline mt-1 block">Add some from the library →</Link>
          </div>
        ) : (
          <div className="space-y-8 pb-12">
            {topicKeys.map(topic => {
              const bks       = topicMap[topic]
              const isNoTopic = topic === '— No topic assigned'
              return (
                <div key={topic}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-bold px-3 py-1 rounded-full"
                      style={{ background: isNoTopic ? '#F4F4F4' : accentBg, color: isNoTopic ? '#9CA3AF' : accentColor }}>
                      {isNoTopic ? 'No topic assigned' : topic}
                    </span>
                    <span className="text-[10px] text-[#2A2035]/30 font-medium">{bks.length} booklet{bks.length !== 1 ? 's' : ''}</span>
                    <div className="flex-1 h-px bg-[#E8EDF8]" />
                  </div>

                  <div className="bg-white rounded-2xl border border-[#E8EDF8] overflow-hidden shadow-sm">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#F0F4FF] bg-[#F8FAFF]">
                          <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-[#325099]/60">Booklet Name</th>
                          <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 w-16">Term</th>
                          <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 w-14">Week</th>
                          <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 w-32">Topic</th>
                          <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-[#325099]/60">PDFs</th>
                          <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-[#0F766E]/60">Word Docs</th>
                          <th className="px-4 py-3 w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bks.map(b => (
                          <tr key={b.id} className="border-b border-[#F0F4FF] last:border-0 hover:bg-[#F8FAFF] transition-colors">
                            <td className="px-5 py-3 font-semibold text-[#2A2035]">
                              <div>{b.booklet_name}</div>
                              {b.notes && <div className="text-[10px] text-[#2A2035]/40 mt-0.5 font-normal">{b.notes}</div>}
                            </td>
                            <td className="px-4 py-3 text-[#2A2035]/50">{b.term_number ? `T${b.term_number}` : '—'}</td>
                            <td className="px-4 py-3 text-[#2A2035]/50">{b.week ?? '—'}</td>

                            {/* Inline topic edit */}
                            <td className="px-5 py-3">
                              {editingTopic === b.id ? (
                                <div className="flex items-center gap-1">
                                  <select
                                    autoFocus
                                    value={topicDraft}
                                    onChange={e => setTopicDraft(e.target.value)}
                                    className="w-full border border-[#325099] rounded px-2 py-1 text-xs focus:outline-none bg-white"
                                  >
                                    <option value="">— No topic —</option>
                                    {topicBank.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                                  </select>
                                  <button onClick={() => saveTopic(b.id, topicDraft)}
                                    className="text-[10px] font-bold text-[#059669] hover:text-[#065F46] shrink-0">✓</button>
                                  <button onClick={() => setEditingTopic(null)}
                                    className="text-[10px] font-bold text-[#2A2035]/30 hover:text-red-400 shrink-0">✕</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setEditingTopic(b.id); setTopicDraft(b.topic || '') }}
                                  className={`text-left hover:underline transition truncate max-w-[120px] block ${
                                    b.topic ? 'text-[#2A2035]/60' : 'text-[#2A2035]/20 italic'
                                  }`}
                                >
                                  {b.topic || 'set topic…'}
                                </button>
                              )}
                            </td>

                            {/* PDFs */}
                            <td className="px-5 py-3">
                              <FileCell
                                booklet={b}
                                type="pdf"
                                accentColor={accentColor}
                                accentBg={accentBg}
                                onUpdated={handleBookletUpdated}
                              />
                            </td>

                            {/* Word docs */}
                            <td className="px-5 py-3">
                              <FileCell
                                booklet={b}
                                type="word"
                                accentColor={accentColor}
                                accentBg={accentBg}
                                onUpdated={handleBookletUpdated}
                              />
                            </td>

                            {/* Edit */}
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setEditingBooklet(b)}
                                className="text-[10px] font-semibold text-[#325099]/50 hover:text-[#325099] transition"
                                title="Edit booklet"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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

      {showAdd && (
        <BookletFormModal
          booklet={null}
          defaultYear={activeYear}
          defaultSubject={activeSub}
          topicBank={topicBank}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}

      {editingBooklet && (
        <BookletFormModal
          booklet={editingBooklet}
          defaultYear={activeYear}
          defaultSubject={activeSub}
          topicBank={topicBank}
          onClose={() => setEditingBooklet(null)}
          onSaved={() => { setEditingBooklet(null); load() }}
        />
      )}
    </div>
  )
}

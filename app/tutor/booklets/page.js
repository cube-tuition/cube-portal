'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'

const YEARS    = [5, 6, 7, 8, 9, 10, 11, 12]
const SUBJECTS = ['Maths', 'English']
const TERMS    = [1, 2, 3, 4]
const INP      = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

// ── Booklet Modal (add + edit) ────────────────────────────────────────────────
function BookletModal({ booklet, defaultYear, defaultSubject, onClose, onSaved }) {
  const isEdit = !!booklet
  const [form, setForm] = useState({
    booklet_name: booklet?.booklet_name ?? '',
    year:         booklet?.year         ?? defaultYear,
    subject:      booklet?.subject      ?? defaultSubject,
    term_number:  booklet?.term_number  ?? '',
    week:         booklet?.week         ?? '',
    notes:        booklet?.notes        ?? '',
  })
  const [file, setFile]       = useState(null)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')
  const fileRef               = useRef()

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async () => {
    if (!form.booklet_name.trim()) { setErr('Booklet name is required.'); return }
    setSaving(true); setErr('')

    let file_path = booklet?.file_path ?? null

    // Upload new PDF if provided
    if (file) {
      const ext  = file.name.split('.').pop()
      const path = `y${form.year}/${form.subject.toLowerCase()}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('booklets').upload(path, file, { upsert: true })
      if (upErr) { setErr('Upload failed: ' + upErr.message); setSaving(false); return }
      // Remove old file if replacing
      if (booklet?.file_path) {
        await supabase.storage.from('booklets').remove([booklet.file_path])
      }
      file_path = path
    }

    const payload = {
      booklet_name: form.booklet_name.trim(),
      year:         Number(form.year),
      subject:      form.subject,
      term_number:  form.term_number !== '' ? Number(form.term_number) : null,
      week:         form.week        !== '' ? Number(form.week)        : null,
      notes:        form.notes.trim() || null,
      file_path,
    }

    const { error } = isEdit
      ? await supabase.from('booklets').update(payload).eq('id', booklet.id)
      : await supabase.from('booklets').insert(payload)

    if (error) { setErr(error.message); setSaving(false); return }
    onSaved()
  }

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
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
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
          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Notes <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Any notes about this booklet…" className={INP + ' resize-none'} />
          </div>
          {/* PDF upload */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">
              PDF {isEdit && booklet?.file_path ? '(replace existing)' : '(optional)'}
            </label>
            {isEdit && booklet?.file_path && !file && (
              <p className="text-[10px] text-[#059669] mb-1.5">✓ File already uploaded — upload a new one to replace it</p>
            )}
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-[#DEE7FF] rounded-xl px-4 py-4 text-center cursor-pointer hover:border-[#325099] hover:bg-[#F8FAFF] transition"
            >
              {file ? (
                <p className="text-xs font-semibold text-[#325099]">📄 {file.name}</p>
              ) : (
                <p className="text-xs text-[#2A2035]/40">Click to select PDF</p>
              )}
            </div>
            <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-[#F0F4FF] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 text-xs font-semibold bg-[#325099] text-white rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? (file ? 'Uploading…' : 'Saving…') : isEdit ? 'Save Changes' : 'Add Booklet'}
          </button>
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
  const [editing, setEditing]       = useState(null)
  const [deleteId, setDeleteId]     = useState(null)
  const [deleteFilePath, setDeleteFilePath] = useState(null)

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
      .select('id, booklet_name, year, subject, term_number, week, notes, file_path')
      .order('year').order('subject').order('term_number', { nullsFirst: false }).order('week', { nullsFirst: false })
    setBooklets(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { if (staff) load() }, [staff, load])

  // Delete
  const handleDelete = async () => {
    if (deleteFilePath) await supabase.storage.from('booklets').remove([deleteFilePath])
    await supabase.from('booklets').delete().eq('id', deleteId)
    setBooklets(b => b.filter(x => x.id !== deleteId))
    setDeleteId(null); setDeleteFilePath(null)
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
            <h1 className="text-2xl font-bold text-[#062E63]">Booklet Library</h1>
            <p className="text-sm text-[#2A2035]/50 mt-0.5">{booklets.length} booklet{booklets.length !== 1 ? 's' : ''} across all years and subjects</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#325099] text-white text-sm font-semibold rounded-xl hover:bg-[#062E63] transition"
          >
            <span className="text-base leading-none">+</span> Add Booklet
          </button>
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

      {/* Subject tabs */}
      <div className="max-w-7xl mx-auto px-6 md:px-10 pt-6">
        <div className="flex gap-2 mb-6">
          {SUBJECTS.map(s => (
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

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase animate-pulse">Loading…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <p className="text-5xl">📚</p>
            <p className="text-base font-semibold text-[#2A2035]">No booklets for Year {activeYear} {activeSub} yet</p>
            <button onClick={() => setShowAdd(true)}
              className="px-5 py-2.5 bg-[#325099] text-white text-sm font-semibold rounded-xl hover:bg-[#062E63] transition">
              Add the first one
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-8 pb-12">
            {termKeys.map(termKey => (
              <div key={termKey}>
                <h2 className="text-xs font-bold uppercase tracking-widest text-[#325099]/60 mb-3">{termKey}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {grouped[termKey].map(b => {
                    const pdfUrl = getPdfUrl(b.file_path)
                    return (
                      <div key={b.id} className="bg-white rounded-2xl border border-[#E8EDF8] shadow-sm flex flex-col overflow-hidden hover:shadow-md transition-shadow">
                        {/* Coloured top bar based on subject */}
                        <div className={`h-1 w-full ${b.subject === 'Maths' ? 'bg-[#325099]' : 'bg-[#7C3AED]'}`} />
                        <div className="px-4 pt-4 pb-3 flex-1 flex flex-col">
                          {/* Week badge */}
                          {b.week && (
                            <span className="text-[9px] font-bold uppercase tracking-widest text-[#325099]/50 mb-1.5">Week {b.week}</span>
                          )}
                          <p className="text-sm font-bold text-[#062E63] leading-snug flex-1">{b.booklet_name}</p>
                          {b.notes && (
                            <p className="text-[11px] text-[#2A2035]/50 mt-1.5 line-clamp-2">{b.notes}</p>
                          )}
                        </div>
                        {/* Footer */}
                        <div className="px-4 pb-4 flex items-center justify-between gap-2">
                          <div className="flex gap-3">
                            <button onClick={() => setEditing(b)}
                              className="text-[10px] font-semibold text-[#325099] hover:underline">Edit</button>
                            <button onClick={() => { setDeleteId(b.id); setDeleteFilePath(b.file_path) }}
                              className="text-[10px] font-semibold text-red-400 hover:underline">Delete</button>
                          </div>
                          {pdfUrl ? (
                            <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2.5 py-1 bg-[#EEF4FF] text-[#325099] text-[10px] font-bold rounded-lg hover:bg-[#DEE7FF] transition">
                              📄 PDF
                            </a>
                          ) : (
                            <span className="text-[10px] text-[#2A2035]/25 font-medium">No PDF</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {(showAdd || editing) && (
        <BookletModal
          booklet={editing}
          defaultYear={activeYear}
          defaultSubject={activeSub}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSaved={() => { setShowAdd(false); setEditing(null); load() }}
        />
      )}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-80 border border-[#DEE7FF]">
            <div className="px-6 py-5">
              <p className="text-sm font-bold text-[#062E63] mb-2">Delete this booklet?</p>
              <p className="text-xs text-[#2A2035]/60 leading-relaxed">
                {deleteFilePath
                  ? 'The booklet record and its uploaded PDF will both be permanently deleted.'
                  : 'The booklet record will be permanently deleted.'}
              </p>
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button onClick={() => { setDeleteId(null); setDeleteFilePath(null) }}
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

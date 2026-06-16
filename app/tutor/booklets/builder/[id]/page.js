'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import { T_BOOKLET_BUILDS, T_BOOKLETS, T_QBANK_QUESTIONS } from '../../../../../lib/tables'
import { BLOCK_TYPES, newBlock } from '../../../../../lib/bookletRender'
import { exportBookletPdf } from '../../../../../lib/bookletExport'
import BlockEditor from '../../../../../components/booklet/BlockEditor'
import BookletPreview from '../../../../../components/booklet/BookletPreview'
import PdfPreviewModal from '../../../../../components/qbank/PdfPreviewModal'

export default function BookletBuilderEditor() {
  const router = useRouter()
  const { id } = useParams()
  const [staff, setStaff] = useState(null)
  const [bk, setBk] = useState(null)          // { id, title, year, subject, topic, blocks, status, booklet_id }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [solnView, setSolnView] = useState(false)
  const [preview, setPreview] = useState(null)
  const [bankOpen, setBankOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const bkRef = useRef(null)
  useEffect(() => { bkRef.current = bk })
  const savingRef = useRef(false), pendingRef = useRef(false)

  useEffect(() => {
    (async () => {
      const { profile } = await getAuthProfile()
      if (!profile || (profile.role !== 'admin' && profile.role !== 'tutor')) { router.push('/tutor'); return }
      setStaff(profile)
      const { data } = await supabase.from(T_BOOKLET_BUILDS).select('*').eq('id', id).single()
      if (data) setBk({ ...data, blocks: Array.isArray(data.blocks) ? data.blocks : [] })
      setLoading(false)
    })()
  }, [id, router])

  // Debounced autosave (mirrors the exam builder).
  const save = useCallback(async () => {
    if (savingRef.current) { pendingRef.current = true; return }
    savingRef.current = true; setSaving(true)
    try {
      do {
        pendingRef.current = false
        const b = bkRef.current
        await supabase.from(T_BOOKLET_BUILDS).update({
          title: b.title, year: b.year ? Number(b.year) : null, subject: b.subject, topic: b.topic,
          blocks: b.blocks, updated_at: new Date().toISOString(),
        }).eq('id', b.id)
      } while (pendingRef.current)
      setDirty(false)
    } finally { savingRef.current = false; setSaving(false) }
  }, [])

  useEffect(() => {
    if (loading || !dirty) return
    const t = setTimeout(() => save(), 900)
    return () => clearTimeout(t)
  }, [dirty, bk, loading, save])

  const mutate = (patch) => { setBk(b => ({ ...b, ...patch })); setDirty(true) }
  const setBlocks = (blocks) => mutate({ blocks })

  const addBlock = (type) => setBlocks([...(bk.blocks || []), newBlock(type)])
  const updateBlock = (bid, next) => setBlocks(bk.blocks.map(b => b.id === bid ? next : b))
  const removeBlock = (bid) => setBlocks(bk.blocks.filter(b => b.id !== bid))
  const moveBlock = (bid, dir) => {
    const i = bk.blocks.findIndex(b => b.id === bid)
    const j = i + dir
    if (i < 0 || j < 0 || j >= bk.blocks.length) return
    const arr = [...bk.blocks];[arr[i], arr[j]] = [arr[j], arr[i]]; setBlocks(arr)
  }
  // Drag-to-reorder
  const dragId = useRef(null)
  const onDropOn = (targetId) => {
    const from = bk.blocks.findIndex(b => b.id === dragId.current)
    const to = bk.blocks.findIndex(b => b.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    const arr = [...bk.blocks]; const [m] = arr.splice(from, 1); arr.splice(to, 0, m); setBlocks(arr)
  }

  const meta = bk ? { subject: bk.subject, year: bk.year, topic: bk.topic } : {}

  const openExport = async (solutions) => {
    setExporting(true)
    try {
      const res = await exportBookletPdf({ meta, blocks: bk.blocks, solutions, preview: true })
      setPreview({ url: res.url, filename: res.filename, title: solutions ? 'Solutions copy — preview' : 'Student copy — preview' })
    } catch (e) { alert('Export failed: ' + e.message) }
    finally { setExporting(false) }
  }
  const closePreview = () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null) }

  // Publish: render both PDFs, upload to the booklets bucket, upsert a booklets
  // row (so it can be assigned to a class on the curriculum page), link it back.
  const publish = async () => {
    if (!bk.year) { alert('Set a Year before saving to the curriculum.'); return }
    setPublishing(true)
    try {
      await save()
      const subjectLower = (bk.subject || 'mathematics').toLowerCase()
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const upload = async (solutions, tag) => {
        const { blob } = await exportBookletPdf({ meta, blocks: bk.blocks, solutions, preview: true })
        const path = `y${bk.year}/${subjectLower}/${stamp}_${tag}.pdf`
        const { error } = await supabase.storage.from('booklets').upload(path, blob, { upsert: true, contentType: 'application/pdf' })
        if (error) throw error
        return path
      }
      const studentPath = await upload(false, 'student')
      const solutionsPath = await upload(true, 'solutions')
      const filePaths = [studentPath, solutionsPath]
      const payload = {
        booklet_name: bk.title, year: Number(bk.year), subject: bk.subject,
        topic: bk.topic || null, file_path: studentPath, file_paths: filePaths,
      }
      let bookletId = bk.booklet_id
      if (bookletId) await supabase.from(T_BOOKLETS).update(payload).eq('id', bookletId)
      else {
        const { data, error } = await supabase.from(T_BOOKLETS).insert(payload).select('id').single()
        if (error) throw error
        bookletId = data.id
      }
      await supabase.from(T_BOOKLET_BUILDS).update({ status: 'published', booklet_id: bookletId }).eq('id', bk.id)
      setBk(b => ({ ...b, status: 'published', booklet_id: bookletId }))
      alert('Saved to curriculum. You can now assign it to a class from the Curriculum page.')
    } catch (e) { alert('Save to curriculum failed: ' + e.message) }
    finally { setPublishing(false) }
  }

  if (loading) return <div className="min-h-screen bg-white"><TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} /><p className="text-center text-[#325099] text-sm mt-20">Loading…</p></div>
  if (!bk) return <div className="min-h-screen bg-white"><TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} /><p className="text-center text-rose-500 text-sm mt-20">Booklet not found.</p></div>

  return (
    <div className="min-h-screen bg-[#F7F9FF]">
      <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />

      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-white border-b border-[#DEE7FF]">
        <div className="max-w-[1500px] mx-auto px-5 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => router.push('/tutor/booklets/builder')} className="text-[#325099] text-sm hover:underline">← Booklets</button>
          <input value={bk.title} onChange={e => mutate({ title: e.target.value })} className="flex-1 min-w-[200px] text-base font-semibold text-[#2A2035] border border-transparent hover:border-[#DEE7FF] focus:border-[#325099] rounded-lg px-2 py-1 focus:outline-none" />
          <span className="text-[11px] text-[#2A2035]/40">{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
          <button onClick={() => openExport(false)} disabled={exporting} className="px-3 py-1.5 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] disabled:opacity-40">Student PDF</button>
          <button onClick={() => openExport(true)} disabled={exporting} className="px-3 py-1.5 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] disabled:opacity-40">Solutions PDF</button>
          <button onClick={publish} disabled={publishing} className="px-3 py-1.5 text-xs font-semibold text-white bg-[#325099] rounded-lg hover:bg-[#062E63] disabled:opacity-40">{publishing ? 'Saving…' : bk.status === 'published' ? 'Update curriculum' : 'Save to curriculum'}</button>
        </div>
        {/* Meta row */}
        <div className="max-w-[1500px] mx-auto px-5 pb-3 flex items-center gap-2 flex-wrap text-sm">
          <input value={bk.subject || ''} onChange={e => mutate({ subject: e.target.value })} placeholder="Subject" className="w-36 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#325099]" />
          <input value={bk.year ?? ''} onChange={e => mutate({ year: e.target.value.replace(/\D/g, '') })} placeholder="Year" className="w-20 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#325099]" />
          <input value={bk.topic || ''} onChange={e => mutate({ topic: e.target.value })} placeholder="Topic (e.g. Area)" className="w-56 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#325099]" />
        </div>
      </div>

      <div className="max-w-[1500px] mx-auto px-5 py-5 grid grid-cols-1 lg:grid-cols-[1fr_620px] gap-6">
        {/* Editor column */}
        <div>
          {/* Add palette */}
          <div className="bg-white rounded-xl border border-[#DEE7FF] p-3 mb-4">
            <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold mb-2">Add a block</p>
            <div className="flex flex-wrap gap-1.5">
              {BLOCK_TYPES.map(t => (
                <button key={t.type} onClick={() => addBlock(t.type)} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 hover:bg-[#F0F4FF] transition">
                  <span className="mr-1">{t.icon}</span>{t.label}
                </button>
              ))}
              <button onClick={() => setBankOpen(true)} className="text-xs font-semibold text-white bg-[#325099] rounded-lg px-2.5 py-1.5 hover:bg-[#062E63] transition">＋ From question bank</button>
            </div>
          </div>

          {/* Blocks */}
          {(bk.blocks || []).length === 0 ? (
            <div className="text-center py-16 text-sm text-[#2A2035]/40 bg-white rounded-xl border border-dashed border-[#DEE7FF]">No blocks yet — add one above.</div>
          ) : (
            <div className="space-y-3">
              {bk.blocks.map((b, i) => (
                <div key={b.id}
                  draggable
                  onDragStart={() => { dragId.current = b.id }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => onDropOn(b.id)}
                  className="bg-white rounded-xl border border-[#DEE7FF] p-3.5">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="cursor-grab text-[#2A2035]/30 text-sm" title="Drag to reorder">⠿</span>
                      <span className="text-[10px] font-bold tracking-wider uppercase text-[#325099] bg-[#EEF4FF] border border-[#DEE7FF] rounded-full px-2 py-0.5">{BLOCK_TYPES.find(t => t.type === b.type)?.label || b.type}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[#2A2035]/40">
                      <button onClick={() => moveBlock(b.id, -1)} disabled={i === 0} className="hover:text-[#325099] disabled:opacity-20 text-sm">↑</button>
                      <button onClick={() => moveBlock(b.id, 1)} disabled={i === bk.blocks.length - 1} className="hover:text-[#325099] disabled:opacity-20 text-sm">↓</button>
                      <button onClick={() => removeBlock(b.id)} className="hover:text-rose-500 text-sm ml-1">🗑</button>
                    </div>
                  </div>
                  <BlockEditor block={b} onChange={next => updateBlock(b.id, next)} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview column */}
        <div>
          <div className="sticky top-[112px]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Live preview</p>
              <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden text-xs">
                <button onClick={() => setSolnView(false)} className={`px-2.5 py-1 font-semibold ${!solnView ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Student</button>
                <button onClick={() => setSolnView(true)} className={`px-2.5 py-1 font-semibold border-l border-[#DEE7FF] ${solnView ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Solutions</button>
              </div>
            </div>
            <div className="bg-[#E9EDF6] rounded-xl p-4 overflow-auto max-h-[calc(100vh-160px)]">
              <BookletPreview meta={meta} blocks={bk.blocks} solutions={solnView} />
            </div>
          </div>
        </div>
      </div>

      {bankOpen && <BankPicker booklet={bk} onClose={() => setBankOpen(false)} onPick={(blk) => { setBlocks([...(bk.blocks || []), blk]); }} />}
      {preview && <PdfPreviewModal url={preview.url} filename={preview.filename} title={preview.title} onClose={closePreview} />}
    </div>
  )
}

// ── Question-bank picker ────────────────────────────────────────────────────────
function bankToBlock(q) {
  const imgs = (q.qbank_question_images || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const firstImg = imgs[0]?.storage_path || ''
  if (q.qtype === 'mcq') {
    const opts = Array.isArray(q.options) ? q.options : []
    const options = ['A', 'B', 'C', 'D'].map((k, i) => ({ k, t: typeof opts[i] === 'string' ? opts[i] : (opts[i]?.text ?? '') }))
    return { ...newBlock('mcq'), prompt: q.stem_latex || '', image: firstImg, options, answer: (q.correct_option || '').toString().toUpperCase().slice(0, 1), explanation: q.solution_latex || '' }
  }
  const parts = (q.qbank_question_parts || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(p => ({ prompt: p.prompt_latex || '', image: '' }))
  return { ...newBlock('question'), prompt: q.stem_latex || '', image: firstImg, marks: q.marks ? String(q.marks) : '', solution: q.solution_latex || '', parts }
}

function BankPicker({ booklet, onClose, onPick }) {
  const [qs, setQs] = useState(null)
  const [search, setSearch] = useState('')
  const [qtype, setQtype] = useState('')

  useEffect(() => {
    supabase.from(T_QBANK_QUESTIONS)
      .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order)')
      .then(({ data }) => setQs(data || []))
  }, [])

  const filtered = (qs || []).filter(q => {
    if (qtype && q.qtype !== qtype) return false
    if (search && !((q.stem_latex || '').toLowerCase().includes(search.toLowerCase()))) return false
    return true
  }).slice(0, 80)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#DEE7FF] flex items-center gap-2">
          <h2 className="text-base font-bold text-[#2A2035] mr-auto">Add from question bank</h2>
          <select value={qtype} onChange={e => setQtype(e.target.value)} className="border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none">
            <option value="">All types</option><option value="mcq">MCQ</option><option value="extended">Written</option>
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="border border-[#DEE7FF] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#325099]" />
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg ml-1">✕</button>
        </div>
        <div className="overflow-y-auto p-3 space-y-1.5">
          {qs === null ? <p className="text-center text-xs text-[#2A2035]/40 py-8">Loading…</p>
            : filtered.length === 0 ? <p className="text-center text-xs text-[#2A2035]/40 py-8">No matching questions.</p>
            : filtered.map(q => (
              <button key={q.id} onClick={() => { onPick(bankToBlock(q)); onClose() }} className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border border-[#E8EDF8] hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition">
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#EEF4FF] text-[#325099] shrink-0">{q.qtype}</span>
                <span className="flex-1 min-w-0 text-xs text-[#2A2035] truncate">{(q.stem_latex || '(no text)').replace(/\$/g, '').slice(0, 110)}</span>
                {q.difficulty && <span className="text-[10px] text-[#2A2035]/40 shrink-0">D{q.difficulty}</span>}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

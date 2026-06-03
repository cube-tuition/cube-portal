'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { T_CLASS_BOOKLETS } from '../lib/tables'

/*
 * <WeekBooklet cls={...} term={...} week={N} isAdmin={bool} />
 *
 * Admins can upload multiple PDFs, replace individual ones, or delete.
 * Tutors/students can view and download each PDF.
 *
 * Files are stored in Supabase Storage bucket "class-booklets".
 * Metadata lives in public.class_booklets (storage_path = first/legacy,
 * storage_paths = full jsonb array of all paths).
 */

export default function WeekBooklet({ cls, term, week, isAdmin }) {
  const eligible = !!(cls?.id && term?.term_number && week >= 1 && week <= 10)

  const [booklet,      setBooklet]      = useState(null)
  const [loading,      setLoading]      = useState(eligible)

  // Upload form state
  const [showUpload,   setShowUpload]   = useState(false)   // "add another" form
  const [replacing,    setReplacing]    = useState(false)   // full replace flow
  const [uploadName,   setUploadName]   = useState('')
  const [uploadFiles,  setUploadFiles]  = useState([])      // new files staged
  const [uploading,    setUploading]    = useState(false)
  const [uploadError,  setUploadError]  = useState(null)
  const fileRef = useRef(null)

  // Viewer state
  const [viewUrl,      setViewUrl]      = useState(null)
  const [viewLabel,    setViewLabel]    = useState('')
  const [viewLoading,  setViewLoading]  = useState(null)    // index being loaded

  // Delete state
  const [deleting,     setDeleting]     = useState(false)
  const [confirmDel,   setConfirmDel]   = useState(false)
  const [deletingIdx,  setDeletingIdx]  = useState(null)    // index of single PDF being deleted

  // ── Load booklet row ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!eligible) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from(T_CLASS_BOOKLETS)
        .select('id, booklet_name, storage_path, storage_paths, storage_filenames, updated_at')
        .eq('class_id', cls.id)
        .eq('term_number', term.term_number)
        .eq('week', week)
        .maybeSingle()
      if (cancelled) return
      setBooklet(data || null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [eligible, cls?.id, term?.term_number, week])

  // Derive the list of all PDF paths for a booklet
  const getPaths = (b) => {
    if (!b) return []
    if (b.storage_paths?.length) return b.storage_paths
    if (b.storage_path) return [b.storage_path]
    return []
  }

  // Derive display names for each PDF (original filenames stored alongside paths)
  const getFilenames = (b) => {
    if (!b) return []
    if (b.storage_filenames?.length) return b.storage_filenames
    // Fall back: extract filename from path
    return getPaths(b).map(p => p.split('/').pop().replace(/^\d+-[a-z0-9]+-/, '').replace(/_/g, ' '))
  }

  // ── Generate signed URL and open viewer ────────────────────────────────────
  const handleView = async (path, label, idx) => {
    setViewLoading(idx)
    const { data, error } = await supabase.storage
      .from('class-booklets')
      .createSignedUrl(path, 600)
    setViewLoading(null)
    if (error || !data?.signedUrl) {
      alert('Could not load the PDF. Please try again.')
      return
    }
    setViewUrl(data.signedUrl)
    setViewLabel(label)
  }

  // ── Upload new PDF(s) ──────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!uploadFiles.length) return
    setUploading(true)
    setUploadError(null)

    const existingPaths     = replacing ? [] : getPaths(booklet)
    const existingFilenames = replacing ? [] : getFilenames(booklet)
    const newPaths     = []
    const newFilenames = []

    for (const file of uploadFiles) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${cls.id}/term-${term.term_number}/week-${week}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`
      const { error: storageErr } = await supabase.storage
        .from('class-booklets')
        .upload(path, file, { contentType: 'application/pdf', upsert: true })
      if (storageErr) {
        setUploadError(storageErr.message)
        setUploading(false)
        return
      }
      newPaths.push(path)
      newFilenames.push(file.name.replace(/\.pdf$/i, ''))
    }

    // If replacing, remove old storage files
    if (replacing && booklet) {
      const old = getPaths(booklet)
      if (old.length) await supabase.storage.from('class-booklets').remove(old)
    }

    const finalPaths     = [...existingPaths, ...newPaths]
    const finalFilenames = [...existingFilenames, ...newFilenames]
    const name = uploadName.trim() || booklet?.booklet_name || newFilenames[0] || uploadFiles[0].name.replace(/\.pdf$/i, '').replace(/_/g, ' ')

    const payload = {
      class_id:           cls.id,
      term_number:        term.term_number,
      week,
      booklet_name:       name,
      storage_path:       finalPaths[0] ?? null,
      storage_paths:      finalPaths,
      storage_filenames:  finalFilenames,
      updated_at:         new Date().toISOString(),
    }

    const { data: row, error: dbErr } = await supabase
      .from(T_CLASS_BOOKLETS)
      .upsert(payload, { onConflict: 'class_id,term_number,week' })
      .select()
      .single()

    if (dbErr) {
      setUploadError(dbErr.message)
      setUploading(false)
      return
    }

    setBooklet(row)
    setUploading(false)
    setUploadFiles([])
    setUploadName('')
    setShowUpload(false)
    setReplacing(false)
    setViewUrl(null)
  }

  // ── Delete a single PDF from the list ──────────────────────────────────────
  const handleDeletePdf = async (idx) => {
    if (deletingIdx !== idx) {
      setDeletingIdx(idx)
      setTimeout(() => setDeletingIdx(null), 3000)
      return
    }
    const paths     = getPaths(booklet)
    const filenames = getFilenames(booklet)
    await supabase.storage.from('class-booklets').remove([paths[idx]])
    const newPaths     = paths.filter((_, i) => i !== idx)
    const newFilenames = filenames.filter((_, i) => i !== idx)

    if (newPaths.length === 0) {
      await supabase.from(T_CLASS_BOOKLETS).delete().eq('id', booklet.id)
      setBooklet(null)
    } else {
      const { data: row } = await supabase
        .from(T_CLASS_BOOKLETS)
        .update({ storage_path: newPaths[0], storage_paths: newPaths, storage_filenames: newFilenames, updated_at: new Date().toISOString() })
        .eq('id', booklet.id)
        .select()
        .single()
      setBooklet(row)
    }
    setDeletingIdx(null)
  }

  // ── Delete entire booklet ──────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!confirmDel) {
      setConfirmDel(true)
      setTimeout(() => setConfirmDel(false), 4000)
      return
    }
    setDeleting(true)
    const paths = getPaths(booklet)
    if (paths.length) await supabase.storage.from('class-booklets').remove(paths)
    await supabase.from(T_CLASS_BOOKLETS).delete().eq('id', booklet.id)
    setBooklet(null)
    setViewUrl(null)
    setDeleting(false)
    setConfirmDel(false)
  }

  const cancelUpload = () => {
    setShowUpload(false)
    setReplacing(false)
    setUploadFiles([])
    setUploadName('')
    setUploadError(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!term || week == null) return null

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#325099]">Loading booklet…</p>
      </div>
    )
  }

  // ── PDF viewer ──────────────────────────────────────────────────────────────
  if (viewUrl) {
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
        <div className="px-5 md:px-6 py-4 border-b border-[#DEE7FF] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setViewUrl(null)}
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] px-3 py-1.5 rounded-full hover:bg-[#F8FAFF] transition shrink-0"
            >
              ← Back
            </button>
            <WeekChip n={week} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#2A2035] font-display truncate">
                {viewLabel || booklet?.booklet_name || `Week ${week} Booklet`}
              </p>
              <p className="text-[11px] text-[#2A2035]/50 truncate">{cls?.class_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a href={viewUrl} download target="_blank" rel="noopener noreferrer"
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] px-3 py-2 rounded-full hover:bg-[#F8FAFF] transition">
              ↓ Download
            </a>
            <a href={viewUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] transition">
              Open in new tab ↗
            </a>
          </div>
        </div>
        <iframe
          src={viewUrl}
          className="w-full"
          style={{ height: '75vh', border: 'none' }}
          title={viewLabel || `Week ${week} Booklet`}
        />
      </div>
    )
  }

  // ── Upload / replace form (admins only) ─────────────────────────────────────
  if ((isAdmin && !booklet) || showUpload || replacing) {
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
        <div className="px-5 md:px-6 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF] flex items-center gap-3">
          <WeekChip n={week} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold">
              {replacing ? 'Replace all PDFs' : booklet ? 'Add PDF' : 'Upload booklet'}
            </p>
            <p className="text-xs text-[#2A2035]/50 mt-0.5">Week {week} · {cls?.class_name}</p>
          </div>
          {(showUpload || replacing) && (
            <button onClick={cancelUpload}
              className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035] px-3 py-1.5 rounded-full hover:bg-[#F0F0F4] transition">
              Cancel
            </button>
          )}
        </div>

        <div className="px-5 md:px-6 py-5 space-y-4">
          {/* Name input — only shown when no booklet yet or replacing */}
          {(!booklet || replacing) && (
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">
                Booklet name
              </label>
              <input
                type="text"
                value={uploadName}
                onChange={e => setUploadName(e.target.value)}
                placeholder={`e.g. Week ${week} Maths Booklet`}
                className="w-full bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-2.5 text-sm text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition"
              />
            </div>
          )}

          {/* Staged files list */}
          {uploadFiles.map((f, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 bg-[#EEF4FF] rounded-xl">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base">📄</span>
                <span className="text-xs font-semibold text-[#325099] truncate">{f.name}</span>
                <span className="text-[10px] text-[#2A2035]/40 shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              </div>
              <button onClick={() => setUploadFiles(prev => prev.filter((_, j) => j !== i))}
                className="text-[10px] font-semibold text-red-400 hover:text-red-600 ml-2 shrink-0">
                Remove
              </button>
            </div>
          ))}

          {/* File picker dropzone */}
          <div
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer border-2 border-dashed border-[#DEE7FF] rounded-xl px-5 py-7 text-center hover:border-[#325099]/50 hover:bg-[#F0F4FF] transition select-none"
          >
            <p className="text-2xl mb-1.5">📤</p>
            <p className="text-sm font-semibold text-[#325099]">
              {uploadFiles.length > 0 ? '+ Add another PDF' : 'Click to select PDF(s)'}
            </p>
            <p className="text-[11px] text-[#2A2035]/40 mt-0.5">Max 50 MB each</p>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={e => {
                const picked = Array.from(e.target.files || [])
                setUploadFiles(prev => [...prev, ...picked])
                if (!uploadName.trim() && picked[0]) {
                  setUploadName(picked[0].name.replace(/\.pdf$/i, '').replace(/_/g, ' '))
                }
                e.target.value = ''
              }}
            />
          </div>

          {uploadError && (
            <p className="text-xs font-semibold text-[#991B1B] bg-[#FEE2E2] rounded-xl px-4 py-2.5">
              ✕ {uploadError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadFiles.length}
              className="text-xs font-semibold bg-[#325099] text-white px-6 py-2.5 rounded-full hover:bg-[#062E63] transition disabled:opacity-50 flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                  Uploading…
                </>
              ) : (
                replacing ? 'Replace booklet' : booklet ? `Add ${uploadFiles.length || ''} PDF${uploadFiles.length !== 1 ? 's' : ''}`.trim() : 'Upload booklet'
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── No booklet — tutor empty state ──────────────────────────────────────────
  if (!booklet) {
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-8 text-center">
        <div className="text-3xl mb-2">📭</div>
        <p className="text-sm font-semibold text-[#2A2035] mb-1">No booklet uploaded for Week {week} yet.</p>
        <p className="text-xs text-[#2A2035]/60">
          Your admin will upload the Week {week} booklet for {cls?.class_name || 'this class'}.
        </p>
      </div>
    )
  }

  // ── Booklet card ────────────────────────────────────────────────────────────
  const pdfPaths     = getPaths(booklet)
  const pdfFilenames = getFilenames(booklet)

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      {/* Header */}
      <div className="px-5 md:px-6 py-4 border-b border-[#DEE7FF] flex items-center gap-3 bg-[#F8FAFF]">
        <WeekChip n={week} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#2A2035] font-display truncate">
            {booklet.booklet_name || `Week ${week} Booklet`}
          </p>
          <p className="text-[11px] text-[#2A2035]/50 truncate">
            {booklet.updated_at
              ? `Updated ${new Date(booklet.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'PDF uploaded'}
            {cls?.class_name && <> · {cls.class_name}</>}
          </p>
        </div>
        {/* Admin controls */}
        {isAdmin && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                setShowUpload(true)
                setUploadFiles([])
                setUploadError(null)
              }}
              className="text-[11px] font-semibold text-[#325099] px-3 py-1.5 rounded-full hover:bg-[#DEE7FF] transition"
            >
              + Add PDF
            </button>
            <button
              onClick={() => {
                setReplacing(true)
                setUploadName(booklet.booklet_name || '')
                setUploadFiles([])
                setUploadError(null)
              }}
              className="text-[11px] font-semibold text-[#325099] px-3 py-1.5 rounded-full hover:bg-[#DEE7FF] transition"
            >
              Replace
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition disabled:opacity-50 ${
                confirmDel ? 'bg-[#FEE2E2] text-[#991B1B] hover:bg-[#FECACA]' : 'text-[#991B1B]/60 hover:bg-[#FEE2E2]'
              }`}
            >
              {deleting ? 'Deleting…' : confirmDel ? 'Confirm delete?' : 'Delete all'}
            </button>
          </div>
        )}
      </div>

      {/* PDF rows */}
      {pdfPaths.length > 0 ? (
        <div className="divide-y divide-[#F0F4FF]">
          {pdfPaths.map((path, i) => {
            const label = pdfFilenames[i] || booklet.booklet_name || `Week ${week} Booklet`
            return (
              <div key={path} className="px-5 md:px-6 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-[#FEE2E2] text-[#991B1B] flex items-center justify-center text-xs font-bold shrink-0">
                    PDF
                  </span>
                  <p className="text-sm font-semibold text-[#2A2035] truncate">{label}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin && (
                    <button
                      onClick={() => handleDeletePdf(i)}
                      className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition ${
                        deletingIdx === i ? 'bg-[#FEE2E2] text-[#991B1B]' : 'text-[#2A2035]/30 hover:text-[#991B1B] hover:bg-[#FEE2E2]'
                      }`}
                    >
                      {deletingIdx === i ? 'Confirm?' : '✕'}
                    </button>
                  )}
                  <button
                    onClick={() => handleView(path, label, i)}
                    disabled={viewLoading === i}
                    className="text-xs font-semibold bg-[#325099] text-white px-5 py-2 rounded-full hover:bg-[#062E63] transition disabled:opacity-60"
                  >
                    {viewLoading === i ? 'Loading…' : 'View →'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="px-6 py-5 text-xs text-[#2A2035]/40 italic">No PDF file attached yet.</div>
      )}
    </div>
  )
}

// ── WeekChip ──────────────────────────────────────────────────────────────────
function WeekChip({ n }) {
  return (
    <div className="w-11 h-11 rounded-xl flex flex-col items-center justify-center shrink-0 border border-[#DEE7FF] bg-white">
      <span className="text-[8px] tracking-widest uppercase font-bold text-[#325099] leading-none">Wk</span>
      <span className="text-sm font-bold text-[#062E63] tabular-nums leading-tight mt-0.5">{n}</span>
    </div>
  )
}

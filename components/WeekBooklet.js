'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/*
 * <WeekBooklet cls={...} term={...} week={N} isAdmin={bool} />
 *
 * Admins can upload, replace, or delete a PDF booklet for any
 * class + term + week combination. Tutors can view and download.
 *
 * Files are stored in Supabase Storage bucket "class-booklets".
 * Metadata (name, storage path) lives in public.class_booklets.
 */

export default function WeekBooklet({ cls, term, week, isAdmin }) {
  const eligible = !!(cls?.id && term?.term_number && week >= 1 && week <= 10)

  const [booklet,      setBooklet]      = useState(null)
  const [loading,      setLoading]      = useState(eligible)

  // Upload / replace state
  const [replacing,    setReplacing]    = useState(false)
  const [uploadName,   setUploadName]   = useState('')
  const [uploadFile,   setUploadFile]   = useState(null)
  const [uploading,    setUploading]    = useState(false)
  const [uploadError,  setUploadError]  = useState(null)
  const fileRef = useRef(null)

  // Viewer state
  const [viewUrl,      setViewUrl]      = useState(null)
  const [viewLoading,  setViewLoading]  = useState(false)

  // Delete state
  const [deleting,     setDeleting]     = useState(false)
  const [confirmDel,   setConfirmDel]   = useState(false)

  // ── Load booklet row ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!eligible) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('class_booklets')
        .select('id, booklet_name, storage_path, updated_at')
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

  // ── Generate signed URL and open PDF viewer ────────────────────────────────
  const handleView = async () => {
    if (!booklet?.storage_path) return
    setViewLoading(true)
    const { data, error } = await supabase.storage
      .from('class-booklets')
      .createSignedUrl(booklet.storage_path, 600) // 10-minute URL
    setViewLoading(false)
    if (error || !data?.signedUrl) {
      alert('Could not load the PDF. Please try again.')
      return
    }
    setViewUrl(data.signedUrl)
  }

  // ── Upload (new or replace) ────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadError(null)

    // Remove old storage file when replacing
    if (booklet?.storage_path) {
      await supabase.storage.from('class-booklets').remove([booklet.storage_path])
    }

    // Build a clean storage path
    const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${cls.id}/term-${term.term_number}/week-${week}/${Date.now()}-${safeName}`

    const { error: storageErr } = await supabase.storage
      .from('class-booklets')
      .upload(path, uploadFile, { contentType: 'application/pdf', upsert: true })

    if (storageErr) {
      setUploadError(storageErr.message)
      setUploading(false)
      return
    }

    // Upsert metadata row
    const name = uploadName.trim() || uploadFile.name.replace(/\.pdf$/i, '')
    const { data: row, error: dbErr } = await supabase
      .from('class_booklets')
      .upsert(
        {
          class_id: cls.id,
          term_number: term.term_number,
          week,
          booklet_name: name,
          storage_path: path,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'class_id,term_number,week' }
      )
      .select()
      .single()

    if (dbErr) {
      setUploadError(dbErr.message)
      setUploading(false)
      return
    }

    setBooklet(row)
    setUploading(false)
    setUploadName('')
    setUploadFile(null)
    setReplacing(false)
    setViewUrl(null)
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!confirmDel) {
      setConfirmDel(true)
      setTimeout(() => setConfirmDel(false), 4000)
      return
    }
    setDeleting(true)
    if (booklet?.storage_path) {
      await supabase.storage.from('class-booklets').remove([booklet.storage_path])
    }
    await supabase.from('class_booklets').delete().eq('id', booklet.id)
    setBooklet(null)
    setViewUrl(null)
    setDeleting(false)
    setConfirmDel(false)
  }

  const cancelReplace = () => {
    setReplacing(false)
    setUploadFile(null)
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
                {booklet.booklet_name || `Week ${week} Booklet`}
              </p>
              <p className="text-[11px] text-[#2A2035]/50 truncate">{cls?.class_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href={viewUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] px-3 py-2 rounded-full hover:bg-[#F8FAFF] transition"
            >
              ↓ Download
            </a>
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] transition"
            >
              Open in new tab ↗
            </a>
          </div>
        </div>
        <iframe
          src={viewUrl}
          className="w-full"
          style={{ height: '75vh', border: 'none' }}
          title={booklet.booklet_name || `Week ${week} Booklet`}
        />
      </div>
    )
  }

  // ── Upload / replace form (admins only) ─────────────────────────────────────
  if ((isAdmin && !booklet) || replacing) {
    return (
      <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
        <div className="px-5 md:px-6 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF] flex items-center gap-3">
          <WeekChip n={week} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold">
              {replacing ? 'Replace booklet' : 'Upload booklet'}
            </p>
            <p className="text-xs text-[#2A2035]/50 mt-0.5">
              Week {week} · {cls?.class_name}
            </p>
          </div>
          {replacing && (
            <button
              onClick={cancelReplace}
              className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035] px-3 py-1.5 rounded-full hover:bg-[#F0F0F4] transition"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="px-5 md:px-6 py-5 space-y-4">
          {/* Name input */}
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

          {/* File picker */}
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">
              PDF file
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className={`cursor-pointer border-2 border-dashed rounded-xl px-5 py-7 text-center transition select-none ${
                uploadFile
                  ? 'border-[#325099] bg-[#EEF4FF]'
                  : 'border-[#DEE7FF] bg-[#F8FAFF] hover:border-[#325099]/50 hover:bg-[#F0F4FF]'
              }`}
            >
              {uploadFile ? (
                <>
                  <p className="text-xl mb-1">📄</p>
                  <p className="text-sm font-bold text-[#325099] truncate max-w-xs mx-auto">{uploadFile.name}</p>
                  <p className="text-[11px] text-[#2A2035]/50 mt-0.5">
                    {(uploadFile.size / 1024 / 1024).toFixed(1)} MB · Click to change
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl mb-1.5">📤</p>
                  <p className="text-sm font-semibold text-[#325099]">Click to select a PDF</p>
                  <p className="text-[11px] text-[#2A2035]/40 mt-0.5">Max 50 MB</p>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0] || null
                  setUploadFile(f)
                  setUploadError(null)
                  // Pre-fill name from filename if field is blank
                  if (f && !uploadName.trim()) {
                    setUploadName(f.name.replace(/\.pdf$/i, '').replace(/_/g, ' '))
                  }
                }}
              />
            </div>
          </div>

          {/* Error */}
          {uploadError && (
            <p className="text-xs font-semibold text-[#991B1B] bg-[#FEE2E2] rounded-xl px-4 py-2.5">
              ✕ {uploadError}
            </p>
          )}

          {/* Submit */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadFile}
              className="text-xs font-semibold bg-[#325099] text-white px-6 py-2.5 rounded-full hover:bg-[#062E63] transition disabled:opacity-50 flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                  Uploading…
                </>
              ) : (
                replacing ? 'Replace booklet' : 'Upload booklet'
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
        <p className="text-sm font-semibold text-[#2A2035] mb-1">
          No booklet uploaded for Week {week} yet.
        </p>
        <p className="text-xs text-[#2A2035]/60">
          Your admin will upload the Week {week} booklet for{' '}
          {cls?.class_name || 'this class'}.
        </p>
      </div>
    )
  }

  // ── Booklet card ────────────────────────────────────────────────────────────
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
                setReplacing(true)
                setUploadName(booklet.booklet_name || '')
                setUploadFile(null)
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
                confirmDel
                  ? 'bg-[#FEE2E2] text-[#991B1B] hover:bg-[#FECACA]'
                  : 'text-[#991B1B]/60 hover:bg-[#FEE2E2]'
              }`}
            >
              {deleting ? 'Deleting…' : confirmDel ? 'Confirm delete?' : 'Delete'}
            </button>
          </div>
        )}
      </div>

      {/* PDF row */}
      {booklet.storage_path ? (
        <div className="px-5 md:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[#FEE2E2] text-[#991B1B] flex items-center justify-center text-xs font-bold shrink-0">
              PDF
            </span>
            <p className="text-sm font-semibold text-[#2A2035] truncate">
              {booklet.booklet_name || `Week ${week} Booklet`}
            </p>
          </div>
          <button
            onClick={handleView}
            disabled={viewLoading}
            className="shrink-0 text-xs font-semibold bg-[#325099] text-white px-5 py-2 rounded-full hover:bg-[#062E63] transition disabled:opacity-60"
          >
            {viewLoading ? 'Loading…' : 'View →'}
          </button>
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

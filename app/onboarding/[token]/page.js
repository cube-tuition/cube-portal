'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { ONBOARDING_BUCKET, UPLOAD_MAX_BYTES } from '../../../lib/onboarding'
import CubeLogo from '../../../components/CubeLogo'

/*
 * /onboarding/<token> — a newly hired tutor's upload page. No login: the
 * token from their onboarding email is the key, checked by /api/onboarding.
 *
 * They download the CUBE documents, then upload the six completed documents.
 * Each file goes straight from the browser to the private bucket through a
 * signed upload URL (so large scans are fine); the API then ticks it off.
 */

const fmtStart = (iso) => {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}
const fmtWhen = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export default function OnboardingUploadPage() {
  const { token } = useParams()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState({})      // docKey → true while uploading
  const [rowErr, setRowErr] = useState({})  // docKey → message
  const inputs = useRef({})

  const load = async () => {
    const res = await fetch(`/api/onboarding/${encodeURIComponent(token)}`, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j.error || 'This link could not be opened.'); return }
    setInfo(j)
  }
  useEffect(() => {
    let alive = true
    fetch(`/api/onboarding/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) setError(j.error || 'This link could not be opened.')
        else setInfo(j)
      })
      .catch(() => { if (alive) setError('This link could not be opened.') })
    return () => { alive = false }
  }, [token])

  const upload = async (docKey, file) => {
    if (!file) return
    setRowErr(e => ({ ...e, [docKey]: null }))
    if (file.size > UPLOAD_MAX_BYTES) { setRowErr(e => ({ ...e, [docKey]: 'That file is over 20 MB — please send a smaller copy.' })); return }
    setBusy(b => ({ ...b, [docKey]: true }))
    try {
      const api = `/api/onboarding/${encodeURIComponent(token)}/upload`
      const post = (body) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Upload failed'); return j })
      const { path, token: uploadToken } = await post({ action: 'url', docKey, filename: file.name, size: file.size, type: file.type })
      const { error: upErr } = await supabase.storage.from(ONBOARDING_BUCKET).uploadToSignedUrl(path, uploadToken, file, { contentType: file.type || undefined })
      if (upErr) throw new Error(upErr.message)
      await post({ action: 'done', docKey, path, filename: file.name, size: file.size })
      await load()
    } catch (e) {
      setRowErr(er => ({ ...er, [docKey]: e.message || 'Upload failed — please try again.' }))
    } finally {
      setBusy(b => ({ ...b, [docKey]: false }))
      if (inputs.current[docKey]) inputs.current[docKey].value = ''
    }
  }

  const shell = (children) => (
    <div className="min-h-screen bg-[#F4F7FF] px-4 py-8 md:py-14 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <CubeLogo className="h-9 w-auto" />
          <span className="text-sm font-bold tracking-[0.3em] uppercase text-[#062E63]">CUBE Tuition</span>
        </div>
        {children}
      </div>
    </div>
  )

  if (error) return shell(
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 text-center">
      <p className="text-base font-bold text-[#062E63] mb-1">Link not found</p>
      <p className="text-sm text-[#2A2035]/60">{error}</p>
    </div>
  )
  if (!info) return shell(<p className="text-sm text-[#2A2035]/40 animate-pulse text-center py-10">Loading…</p>)

  const done = info.docs.filter(d => d.uploaded).length
  const complete = info.status === 'complete'
  const allIn = done === info.docs.length

  return shell(
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
        <h1 className="text-xl md:text-2xl font-bold text-[#062E63]">Welcome{info.firstName ? `, ${info.firstName}` : ''}!</h1>
        <p className="text-sm text-[#2A2035]/70 mt-1.5 leading-relaxed">
          Please upload your six onboarding documents below{info.startDate ? ` before you start on ${fmtStart(info.startDate)}` : ' before your first lesson'}.
          They go straight to CUBE&rsquo;s private storage — only the directors can see them.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-[#EEF3FF] overflow-hidden">
            <div className="h-full bg-[#10B981] transition-all" style={{ width: `${(done / info.docs.length) * 100}%` }} />
          </div>
          <span className="text-xs font-bold text-[#062E63] tabular-nums">{done} / {info.docs.length}</span>
        </div>
      </div>

      {complete ? (
        <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl p-5 text-sm text-[#065F46]">
          <strong>Your onboarding is complete.</strong> Thank you — we&rsquo;ll be in touch about your first lessons.
        </div>
      ) : allIn ? (
        <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl p-5 text-sm text-[#065F46]">
          <strong>All six documents are in — thank you!</strong> We&rsquo;ll check them and let you know if anything needs fixing. You can still replace a file below.
        </div>
      ) : null}

      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#325099]/70 mb-3">1 · Download the CUBE documents</p>
        <div className="flex flex-wrap gap-2">
          {info.templates.map(t => (
            <a key={t.key} href={t.url || '#'} target="_blank" rel="noopener noreferrer"
              className="px-3 py-2 rounded-xl border border-[#DEE7FF] text-xs font-semibold text-[#325099] hover:bg-[#F4F7FF] transition">
              ⬇ {t.label}
            </a>
          ))}
        </div>
        <p className="text-[11px] text-[#2A2035]/50 mt-2">These are also attached to your welcome email.</p>
      </div>

      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 md:p-6">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#325099]/70 mb-3">2 · Upload your completed documents</p>
        <div className="divide-y divide-[#F0F4FF]">
          {info.docs.map((d, i) => (
            <div key={d.key} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#062E63]">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] mr-2 align-middle ${d.uploaded ? 'bg-[#10B981] text-white' : 'bg-[#EEF3FF] text-[#325099]'}`}>{d.uploaded ? '✓' : i + 1}</span>
                  {d.label}
                </p>
                <p className="text-[11px] text-[#2A2035]/55 mt-0.5 pl-7">
                  {d.hint}{d.link && <> <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-[#325099] underline">Get the form ↗</a></>}
                </p>
                {d.uploaded && <p className="text-[11px] text-[#065F46] mt-0.5 pl-7 truncate">Uploaded {fmtWhen(d.uploaded.at)} · {d.uploaded.filename}</p>}
                {rowErr[d.key] && <p className="text-[11px] font-semibold text-[#B91C1C] mt-0.5 pl-7">{rowErr[d.key]}</p>}
              </div>
              {!complete && (
                <label className={`shrink-0 self-start sm:self-auto px-3 py-2 rounded-xl text-xs font-bold cursor-pointer transition ${busy[d.key]
                  ? 'bg-[#EEF3FF] text-[#325099]/60 cursor-wait'
                  : d.uploaded ? 'bg-white border border-[#DEE7FF] text-[#325099] hover:bg-[#F4F7FF]' : 'bg-[#062E63] text-white hover:bg-[#325099]'}`}>
                  {busy[d.key] ? 'Uploading…' : d.uploaded ? 'Replace' : 'Upload'}
                  <input ref={el => { inputs.current[d.key] = el }} type="file" className="hidden" disabled={!!busy[d.key]}
                    accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.doc,.docx,application/pdf,image/*"
                    onChange={e => upload(d.key, e.target.files?.[0])} />
                </label>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#2A2035]/45 mt-3">PDF, photo (JPG, PNG, HEIC) or Word document, up to 20 MB each. A clear phone photo of a signed page is fine.</p>
      </div>

      <p className="text-[11px] text-center text-[#2A2035]/40">Questions? Reply to your welcome email. Please keep this link private.</p>
    </div>
  )
}

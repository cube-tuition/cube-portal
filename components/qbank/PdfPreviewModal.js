'use client'
import { useEffect, useRef, useState } from 'react'
import { getAuthProfile } from '../../lib/getProfile'
import { authedFetch } from '../../lib/authedFetch'

/*
 * In-page PDF preview. Shows a PDF in an iframe so tutors can check it without
 * downloading — either one generated in the browser (a blob URL) or one already
 * stored. Download + Close buttons in the header. The caller owns a blob URL;
 * onClose should revoke it.
 *
 * `downloadUrl` defaults to `url`. It exists because the `download` attribute
 * is ignored on a cross-origin link: a stored file has to be fetched from a URL
 * that sets Content-Disposition itself, while still being previewed from the
 * plain one.
 *
 * DOWNLOAD GATE — tutors are asked why before a download goes ahead, and the
 * answer is emailed to the admin inbox. Directors and admins are not prompted.
 * The role is resolved here rather than passed in by each caller, so no call
 * site can forget the gate and none of them have to repeat it.
 *
 * This is a workflow gate, not an access control. The booklets bucket is public
 * and the file's URL is already in the page, so it establishes a shared record
 * of intent — it does not stop anyone determined from fetching the file.
 */
export default function PdfPreviewModal({ url, filename, title = 'Preview', downloadUrl, onClose }) {
  const [role, setRole] = useState(null)
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const linkRef = useRef(null)
  // Set just before the programmatic click, so that click passes through the
  // gate instead of re-opening it.
  const allowRef = useRef(false)

  useEffect(() => {
    let dead = false
    getAuthProfile().then(({ role }) => { if (!dead) setRole(role) })
    return () => { dead = true }
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') (asking ? setAsking(false) : onClose?.()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, asking])

  if (!url) return null

  // Until the role is known, treat the user as a tutor: prompting a director by
  // mistake is a moment's friction, letting a tutor through is a lost record.
  const needsReason = role !== 'admin' && role !== 'director'

  const startDownload = () => { allowRef.current = true; linkRef.current?.click() }

  const onDownloadClick = (e) => {
    if (allowRef.current) { allowRef.current = false; return }   // the gated click, let through
    if (!needsReason) return            // the anchor's own navigation handles it
    e.preventDefault()
    setError(''); setReason(''); setAsking(true)
  }

  const submitReason = async (e) => {
    e.preventDefault()
    const clean = reason.trim()
    if (!clean) { setError('Please say why you need this download.'); return }
    setSending(true); setError('')
    try {
      const res = await authedFetch('/api/notify-material-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, filename, kind: 'PDF download', reason: clean }),
      })
      // The email IS the record here, so a failure holds the download back
      // rather than passing silently — the tutor can retry or ask a director.
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error || 'Could not record this download. Try again.')
        return
      }
      setAsking(false)
      startDownload()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0B1020]/70 backdrop-blur-sm"
      onClick={onClose}>
      <div className="flex-1 flex flex-col max-w-5xl w-full mx-auto px-4 py-6 min-h-0"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-sm font-bold text-white truncate flex-1">{title}</h2>
          <a ref={linkRef} href={downloadUrl || url} download={filename} onClick={onDownloadClick}
            className="px-3.5 py-1.5 rounded-lg bg-[#325099] text-white text-xs font-semibold hover:bg-[#243c75] transition">
            Download
          </a>
          <button onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-white/15 text-white text-xs font-semibold hover:bg-white/25 transition">
            Close
          </button>
        </div>

        {asking && (
          <form onSubmit={submitReason}
            className="bg-white rounded-xl p-4 mb-3 shadow-lg">
            <p className="text-xs font-bold text-[#062E63]">Why do you need this download?</p>
            <p className="text-[11px] text-[#2A2035]/55 mt-0.5 mb-2.5">
              Downloads of curriculum material are shared with the directors, along with your
              name and the reason you give.
            </p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
              placeholder="e.g. Printing for tomorrow's Year 9 lesson — the class copies ran out"
              className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099]" />
            {error && <p className="text-[11px] text-[#B91C1C] font-semibold mt-1.5">{error}</p>}
            <div className="flex items-center gap-2 mt-2.5">
              <button type="submit" disabled={sending}
                className="px-3.5 py-1.5 rounded-lg bg-[#325099] text-white text-xs font-semibold hover:bg-[#243c75] transition disabled:opacity-40">
                {sending ? 'Recording…' : 'Submit and download'}
              </button>
              <button type="button" onClick={() => setAsking(false)} disabled={sending}
                className="px-3.5 py-1.5 rounded-lg bg-[#F1F4FB] text-[#2A2035]/70 text-xs font-semibold hover:bg-[#E6EBF7] transition disabled:opacity-40">
                Cancel
              </button>
            </div>
          </form>
        )}

        <iframe src={url} title={filename || 'PDF preview'}
          className="flex-1 w-full rounded-xl bg-white border border-white/10 min-h-0" />
      </div>
    </div>
  )
}

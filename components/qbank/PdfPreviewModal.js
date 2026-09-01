'use client'
import { useEffect } from 'react'

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
 */
export default function PdfPreviewModal({ url, filename, title = 'Preview', downloadUrl, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!url) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0B1020]/70 backdrop-blur-sm"
      onClick={onClose}>
      <div className="flex-1 flex flex-col max-w-5xl w-full mx-auto px-4 py-6 min-h-0"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-sm font-bold text-white truncate flex-1">{title}</h2>
          <a href={downloadUrl || url} download={filename}
            className="px-3.5 py-1.5 rounded-lg bg-[#325099] text-white text-xs font-semibold hover:bg-[#243c75] transition">
            Download
          </a>
          <button onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-white/15 text-white text-xs font-semibold hover:bg-white/25 transition">
            Close
          </button>
        </div>
        <iframe src={url} title={filename || 'PDF preview'}
          className="flex-1 w-full rounded-xl bg-white border border-white/10 min-h-0" />
      </div>
    </div>
  )
}

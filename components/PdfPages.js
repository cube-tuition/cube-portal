'use client'
import { useEffect, useRef, useState } from 'react'
import { reportClientError } from '../lib/reportClientError'

/*
 * PdfPages — a PDF drawn page by page onto canvases, for phones.
 *
 * iOS shows a PDF inside an <iframe> as a single, unscrollable, unzoomable
 * first page, so on phones the preview renders the file itself (pdf.js):
 * every page fitted to the width, scrolling top to bottom, pinch to zoom,
 * double-tap to zoom in and out. Pages are drawn only as they come into
 * view, so a 40-page workbook doesn't fill the phone's memory up front.
 *
 * The worker lives at /public/pdf.worker.min.mjs (copied from pdfjs-dist;
 * keep the two versions in step when upgrading the package).
 */
const MAX_ZOOM = 4, MIN_ZOOM = 1
// Canvases are drawn sharper than 1:1 so a pinch stays crisp.
const OVERSAMPLE = 1.1

export default function PdfPages({ url, className = '' }) {
  const scrollRef = useRef(null)
  const sizerRef = useRef(null)
  const innerRef = useRef(null)
  const [status, setStatus] = useState({ pages: 0, error: '' })
  const zoomRef = useRef(1)
  const baseRef = useRef({ w: 0, h: 0 })

  // Size the scroll area to the zoomed content and scale the pages.
  const applyZoom = (z) => {
    zoomRef.current = z
    const { w, h } = baseRef.current
    if (sizerRef.current) { sizerRef.current.style.width = `${w * z}px`; sizerRef.current.style.height = `${h * z}px` }
    if (innerRef.current) innerRef.current.style.transform = `scale(${z})`
  }

  useEffect(() => {
    let dead = false, doc = null, observer = null
    const inner = innerRef.current, scroller = scrollRef.current
    if (!inner || !scroller) return
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        doc = await pdfjs.getDocument({ url }).promise
        if (dead) return
        const width = scroller.clientWidth - 16   // 8px either side
        const dpr = Math.min(3, (window.devicePixelRatio || 1) * OVERSAMPLE)
        inner.innerHTML = ''
        let totalH = 8
        const slots = []
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          if (dead) return
          const v1 = page.getViewport({ scale: 1 })
          const scale = width / v1.width
          const vp = page.getViewport({ scale })
          const slot = document.createElement('div')
          slot.style.cssText = `width:${vp.width}px;height:${vp.height}px;margin:0 auto 8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25)`
          slot.dataset.page = String(i)
          inner.appendChild(slot)
          slots.push({ slot, page, scale, vp, drawn: false })
          totalH += vp.height + 8
        }
        baseRef.current = { w: width + 16, h: totalH }
        applyZoom(1)
        setStatus({ pages: doc.numPages, error: '' })

        // Draw a page when it is within a screen of the viewport.
        const draw = async (s) => {
          if (s.drawn) return
          s.drawn = true
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(s.vp.width * dpr); canvas.height = Math.floor(s.vp.height * dpr)
          canvas.style.cssText = `width:${s.vp.width}px;height:${s.vp.height}px;display:block`
          s.slot.appendChild(canvas)
          try {
            const ctx = canvas.getContext('2d')
            if (!ctx) throw new Error(`PdfPages: no 2d context for page ${s.slot.dataset.page} (${canvas.width}×${canvas.height})`)
            await s.page.render({ canvasContext: ctx, viewport: s.page.getViewport({ scale: s.scale * dpr }) }).promise
          } catch (e) {
            if (dead) return   // a cancelled render on unmount
            s.slot.innerHTML = `<p style="padding:24px 12px;font-size:12px;color:#B23A3A;text-align:center">This page could not be drawn.</p>`
            reportClientError(new Error(`PdfPages page ${s.slot.dataset.page}: ${e?.message || e}`))
          }
        }
        observer = new IntersectionObserver((entries) => {
          for (const e of entries) if (e.isIntersecting) draw(slots[Number(e.target.dataset.page) - 1])
        }, { root: scroller, rootMargin: '100% 0px' })
        // The first pages are drawn straight away; the rest as they scroll near.
        slots.slice(0, 2).forEach(draw)
        slots.slice(2).forEach((s) => observer.observe(s.slot))
      } catch (e) {
        if (dead) return
        setStatus({ pages: 0, error: e?.message || 'Could not open this PDF.' })
        reportClientError(new Error(`PdfPages open: ${e?.message || e}`))
      }
    })()
    return () => { dead = true; observer?.disconnect(); doc?.destroy?.() }
  }, [url])

  // Pinch to zoom and double-tap to toggle, around the touch point.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let pinch = null, lastTap = 0
    const zoomAt = (z, cx, cy) => {
      const prev = zoomRef.current
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
      const r = scroller.getBoundingClientRect()
      // Keep the content under the fingers where it is.
      const px = scroller.scrollLeft + (cx - r.left), py = scroller.scrollTop + (cy - r.top)
      applyZoom(next)
      scroller.scrollLeft = px * (next / prev) - (cx - r.left)
      scroller.scrollTop = py * (next / prev) - (cy - r.top)
    }
    const onStart = (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: zoomRef.current }
      } else if (e.touches.length === 1) {
        const now = Date.now()
        if (now - lastTap < 300) {
          const t = e.touches[0]
          zoomAt(zoomRef.current > 1.2 ? 1 : 2.2, t.clientX, t.clientY)
          e.preventDefault()
        }
        lastTap = now
      }
    }
    const onMove = (e) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const [a, b] = e.touches
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      zoomAt(pinch.z * (d / pinch.d), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
    }
    const onEnd = () => { pinch = null }
    scroller.addEventListener('touchstart', onStart, { passive: false })
    scroller.addEventListener('touchmove', onMove, { passive: false })
    scroller.addEventListener('touchend', onEnd)
    scroller.addEventListener('touchcancel', onEnd)
    return () => {
      scroller.removeEventListener('touchstart', onStart); scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd); scroller.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  return (
    <div ref={scrollRef} className={`relative overflow-auto overscroll-contain bg-[#2A3245] ${className}`} style={{ touchAction: 'pan-x pan-y' }}>
      {!status.pages && !status.error && <p className="absolute inset-x-0 top-10 text-center text-xs text-white/70 animate-pulse">Opening…</p>}
      {status.error && <p className="absolute inset-x-0 top-10 text-center text-xs text-[#FCA5A5] px-6">{status.error}</p>}
      <div ref={sizerRef}>
        <div ref={innerRef} className="pt-2" style={{ transformOrigin: '0 0' }} />
      </div>
    </div>
  )
}

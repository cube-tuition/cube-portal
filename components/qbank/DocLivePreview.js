'use client'

import { useEffect, useRef, useState } from 'react'

/*
 * DocLivePreview — mounts an exam/worksheet preview (real A4 pages built by the
 * shared exporter) into a scaled, scrollable panel and re-renders, debounced,
 * whenever `signature` changes. `render(container)` does the actual drawing.
 *
 * IMPORTANT: the exporter overwrites the container element's own `style` (it sets
 * display:flex on it), so the scale must live on a PARENT wrapper, with a
 * separate child handed to render() as the drawing container.
 */
export default function DocLivePreview({ render, signature, scale = 0.6 }) {
  const innerRef = useRef(null)
  const renderRef = useRef(render)
  useEffect(() => { renderRef.current = render })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      if (!innerRef.current) return
      setBusy(true)
      try { await renderRef.current(innerRef.current) } catch { /* shown inside container */ }
      if (!cancelled) setBusy(false)
    }, 450)
    return () => { cancelled = true; clearTimeout(t) }
  }, [signature])

  return (
    <div className="relative">
      {busy && <div className="absolute top-2 right-2 z-10 text-[10px] font-semibold text-[#325099] bg-white/90 border border-[#DEE7FF] rounded-full px-2 py-0.5">updating…</div>}
      {/* Box width = the scaled A4 page width, so the whole page fits exactly and
          Paper/Solutions are the same size. `zoom` (string, or React breaks it)
          lives on the wrapper, NOT the exporter-owned container. */}
      <div className="overflow-y-auto overflow-x-hidden bg-[#E9EDF6] rounded-xl p-3" style={{ maxHeight: 'calc(100vh - 120px)', width: Math.ceil(794 * scale) + 26 }}>
        <div style={{ zoom: String(scale) }}>
          <div ref={innerRef} />
        </div>
      </div>
    </div>
  )
}

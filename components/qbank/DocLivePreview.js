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
 *
 * `scrollRef` hands the caller the scrolling panel, which is what a jump-to-here
 * feature has to scroll — the page elements inside are not scrollable
 * themselves. `onDoubleClick` fires on that panel.
 *
 * KEEPING THE PLACE: a re-render empties the container before rebuilding it, and
 * for that moment the panel has nothing to scroll, so the browser snapped it
 * back to the top — every edit to a question lost your place in the preview.
 * The panel's content height is held while the pages are rebuilt, and the
 * scroll position is put back once they are in.
 */
export default function DocLivePreview({ render, signature, scale = 0.6, scrollRef, onDoubleClick }) {
  const innerRef = useRef(null)
  const holdRef = useRef(null)       // unscaled box around the pages — its height is held during a re-render
  const renderRef = useRef(render)
  useEffect(() => { renderRef.current = render })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      if (!innerRef.current) return
      setBusy(true)
      const hold = holdRef.current
      // The scrolling panel is the hold box's parent — its ref belongs to the
      // caller (jump-to-question), so it is reached from here, not re-wired.
      const scroller = hold?.parentElement
      const top = scroller ? scroller.scrollTop : 0
      if (hold) hold.style.minHeight = `${hold.getBoundingClientRect().height}px`
      try { await renderRef.current(innerRef.current) } catch { /* shown inside container */ }
      if (scroller) scroller.scrollTop = top
      if (hold) hold.style.minHeight = ''
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
      <div ref={scrollRef} onDoubleClick={onDoubleClick}
        className="overflow-y-auto overflow-x-hidden bg-[#E9EDF6] rounded-xl p-3" style={{ maxHeight: 'calc(100vh - 120px)', width: Math.ceil(794 * scale) + 26 }}>
        <div ref={holdRef}>
          <div style={{ zoom: String(scale) }}>
            <div ref={innerRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

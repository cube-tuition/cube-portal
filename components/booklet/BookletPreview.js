'use client'

import { useEffect, useState, useRef } from 'react'
import { coverHtml, levelTestCoverHtml, testTotalMarks, footerHtml, BOOKLET_CSS, WATERMARK_SVG, bookletRenderItems } from '../../lib/bookletRender'
import { splitToFit } from '../../lib/paginate'

// Right-hand footer label for a doc. Level tests read "Year N Level test".
// Footer right-hand label. The subject name is spelled out from the stored
// subject (e.g. "Maths"/"Adv Maths" → "Mathematics", "English", "Chemistry")
// so an English booklet reads "English Booklet", not "Mathematics Booklet".
function subjectLabel(s) {
  const v = String(s || '').trim()
  if (!v) return 'Mathematics'
  if (/english/i.test(v)) return 'English'
  if (/chem/i.test(v)) return 'Chemistry'
  if (/phys/i.test(v)) return 'Physics'
  if (/math/i.test(v)) return 'Mathematics'
  return v
}
function footerLabelFor(meta, { homework, quiz } = {}) {
  if (meta?.docType === 'pre_test') return `${meta.year ? `Year ${meta.year} ` : ''}Pre-test`
  if (meta?.docType === 'level_test') return `${meta.year ? `Year ${meta.year} ` : ''}Level test`
  const subject = subjectLabel(meta?.subject)
  if (quiz) return `${subject} Revision Quiz`
  if (homework) return `${subject} Homework`
  return `${subject} Booklet`
}

/*
 * BookletPreview — live, on-screen render of a booklet using the SAME renderer
 * the PDF export uses, so the preview matches the printed result. Shows the
 * cover then the content (with watermark + footer). `solutions` toggles the
 * student (writing lines) vs solutions (filled boxes) appearance.
 *
 * Content is paginated into A4 pages using the EXACT same break logic as the
 * PDF export (lib/bookletExport): blocks are appended to a page until it would
 * overflow A4 height, at which point the overflowing block moves to a new page.
 * This keeps every preview page within A4 dimensions instead of one tall page.
 *
 * Props: meta { subject, year, topic }, blocks [], solutions bool, scale number
 */
const PAGE_H = 1123  // A4 height @ 96dpi, matches lib/bookletExport

const PAGE_W = 794   // A4 width @ 96dpi

export default function BookletPreview({ meta = {}, blocks = [], solutions = false, scale: maxScale = 0.72 }) {
  const cover = (meta.docType === 'level_test' || meta.docType === 'pre_test')
    ? levelTestCoverHtml(meta, { solutions, totalMarks: testTotalMarks(blocks) })
    : coverHtml(meta, { solutions })

  // Paginated content: array of HTML strings, one per A4 content page.
  const [pages, setPages] = useState([])

  // Scale the A4 page down to fit the available column width so the preview
  // never needs horizontal scrolling (capped at maxScale).
  const rootRef = useRef(null)
  const [fit, setFit] = useState(maxScale)
  useEffect(() => {
    const parent = rootRef.current?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(parent)
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
      const avail = parent.clientWidth - pad
      if (avail <= 0) return
      const next = Math.min(maxScale, avail / PAGE_W)
      // Dead-band: ignore changes smaller than a classic scrollbar's width
      // (~15px -> ~0.02 of scale). A scale that chases every pixel can lock
      // into an infinite grow/shrink cycle with the scrollbar it causes.
      setFit(prev => (Math.abs(next - prev) < 0.025 ? prev : next))
    })
    ro.observe(parent)
    return () => ro.disconnect()
  }, [maxScale])
  const scale = fit

  useEffect(() => {
    // No debounce: repaginate on the next frame, so the preview tracks typing.
    // A full pass into the hidden stage measures ~12-15ms on a 76-block booklet
    // — it is off-screen and never painted — and since the block editors are
    // memoised, a keystroke now re-renders one editor rather than all of them.
    // That headroom is what makes running this per keystroke affordable; any
    // delay here is latency the preview would pay for no reason. Scheduling on
    // a frame also coalesces bursts and lets layout settle before heights are
    // read.
    const raf = requestAnimationFrame(() => measureAndPaginate())
    return () => cancelAnimationFrame(raf)

    function measureAndPaginate() {
    // Ordered render items (content then homework) — same source the exporter
    // uses, so the preview can never drift from the printed PDF.
    const items = bookletRenderItems(blocks, { solutions, meta })
    if (items.length === 0) { setPages([]); return }

    // Measure & paginate in a hidden off-screen stage so heights (incl. margin
    // collapsing) match the real layout.
    const stage = document.createElement('div')
    stage.className = 'bk-root'
    stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1;visibility:hidden'
    const style = document.createElement('style')
    style.textContent = BOOKLET_CSS
    stage.appendChild(style)
    document.body.appendChild(stage)

    const newPage = () => {
      const page = document.createElement('article')
      page.className = 'bk-page'
      const inner = document.createElement('div')
      inner.className = 'bk-content'
      page.appendChild(inner)
      stage.appendChild(page)
      return { page, inner, html: [], homework: false, quiz: false }
    }

    const result = []
    let cur = newPage(); result.push(cur)
    let countOnPage = 0
    // Place a multi-part question one chunk at a time — one part in a single-column
    // question, one run of parts in a two-column one. Start a new page before any
    // chunk marked "start on a new page" (data-break), and on overflow.
    const placeChunks = (it) => {
      for (const ch of it.chunks) {
        const t2 = document.createElement('div')
        t2.innerHTML = ch
        const cel = t2.firstElementChild
        if (!cel) continue
        if (cel.getAttribute('data-break') === '1' && countOnPage > 0) {
          cur = newPage(); result.push(cur); countOnPage = 0
        }
        cur.inner.appendChild(cel)
        if (cur.page.scrollHeight > PAGE_H && countOnPage > 0) {
          cur.inner.removeChild(cel)
          cur = newPage(); result.push(cur)
          cur.inner.appendChild(cel)
          countOnPage = 0
        }
        if (it.homework) cur.homework = true
        if (it.quiz) cur.quiz = true
        // A single chunk can still be taller than a whole page — one part whose
        // solution carries a diagram, say. Chunking is already the finest split
        // a question has, so there is nothing smaller to fall back to: split the
        // chunk itself, exactly as the main loop does for any other oversized
        // block. Without this the chunk stayed put and its tail was clipped off
        // the bottom of the fixed-height page — the solution simply vanished.
        if (cur.page.scrollHeight > PAGE_H) {
          const fits = () => cur.page.scrollHeight <= PAGE_H
          let rest = splitToFit(cel, fits)
          cur.html.push(cel.outerHTML)   // record AFTER trimming
          countOnPage++
          let guard = 0
          while (rest && guard++ < 200) {
            cur = newPage(); result.push(cur); countOnPage = 0
            cur.inner.appendChild(rest)
            const more = splitToFit(rest, fits)
            if (it.homework) cur.homework = true
            if (it.quiz) cur.quiz = true
            cur.html.push(rest.outerHTML)
            countOnPage++
            if (more === rest) break
            rest = more
          }
          continue
        }
        cur.html.push(ch)
        countOnPage++
      }
    }
    for (const it of items) {
      const tmp = document.createElement('div')
      tmp.innerHTML = it.html
      const el = tmp.firstElementChild
      if (!el) continue
      if (it.pageBreakBefore && countOnPage > 0) {
        cur = newPage(); result.push(cur); countOnPage = 0
      }
      // A question that asks to break before one of its parts is always split
      // into chunks (not only when it overflows).
      if (it.forceChunks && it.chunks) { placeChunks(it); continue }
      cur.inner.appendChild(el)
      if (cur.page.scrollHeight > PAGE_H && countOnPage > 0) {
        cur.inner.removeChild(el)
        cur = newPage(); result.push(cur)
        cur.inner.appendChild(el)
        countOnPage = 0
      }
      // Even alone the item is taller than a page. A multi-part question falls
      // back to per-part chunks; anything else (writing lines, a long table, a
      // big callout) is split by splitToFit, so the page stays exactly A4
      // rather than stretching and printing as a sliced, footer-clipped PDF.
      if (cur.page.scrollHeight > PAGE_H) {
        if (it.chunks) {
          cur.inner.removeChild(el)
          placeChunks(it)
          continue
        }
        const fits = () => cur.page.scrollHeight <= PAGE_H
        let rest = splitToFit(el, fits)
        // Record AFTER trimming — el has just had its overflow moved out.
        if (it.homework) cur.homework = true
        if (it.quiz) cur.quiz = true
        cur.html.push(el.outerHTML)
        countOnPage++
        let guard = 0
        while (rest && guard++ < 200) {
          cur = newPage(); result.push(cur); countOnPage = 0
          cur.inner.appendChild(rest)
          const more = splitToFit(rest, fits)
          if (it.homework) cur.homework = true
          if (it.quiz) cur.quiz = true
          cur.html.push(rest.outerHTML)
          countOnPage++
          if (more === rest) break
          rest = more
        }
        continue
      }
      if (it.homework) cur.homework = true
      if (it.quiz) cur.quiz = true
      cur.html.push(it.html)
      countOnPage++
    }

    document.body.removeChild(stage)
    setPages(result.map(r => ({ html: r.html.join(''), homework: r.homework, quiz: r.quiz })))
    }
  }, [blocks, solutions, meta])

  const pageStyle = { marginTop: 24, boxShadow: '0 1px 6px rgba(0,0,0,.12)' }

  return (
    <div ref={rootRef} className="bk-root" style={{ width: PAGE_W * scale }}>
      <style>{BOOKLET_CSS}</style>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: PAGE_W }}>
        {/* Cover */}
        <div className="bk-page" style={{ padding: 0, boxShadow: '0 1px 6px rgba(0,0,0,.12)' }}>
          <div dangerouslySetInnerHTML={{ __html: cover }} />
        </div>

        {/* Content pages */}
        {blocks.length === 0 ? (
          <div className="bk-page" style={pageStyle}>
            <div className="bk-watermark" dangerouslySetInnerHTML={{ __html: WATERMARK_SVG }} />
            <div className="bk-content">
              <p style={{ color: '#9aa3b2', fontSize: 15, textAlign: 'center', marginTop: 80 }}>Add blocks to see your booklet here.</p>
            </div>
            <div dangerouslySetInnerHTML={{ __html: footerHtml(2, footerLabelFor(meta)) }} />
          </div>
        ) : (
          pages.map((pg, i) => (
            <div key={i} className="bk-page" style={pageStyle}>
              <div className="bk-watermark" dangerouslySetInnerHTML={{ __html: WATERMARK_SVG }} />
              <div className="bk-content" dangerouslySetInnerHTML={{ __html: pg.html }} />
              <div dangerouslySetInnerHTML={{ __html: footerHtml(i + 2, footerLabelFor(meta, { quiz: pg.quiz, homework: pg.homework })) }} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

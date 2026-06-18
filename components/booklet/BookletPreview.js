'use client'

import { useEffect, useState } from 'react'
import { coverHtml, footerHtml, BOOKLET_CSS, WATERMARK_SVG, bookletRenderItems } from '../../lib/bookletRender'

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

export default function BookletPreview({ meta = {}, blocks = [], solutions = false, scale = 0.72 }) {
  const cover = coverHtml(meta, { solutions })

  // Paginated content: array of HTML strings, one per A4 content page.
  const [pages, setPages] = useState([])

  useEffect(() => {
    // Measure on the next frame so this isn't a synchronous setState in the
    // effect body and so fonts/layout have settled before we measure heights.
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
    for (const it of items) {
      const tmp = document.createElement('div')
      tmp.innerHTML = it.html
      const el = tmp.firstElementChild
      if (!el) continue
      if (it.pageBreakBefore && countOnPage > 0) {
        cur = newPage(); result.push(cur); countOnPage = 0
      }
      cur.inner.appendChild(el)
      if (cur.page.scrollHeight > PAGE_H && countOnPage > 0) {
        cur.inner.removeChild(el)
        cur = newPage(); result.push(cur)
        cur.inner.appendChild(el)
        countOnPage = 0
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
    <div className="bk-root" style={{ width: 794 * scale }}>
      <style>{BOOKLET_CSS}</style>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: 794 }}>
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
            <div dangerouslySetInnerHTML={{ __html: footerHtml(2) }} />
          </div>
        ) : (
          pages.map((pg, i) => (
            <div key={i} className="bk-page" style={pageStyle}>
              <div className="bk-watermark" dangerouslySetInnerHTML={{ __html: WATERMARK_SVG }} />
              <div className="bk-content" dangerouslySetInnerHTML={{ __html: pg.html }} />
              <div dangerouslySetInnerHTML={{ __html: footerHtml(i + 2, pg.quiz ? 'Mathematics Revision Quiz' : pg.homework ? 'Mathematics Homework' : 'Mathematics Booklet') }} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

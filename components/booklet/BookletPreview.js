'use client'

import { coverHtml, blocksToHtml, footerHtml, BOOKLET_CSS, WATERMARK_SVG } from '../../lib/bookletRender'

/*
 * BookletPreview — live, on-screen render of a booklet using the SAME renderer
 * the PDF export uses, so the preview matches the printed result. Shows the
 * cover then the content (with watermark + footer). `solutions` toggles the
 * student (writing lines) vs solutions (filled boxes) appearance.
 *
 * Props: meta { subject, year, topic }, blocks [], solutions bool, scale number
 */
export default function BookletPreview({ meta = {}, blocks = [], solutions = false, scale = 0.72 }) {
  const cover = coverHtml(meta, { solutions })
  const content = blocksToHtml(blocks, { solutions })

  return (
    <div className="bk-root" style={{ width: 794 * scale }}>
      <style>{BOOKLET_CSS}</style>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: 794 }}>
        {/* Cover */}
        <div className="bk-page" style={{ padding: 0, boxShadow: '0 1px 6px rgba(0,0,0,.12)' }}>
          <div dangerouslySetInnerHTML={{ __html: cover }} />
        </div>
        {/* Content */}
        <div className="bk-page" style={{ marginTop: 24, boxShadow: '0 1px 6px rgba(0,0,0,.12)' }}>
          <div className="bk-watermark" dangerouslySetInnerHTML={{ __html: WATERMARK_SVG }} />
          <div className="bk-content">
            {blocks.length === 0
              ? <p style={{ color: '#9aa3b2', fontSize: 15, textAlign: 'center', marginTop: 80 }}>Add blocks to see your booklet here.</p>
              : <div dangerouslySetInnerHTML={{ __html: content }} />}
          </div>
          <div dangerouslySetInnerHTML={{ __html: footerHtml(2) }} />
        </div>
      </div>
    </div>
  )
}

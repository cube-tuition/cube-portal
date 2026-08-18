/**
 * Booklet PDF export. Reuses the same renderer (lib/bookletRender) as the live
 * preview, then paginates and rasterises to A4 with the project's proven
 * full-width + slice technique (so nothing is squished and tall blocks flow on).
 *
 *   exportBookletPdf({ meta, blocks, solutions, preview })
 *     solutions=false → Student copy (blank writing lines)
 *     solutions=true  → Solutions copy (filled sample-solution boxes)
 *     preview=true     → returns { url, filename } (blob URL) instead of saving
 */
import { coverHtml, levelTestCoverHtml, testTotalMarks, BOOKLET_CSS, WATERMARK_SVG, footerHtml, bookletRenderItems } from './bookletRender'
import { splitToFit } from './paginate'
import { nodeToJpeg } from './rasterise'

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
  if (meta.docType === 'pre_test') return `${meta.year ? `Year ${meta.year} ` : ''}Pre-test`
  if (meta.docType === 'level_test') return `${meta.year ? `Year ${meta.year} ` : ''}Level test`
  const subject = subjectLabel(meta?.subject)
  if (quiz) return `${subject} Revision Quiz`
  if (homework) return `${subject} Homework`
  return `${subject} Booklet`
}

const PAGE_W = 794
const PAGE_H = 1123
const PAD = 56

async function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map(async (img) => {
    try {
      const res = await fetch(img.src, { mode: 'cors', cache: 'no-cache' })
      if (!res.ok) throw new Error('bad')
      const blob = await res.blob()
      img.src = await new Promise((resolve, reject) => {
        const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob)
      })
      img.removeAttribute('crossorigin')
    } catch { img.remove() }
  }))
}

function newContentPage(stage) {
  const page = document.createElement('article')
  page.className = 'bk-page'
  const wm = document.createElement('div')
  wm.className = 'bk-watermark'
  wm.innerHTML = WATERMARK_SVG
  const inner = document.createElement('div')
  inner.className = 'bk-content'
  page.appendChild(wm); page.appendChild(inner)
  stage.appendChild(page)
  return { page, inner }
}

// onProgress(fraction, label) is called as the export moves through its stages.
// Rasterising the pages is by far the slowest part, so that loop reports per
// page — a long booklet would otherwise sit on one number for many seconds.
//
// fontEmbedCSS: html-to-image re-derives the embedded web-font CSS on EVERY
// toJpeg() call (~40% of raster time), so this export derives it ONCE from the
// fully built stage and reuses it for every page — and returns it, so publish
// can hand it to the second copy's export too. It must be derived from the
// REAL stage: the library keeps only @font-face rules whose families are used
// inside the node it is given, so a synthetic probe with no KaTeX spans or
// cover text reports no web fonts at all, and the PDF silently falls back to
// system fonts (that bug shipped once — maths glyphs changed font in print).
export async function exportBookletPdf({ meta = {}, blocks = [], solutions = false, preview = false, onProgress, fontEmbedCSS }) {
  const report = (f, label) => { try { onProgress?.(f, label) } catch { /* never let a UI callback break the export */ } }
  const htmlToImage = await import('html-to-image')
  const { jsPDF } = await import('jspdf')

  const stage = document.createElement('div')
  stage.className = 'bk-root'
  stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1'
  const style = document.createElement('style')
  style.textContent = BOOKLET_CSS
  stage.appendChild(style)
  document.body.appendChild(stage)

  const pages = []

  // Page 1 — cover (full bleed). Level tests use the exam-style cover.
  const cover = document.createElement('article')
  cover.className = 'bk-page'
  cover.style.padding = '0'
  cover.innerHTML = (meta.docType === 'level_test' || meta.docType === 'pre_test')
    ? levelTestCoverHtml(meta, { solutions, totalMarks: testTotalMarks(blocks) })
    : coverHtml(meta, { solutions })
  stage.appendChild(cover); pages.push(cover)

  // Content + homework pages — paginate the ordered render items, moving an
  // overflowing item to a new page. Items carry pageBreakBefore (forces the
  // homework section onto a fresh page) and a homework flag (drives the footer).
  const items = bookletRenderItems(blocks, { solutions, meta })
  let cur = newContentPage(stage); pages.push(cur.page)
  let countOnPage = 0
  let hwStartPage = -1
  let quizStartPage = -1
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
        cur = newContentPage(stage); pages.push(cur.page); countOnPage = 0
      }
      cur.inner.appendChild(cel)
      if (cur.page.scrollHeight > PAGE_H && countOnPage > 0) {
        cur.inner.removeChild(cel)
        cur = newContentPage(stage); pages.push(cur.page)
        cur.inner.appendChild(cel)
        countOnPage = 0
      }
      if (it.homework && hwStartPage < 0) hwStartPage = pages.length - 1
      if (it.quiz && quizStartPage < 0) quizStartPage = pages.length - 1
      countOnPage++
    }
  }
  // Build every item's element up front, at the real content width, and wait
  // for its images BEFORE paginating. Pagination decides page breaks from
  // scrollHeight, and an <img> (the SVG diagrams are data-URI images) reports
  // height 0 until it has decoded — so image-heavy pages used to measure short,
  // pack too much, and silently clip at the bottom of the printed page once the
  // images arrived. Preloading in a same-width pool makes every height real by
  // the time the loop measures anything.
  const pool = document.createElement('div')
  pool.style.cssText = `width:${PAGE_W - 96}px`   // .bk-page inner width (794 − 2×48 padding)
  stage.appendChild(pool)
  const prepared = items.map(it => {
    const tmp = document.createElement('div')
    tmp.innerHTML = it.html
    const el = tmp.firstElementChild
    if (el) pool.appendChild(el)
    return { it, el }
  })
  await waitForImages(pool)

  for (const { it, el } of prepared) {
    if (!el) continue
    if (it.pageBreakBefore && countOnPage > 0) {
      cur = newContentPage(stage); pages.push(cur.page); countOnPage = 0
    }
    // A question that asks to break before one of its parts is always split
    // into chunks (not only when it overflows).
    if (it.forceChunks && it.chunks) { placeChunks(it); continue }
    cur.inner.appendChild(el)
    if (cur.page.scrollHeight > PAGE_H && countOnPage > 0) {
      cur.inner.removeChild(el)
      cur = newContentPage(stage); pages.push(cur.page)
      cur.inner.appendChild(el)
      countOnPage = 0
    }
    // Even alone the item is taller than a page. A multi-part question falls
    // back to per-part chunks; anything else (writing lines, a long table, a big
    // callout) is split by splitToFit so every page stays exactly A4.
    if (cur.page.scrollHeight > PAGE_H) {
      if (it.chunks) {
        cur.inner.removeChild(el)
        placeChunks(it)
        continue
      }
      const fits = () => cur.page.scrollHeight <= PAGE_H
      let rest = splitToFit(el, fits)
      if (it.homework && hwStartPage < 0) hwStartPage = pages.length - 1
      if (it.quiz && quizStartPage < 0) quizStartPage = pages.length - 1
      countOnPage++
      let guard = 0
      while (rest && guard++ < 200) {
        cur = newContentPage(stage); pages.push(cur.page); countOnPage = 0
        cur.inner.appendChild(rest)
        const more = splitToFit(rest, fits)
        if (it.homework && hwStartPage < 0) hwStartPage = pages.length - 1
        if (it.quiz && quizStartPage < 0) quizStartPage = pages.length - 1
        countOnPage++
        if (more === rest) break
        rest = more
      }
      continue
    }
    if (it.homework && hwStartPage < 0) hwStartPage = pages.length - 1
    if (it.quiz && quizStartPage < 0) quizStartPage = pages.length - 1
    countOnPage++
  }

  // Footers (page numbers start at 1 on the cover). Homework / revision-quiz
  // pages get their own right-hand label instead of "Mathematics Booklet".
  pages.forEach((p, i) => {
    if (i === 0) return // cover has no footer
    const label = footerLabelFor(meta, {
      quiz: quizStartPage >= 0 && i >= quizStartPage,
      homework: hwStartPage >= 0 && i >= hwStartPage,
    })
    const f = document.createElement('div')
    f.innerHTML = footerHtml(i + 1, label)
    p.appendChild(f.firstChild)
  })

  report(0.08, 'Laying out pages')
  await waitForImages(stage)
  // Reuse the caller's font CSS when it has one (publish's second copy), else
  // derive it once from the whole stage — cover + every page, so the usage
  // scan sees KaTeX and the cover font. An empty result means the derivation
  // failed; fall back to per-page embedding (slow but correct) by passing
  // undefined rather than '' — '' would tell toJpeg to embed nothing.
  const fontCSS = (fontEmbedCSS || await htmlToImage.getFontEmbedCSS(stage)) || undefined
  report(0.15, `Rendering ${pages.length} pages`)

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()

  // Every page is captured at exactly A4. Pages are already A4 by construction
  // (fixed height in .bk-page + splitToFit above), so there is no over-tall page
  // to slice across several PDF pages — that slicing is what used to cut the
  // footer in half and break a line of text across the join.
  for (let i = 0; i < pages.length; i++) {
    const dataUrl = await nodeToJpeg(pages[i], { quality: 0.9, width: PAGE_W, height: PAGE_H, backgroundColor: '#ffffff', pixelRatio: 2, fontEmbedCSS: fontCSS })
    if (i > 0) pdf.addPage()
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfW, pdfH)
    // 0.15 → 0.98 across the page loop, so the bar moves on every page.
    report(0.15 + 0.83 * ((i + 1) / pages.length), `Rendering page ${i + 1} of ${pages.length}`)
  }

  document.body.removeChild(stage)
  report(1, 'Done')

  const safe = (meta.topic || meta.subject || 'booklet').replace(/[^\w-]+/g, '_')
  const filename = `${meta.year ? 'Y' + meta.year + '_' : ''}${safe}${solutions ? '_Solutions' : '_Student'}.pdf`
  const blob = pdf.output('blob')
  if (preview) return { url: URL.createObjectURL(blob), blob, filename, fontEmbedCSS: fontCSS }
  pdf.save(filename)
  return { blob, filename, fontEmbedCSS: fontCSS }
}

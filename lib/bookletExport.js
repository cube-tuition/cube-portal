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

// Right-hand footer label for a doc. Level tests read "Year N Level test".
function footerLabelFor(meta, { homework, quiz } = {}) {
  if (meta.docType === 'pre_test') return `${meta.year ? `Year ${meta.year} ` : ''}Pre-test`
  if (meta.docType === 'level_test') return `${meta.year ? `Year ${meta.year} ` : ''}Level test`
  if (quiz) return 'Mathematics Revision Quiz'
  if (homework) return 'Mathematics Homework'
  return 'Mathematics Booklet'
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

export async function exportBookletPdf({ meta = {}, blocks = [], solutions = false, preview = false }) {
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
  for (const it of items) {
    // Append the item's REAL root element (a .bk-block) directly, so blocks are
    // direct siblings exactly like the live preview — otherwise an extra wrapper
    // div changes margin collapsing and the gaps print smaller than the preview.
    const tmp = document.createElement('div')
    tmp.innerHTML = it.html
    const el = tmp.firstElementChild
    if (!el) continue
    if (it.pageBreakBefore && countOnPage > 0) {
      cur = newContentPage(stage); pages.push(cur.page); countOnPage = 0
    }
    cur.inner.appendChild(el)
    if (cur.page.scrollHeight > PAGE_H && countOnPage > 0) {
      cur.inner.removeChild(el)
      cur = newContentPage(stage); pages.push(cur.page)
      cur.inner.appendChild(el)
      countOnPage = 0
    }
    // Even alone the item is taller than a page: a multi-part question falls
    // back to per-part chunks so it breaks between parts instead of stretching
    // (and then slicing) the page.
    if (cur.page.scrollHeight > PAGE_H && it.chunks) {
      cur.inner.removeChild(el)
      for (const ch of it.chunks) {
        const t2 = document.createElement('div')
        t2.innerHTML = ch
        const cel = t2.firstElementChild
        if (!cel) continue
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

  await waitForImages(stage)

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()

  for (let i = 0; i < pages.length; i++) {
    const capH = Math.max(PAGE_H, pages[i].scrollHeight)
    const dataUrl = await htmlToImage.toJpeg(pages[i], { quality: 0.9, width: PAGE_W, height: capH, backgroundColor: '#ffffff', pixelRatio: 2 })
    if (i > 0) pdf.addPage()
    const fullH = pdfW * (capH / PAGE_W)
    if (fullH <= pdfH + 0.5) {
      pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfW, fullH)
    } else {
      let y = 0, first = true
      while (y < fullH - 0.5) {
        if (!first) pdf.addPage()
        pdf.addImage(dataUrl, 'JPEG', 0, -y, pdfW, fullH)
        y += pdfH; first = false
      }
    }
  }

  document.body.removeChild(stage)

  const safe = (meta.topic || meta.subject || 'booklet').replace(/[^\w-]+/g, '_')
  const filename = `${meta.year ? 'Y' + meta.year + '_' : ''}${safe}${solutions ? '_Solutions' : '_Student'}.pdf`
  const blob = pdf.output('blob')
  if (preview) return { url: URL.createObjectURL(blob), blob, filename }
  pdf.save(filename)
  return { blob, filename }
}

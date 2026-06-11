import { latexToHtml } from '../components/qbank/LatexContent'
import { qbankImageUrl } from './qbank'

/*
 * Worksheet / answer-key PDF export.
 *
 * Builds an off-screen column of A4 pages (matching the term-report PDF
 * approach used elsewhere in the portal: html-to-image.toJpeg → jsPDF), so
 * KaTeX-rendered maths and images come out crisp. Questions are packed onto
 * pages by measured height so a question is never split across a page break.
 *
 *   exportWorksheet({ title, subtitle, questions, includeMarks, answers })
 *     answers=false → worksheet (blank working space)
 *     answers=true  → answer key (worked solutions shown)
 */

// A4 @ 96dpi
const PAGE_W = 794
const PAGE_H = 1123
const PAD = 48

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function imagesHtml(images) {
  if (!images?.length) return ''
  const imgs = images.map((im) => {
    const url = qbankImageUrl(im.storage_path)
    return `<img src="${url}" crossorigin="anonymous" alt="${esc(im.alt)}"
      style="max-width:280px;max-height:200px;object-fit:contain;margin:6px 12px 6px 0;border:1px solid #eef2ff;border-radius:6px;background:#fff" />`
  }).join('')
  return `<div style="display:flex;flex-wrap:wrap;align-items:flex-start;margin:6px 0">${imgs}</div>`
}

function questionBlock(q, index, { includeMarks, answers }) {
  const num = index + 1
  const marks = (includeMarks && q.marks != null)
    ? `<span style="float:right;color:#64748b;font-size:13px">[${q.marks} mark${q.marks === 1 ? '' : 's'}]</span>`
    : ''

  let body = `<div style="font-size:15px;line-height:1.5;color:#1f2937">${latexToHtml(q.stem_latex || '')}</div>`
  body += imagesHtml(q.qbank_question_images)

  const parts = (q.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  if (parts.length) {
    body += '<div style="margin-top:8px">'
    parts.forEach((p, i) => {
      const lbl = p.part_label || 'abcdefgh'[i] || String(i + 1)
      const pm = (includeMarks && p.marks != null)
        ? `<span style="float:right;color:#64748b;font-size:13px">[${p.marks}]</span>` : ''
      body += `<div style="margin:6px 0 6px 6px;font-size:15px;line-height:1.5;color:#1f2937">
        ${pm}<span style="font-weight:700;margin-right:6px">${esc(lbl)})</span>${latexToHtml(p.prompt_latex || '')}</div>`
      if (answers && p.solution_latex?.trim()) {
        body += `<div style="margin:2px 0 8px 22px;padding:6px 10px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px;font-size:14px;color:#166534">${latexToHtml(p.solution_latex)}</div>`
      } else if (!answers) {
        body += '<div style="height:46px"></div>'
      }
    })
    body += '</div>'
  } else if (answers && q.solution_latex?.trim()) {
    body += `<div style="margin-top:8px;padding:8px 12px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px;font-size:14px;color:#166534"><span style="font-weight:700">Solution. </span>${latexToHtml(q.solution_latex)}</div>`
  } else if (!answers) {
    body += '<div style="height:70px"></div>'
  }

  const el = document.createElement('div')
  el.style.cssText = 'margin-bottom:18px;break-inside:avoid'
  el.innerHTML = `<div style="font-weight:700;font-size:15px;color:#062E63;margin-bottom:4px">${marks}Q${num}.</div>${body}`
  return el
}

function newPage() {
  const page = document.createElement('article')
  page.className = 'qbank-ws-page'
  page.style.cssText = `width:${PAGE_W}px;min-height:${PAGE_H}px;box-sizing:border-box;padding:${PAD}px;background:#fff;font-family:Inter,system-ui,-apple-system,sans-serif;color:#1f2937`
  const inner = document.createElement('div')
  page.appendChild(inner)
  return { page, inner }
}

function headerHtml(title, subtitle, answers) {
  return `<div style="border-bottom:2px solid #325099;padding-bottom:10px;margin-bottom:18px">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div style="font-size:22px;font-weight:800;color:#062E63">${esc(title) || 'Worksheet'}</div>
      <div style="font-size:12px;font-weight:700;color:#325099;letter-spacing:.04em">CUBE TUITION${answers ? ' · ANSWER KEY' : ''}</div>
    </div>
    ${subtitle ? `<div style="font-size:13px;color:#64748b;margin-top:3px">${esc(subtitle)}</div>` : ''}
    ${!answers ? '<div style="font-size:13px;color:#64748b;margin-top:6px">Name: ______________________________&nbsp;&nbsp;&nbsp;Date: ______________</div>' : ''}
  </div>`
}

async function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map((img) => (img.complete && img.naturalWidth)
    ? Promise.resolve()
    : new Promise((res) => { img.onload = res; img.onerror = res })))
}

export async function exportWorksheet({ title, subtitle, questions, includeMarks = true, answers = false }) {
  const htmlToImage = await import('html-to-image')
  const { jsPDF } = await import('jspdf')

  // Off-screen staging area
  const stage = document.createElement('div')
  stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1'
  document.body.appendChild(stage)

  const pages = []
  let { page, inner } = newPage()
  inner.innerHTML = headerHtml(title, subtitle, answers)
  stage.appendChild(page)
  pages.push(page)
  let blocksOnPage = 0

  for (let i = 0; i < questions.length; i++) {
    const block = questionBlock(questions[i], i, { includeMarks, answers })
    inner.appendChild(block)
    if (page.scrollHeight > PAGE_H && blocksOnPage > 0) {
      inner.removeChild(block)
      ;({ page, inner } = newPage())
      stage.appendChild(page)
      pages.push(page)
      inner.appendChild(block)
      blocksOnPage = 0
    }
    blocksOnPage++
  }

  await waitForImages(stage)

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()

  for (let i = 0; i < pages.length; i++) {
    const dataUrl = await htmlToImage.toJpeg(pages[i], {
      quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: false,
      width: PAGE_W, height: Math.max(PAGE_H, pages[i].scrollHeight),
    })
    if (i > 0) pdf.addPage()
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfW, pdfH)
  }

  document.body.removeChild(stage)

  const safe = (title || 'worksheet').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')
  pdf.save(`${safe || 'worksheet'}${answers ? '-answers' : ''}.pdf`)
}

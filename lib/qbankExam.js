import { latexToHtml } from '../components/qbank/LatexContent'
import { qbankImageUrl } from './qbank'

/*
 * Exam paper + solutions PDF export — replicates CUBE Tuition's EXS (exam paper)
 * and EXT (solutions) Word templates.
 *
 *   exportExamPdf({ meta, sections, solutions })
 *     solutions=false → exam paper (EXS): cover, marks grid, Section I MCQ,
 *                       Section II+ extended response with working lines.
 *     solutions=true  → solutions (EXT): cover + SOLUTIONS, MCQ answer table,
 *                       Section II+ marking criteria + sample solution.
 *
 * Same off-screen-A4 + html-to-image + jsPDF approach as the worksheet export,
 * with a CUBE logo watermark and footer on every content page. Serif type to
 * match the template.
 */

const PAGE_W = 794
const PAGE_H = 1123
const PAD = 56
const FONT = "'Avenir Next','Avenir','Nunito Sans',system-ui,-apple-system,sans-serif"
const INK = '#1a1a1a'
const SECTION_GAP = 28   // space below a section's divider line, before its first question

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Marks for a single question (sum of parts if multipart, else its own marks; MCQ defaults 1).
function questionMarks(q) {
  if (q.qtype === 'mcq') return q.marks ?? 1
  const parts = q.qbank_question_parts || []
  if (parts.length) return parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
  return Number(q.marks) || 0
}

function imagesHtml(images) {
  if (!images?.length) return ''
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0">${images.map((im) =>
    `<img src="${qbankImageUrl(im.storage_path)}" crossorigin="anonymous" alt="${esc(im.alt)}"
      style="max-width:300px;max-height:210px;object-fit:contain;border:1px solid #e5e7eb" />`).join('')}</div>`
}

function dottedLines(n) {
  let h = ''
  for (let i = 0; i < n; i++) h += '<div style="height:30px;border-bottom:1px dotted #b8b8b8"></div>'
  return h
}

// ── Block builders ────────────────────────────────────────────────────────────
function sectionHeader(sec, range, paper) {
  const lines = [
    `${sec.marks} marks`,
    `Attempt Questions ${range}`,
    sec.allow ? `Allow about ${esc(sec.allow)} for this section` : '',
    paper && sec.type === 'mcq' ? 'Circle the correct option below' : '',
    paper && sec.type !== 'mcq' && sec.mcqRange ? `Use the multiple-choice answer sheet for Questions ${sec.mcqRange}.` : '',
  ].filter(Boolean)
  const el = document.createElement('div')
  el.style.cssText = `margin:6px 0 ${SECTION_GAP}px`
  el.innerHTML =
    `<div style="font-size:22px;font-weight:600;margin-bottom:6px">Section ${sec.roman}</div>
     ${lines.map((l) => `<div style="font-size:14px;line-height:1.5">${l}</div>`).join('')}
     <div style="border-bottom:1.5px solid ${INK};margin-top:10px"></div>`
  return el
}

function mcqPaperBlock(q, number) {
  const opts = (q.options || []).map((o) =>
    `<div style="display:flex;gap:10px;margin:4px 0 4px 4px;font-size:15px">
       <span style="min-width:18px">${esc(o.label)}.</span>
       <span>${latexToHtml(o.latex || '')}</span></div>`).join('')
  const el = document.createElement('div')
  el.style.cssText = 'margin-bottom:40px;break-inside:avoid'
  el.innerHTML =
    `<div style="display:flex;gap:14px">
       <div style="font-weight:600;font-size:15px;min-width:22px">${number}</div>
       <div style="flex:1">
         <div style="font-size:15px;line-height:1.5">${latexToHtml(q.stem_latex || '')}</div>
         ${imagesHtml(q.qbank_question_images)}
         <div style="margin-top:6px">${opts}</div>
       </div>
     </div>`
  return el
}

function extendedPaperBlock(q, number) {
  const marks = questionMarks(q)
  const parts = (q.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  let body = `<div style="font-size:15px;line-height:1.5">${latexToHtml(q.stem_latex || '')}</div>${imagesHtml(q.qbank_question_images)}`
  if (parts.length) {
    parts.forEach((p, i) => {
      const lbl = p.part_label || 'abcdefgh'[i] || String(i + 1)
      const pm = p.marks != null ? `<span style="float:right;font-weight:600">${p.marks}</span>` : ''
      body += `<div style="margin:20px 0 16px;font-size:15px;line-height:1.5">${pm}<span style="font-weight:600">${esc(lbl)}</span>)&nbsp;${latexToHtml(p.prompt_latex || '')}</div>`
      body += dottedLines(Math.max(2, (Number(p.marks) || 1) * 2))
    })
  } else {
    body += dottedLines(Math.max(3, marks * 2))
  }
  const el = document.createElement('div')
  el.style.cssText = 'margin-bottom:36px'
  el.innerHTML =
    `<div style="margin-bottom:4px">
       <span style="font-size:16px;font-weight:600">Question ${number}</span>
       <span style="margin-left:28px;font-size:14px;color:#333">(${marks} mark${marks === 1 ? '' : 's'})</span>
     </div>${body}`
  return el
}

function mcqAnswerTable(questions, startNumber) {
  const rows = questions.map((q, i) =>
    `<tr>
       <td style="border:1px solid ${INK};padding:6px 10px;font-weight:600;white-space:nowrap">Question ${startNumber + i}</td>
       <td style="border:1px solid ${INK};padding:6px 10px;text-align:center;font-weight:600">${esc(q.correct_option || '')}</td>
       <td style="border:1px solid ${INK};padding:6px 10px">${latexToHtml(q.solution_latex || '')}</td>
     </tr>`).join('')
  const el = document.createElement('div')
  el.style.cssText = 'margin-bottom:18px'
  el.innerHTML =
    `<table style="width:100%;border-collapse:collapse;font-size:14px">
       <thead><tr>
         <th style="font-weight:600;border:1px solid ${INK};padding:6px 10px;text-align:left">MCQ</th>
         <th style="font-weight:600;border:1px solid ${INK};padding:6px 10px;width:70px">Answer</th>
         <th style="font-weight:600;border:1px solid ${INK};padding:6px 10px;text-align:left">Explanation</th>
       </tr></thead><tbody>${rows}</tbody></table>`
  return el
}

function criteriaTable(label, marks, sampleHtml) {
  const el = document.createElement('div')
  el.style.cssText = 'margin:14px 0;break-inside:avoid'
  el.innerHTML =
    `${label ? `<div style="font-size:15px;font-weight:600;margin-bottom:4px">${label}</div>` : ''}
     <table style="width:100%;border-collapse:collapse;font-size:14px">
       <thead><tr>
         <th style="font-weight:600;border:1px solid ${INK};padding:6px 10px;text-align:left">Criteria</th>
         <th style="font-weight:600;border:1px solid ${INK};padding:6px 10px;width:80px;text-align:center">Marks</th>
       </tr></thead><tbody>
         <tr>
           <td style="border:1px solid ${INK};padding:6px 10px">Provides correct solution</td>
           <td style="border:1px solid ${INK};padding:6px 10px;text-align:center;background:#f3f4f6">${marks}</td>
         </tr>
       </tbody></table>
     <div style="border:1px solid ${INK};border-top:none;padding:8px 10px">
       <div style="font-style:italic;margin-bottom:4px">Sample Solution:</div>
       <div style="font-size:14px;line-height:1.5">${sampleHtml || ''}</div>
     </div>`
  return el
}

function solutionBlocks(q, number) {
  const parts = (q.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const out = []
  const head = document.createElement('div')
  head.style.cssText = 'font-size:16px;font-weight:600;margin:16px 0 2px'
  head.textContent = `Question ${number}`
  out.push(head)
  if (q.stem_latex?.trim()) {
    const stem = document.createElement('div')
    stem.style.cssText = 'font-size:15px;line-height:1.5;margin-bottom:4px'
    stem.innerHTML = latexToHtml(q.stem_latex)
    out.push(stem)
  }
  if (parts.length) {
    parts.forEach((p, i) => {
      const lbl = p.part_label || 'abcdefgh'[i] || String(i + 1)
      out.push(criteriaTable(`(${esc(lbl)})`, p.marks ?? 1, latexToHtml(p.solution_latex || '')))
    })
  } else {
    out.push(criteriaTable('', questionMarks(q) || 1, latexToHtml(q.solution_latex || '')))
  }
  return out
}

// ── Cover page ────────────────────────────────────────────────────────────────
function coverPage(meta, sections, totalMarks, solutions) {
  const page = document.createElement('article')
  page.style.cssText = `width:${PAGE_W}px;height:${PAGE_H}px;box-sizing:border-box;padding:${PAD}px;background:#fff;font-family:${FONT};font-weight:400;color:${INK};position:relative`

  const instr = [
    meta.readingTime ? `Reading time – ${esc(meta.readingTime)}` : '',
    meta.workingTime ? `Working time – ${esc(meta.workingTime)}` : '',
    'Write using black pen',
    meta.calculators ? 'Calculators approved by NESA may be used' : '',
    'For questions show relevant mathematical reasoning and/or calculations',
  ].filter(Boolean)

  const totalBlock = sections.map((s) => {
    const subs = [
      `Attempt Questions ${s.range}`,
      s.allow ? `Allow about ${esc(s.allow)} for this section` : '',
    ].filter(Boolean)
    return `<div>Section ${s.roman} – ${s.marks} marks</div>`
      + `<ul style="margin:2px 0 0;padding-left:20px">${subs.map((l) => `<li>${l}</li>`).join('')}</ul>`
  }).join('<div style="height:12px"></div>')

  const colW = (100 / (sections.length + 1)).toFixed(4)   // equal width for every section + Total
  const gridCols = sections.map((s) => `<th style="font-weight:600;border:1px solid ${INK};padding:8px;width:${colW}%">Section ${s.roman}</th>`).join('')
  const gridVals = sections.map((s) => `<td style="border:1px solid ${INK};padding:10px;text-align:center;font-size:16px">/${s.marks}</td>`).join('')

  page.innerHTML =
    `<table style="margin-left:auto;border-collapse:collapse">
       <tr><td style="padding:2px 8px;text-align:right">Student Name:</td><td style="border-bottom:1px solid ${INK};width:300px"></td></tr>
       <tr><td style="padding:8px 8px 2px;text-align:right">Date:</td><td style="border-bottom:1px solid ${INK}"></td></tr>
     </table>

     <div style="display:flex;align-items:center;gap:16px;margin-top:54px">
       <img src="/qbank/cube-logo.png" style="height:64px" />
       <div style="font-size:46px;font-weight:400">CUBE Tuition</div>
     </div>

     <div style="font-size:38px;font-weight:400;line-height:1.7;margin-top:48px">
       Year ${esc(meta.yearLabel) || 'XX'} Mathematics<br/>Term ${esc(meta.term) || 'XX'} Exam
     </div>

     <div style="display:flex;gap:18px;margin-top:26px">
       <div style="font-weight:600;width:130px;flex-shrink:0">General<br/>Instructions</div>
       <div style="font-size:15px;line-height:1.55">${instr.map((i) => `<div>${i}</div>`).join('')}</div>
     </div>

     <div style="display:flex;gap:18px;margin-top:33px">
       <div style="font-weight:600;width:130px;flex-shrink:0">Total<br/>Marks:</div>
       <div style="font-size:15px;line-height:1.55">${totalBlock}</div>
     </div>

     ${solutions
      ? `<div style="font-size:64px;font-weight:700;margin-top:54px">SOLUTIONS</div>`
      : `<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:120px;text-align:center;font-size:18px">
           <thead><tr>${gridCols}<th style="font-weight:600;border:1px solid ${INK};padding:8px;width:${colW}%">Total</th></tr></thead>
           <tbody><tr>${gridVals}<td style="border:1px solid ${INK};padding:10px;font-size:16px">/${totalMarks}</td></tr></tbody>
         </table>`}`
  return page
}

// ── Content page chrome (watermark + footer) ──────────────────────────────────
function contentPage(meta) {
  const page = document.createElement('article')
  page.style.cssText = `width:${PAGE_W}px;min-height:${PAGE_H}px;box-sizing:border-box;padding:${PAD}px ${PAD}px 64px;background:#fff;font-family:${FONT};font-weight:400;color:${INK};position:relative;overflow:hidden`
  const wm = document.createElement('img')
  wm.src = '/qbank/cube-watermark.png'
  wm.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:430px;opacity:0.07;z-index:0;pointer-events:none'
  const inner = document.createElement('div')
  inner.style.cssText = 'position:relative;z-index:1'
  const footer = document.createElement('div')
  footer.style.cssText = `position:absolute;left:${PAD}px;right:${PAD}px;bottom:26px;display:flex;justify-content:space-between;align-items:center;font-size:12px;font-style:italic;color:#333;z-index:2`
  footer.innerHTML = `<span>© CUBE Tuition. All rights reserved.</span><span class="pno" style="font-style:normal"></span><span>Year ${esc(meta.yearLabel) || 'XX'} Mathematics Examination</span>`
  page.appendChild(wm); page.appendChild(inner); page.appendChild(footer)
  return { page, inner, footer }
}

async function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map((img) => (img.complete && img.naturalWidth)
    ? Promise.resolve() : new Promise((res) => { img.onload = res; img.onerror = res })))
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function exportExamPdf({ meta, sections, solutions = false }) {
  const htmlToImage = await import('html-to-image')
  const { jsPDF } = await import('jspdf')

  // Number questions across sections; compute marks + ranges.
  let n = 0
  let mcqRange = ''
  const prepared = sections.map((s) => {
    const start = n + 1
    const qs = s.questions || []
    n += qs.length
    const end = n
    const marks = qs.reduce((sum, q) => sum + questionMarks(q), 0)
    const range = qs.length ? (start === end ? `${start}` : `${start}–${end}`) : '—'
    if (s.type === 'mcq' && qs.length) mcqRange = range
    return { ...s, start, end, marks, range }
  })
  // let extended sections reference the MCQ range for the answer-sheet note
  prepared.forEach((s) => { if (s.type !== 'mcq') s.mcqRange = mcqRange })
  const totalMarks = prepared.reduce((sum, s) => sum + s.marks, 0)

  const stage = document.createElement('div')
  stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1'
  document.body.appendChild(stage)

  const pages = []
  // Page 1 — cover
  const cover = coverPage(meta, prepared, totalMarks, solutions)
  stage.appendChild(cover); pages.push(cover)

  // Content flow → blocks
  const blocks = []
  prepared.forEach((s) => {
    if (!s.questions?.length) return
    if (solutions) {
      blocks.push({ kind: 'header', el: solutionsSectionHeader(s) })
      if (s.type === 'mcq') {
        blocks.push({ kind: 'block', el: mcqAnswerTable(s.questions, s.start) })
      } else {
        s.questions.forEach((q, i) => solutionBlocks(q, s.start + i).forEach((el) => blocks.push({ kind: 'block', el })))
      }
    } else {
      blocks.push({ kind: 'header', el: sectionHeader(s, s.range, true) })
      s.questions.forEach((q, i) => {
        const number = s.start + i
        blocks.push({ kind: 'block', el: s.type === 'mcq' ? mcqPaperBlock(q, number) : extendedPaperBlock(q, number) })
      })
    }
  })

  // Paginate blocks onto content pages
  const contentPages = []
  let cur = contentPage(meta); stage.appendChild(cur.page); contentPages.push(cur); pages.push(cur.page)
  let count = 0
  const newContentPage = () => {
    cur = contentPage(meta); stage.appendChild(cur.page); contentPages.push(cur); pages.push(cur.page); count = 0
  }
  for (const b of blocks) {
    // Every section starts on a fresh page (unless the current page is still empty).
    if (b.kind === 'header' && count > 0) newContentPage()
    cur.inner.appendChild(b.el)
    if (cur.page.scrollHeight > PAGE_H && count > 0) {
      cur.inner.removeChild(b.el)
      newContentPage()
      cur.inner.appendChild(b.el)
    }
    count++
  }
  // footer page numbers (cover = p1, content starts at p2)
  contentPages.forEach((cp, i) => { cp.footer.querySelector('.pno').textContent = String(i + 2) })

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

  const safe = `year-${esc(meta.yearLabel) || 'x'}-term-${esc(meta.term) || 'x'}-exam`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
  pdf.save(`${safe}${solutions ? '-solutions' : ''}.pdf`)
}

function solutionsSectionHeader(s) {
  const el = document.createElement('div')
  el.style.cssText = `margin:6px 0 ${SECTION_GAP}px`
  el.innerHTML = `<div style="font-size:22px;font-weight:600">Section ${s.roman}</div><div style="border-bottom:1.5px solid ${INK};margin-top:6px"></div>`
  return el
}

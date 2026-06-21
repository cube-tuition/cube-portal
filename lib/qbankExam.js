import { latexToHtml } from '../components/qbank/LatexContent'
import { qbankImageUrl, criteriaBands } from './qbank'

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
  return `<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:8px 0">${images.map((im) =>
    `<img src="${qbankImageUrl(im.storage_path)}" crossorigin="anonymous" alt="${esc(im.alt)}"
      style="max-width:300px;max-height:210px;object-fit:contain" />`).join('')}</div>`
}
// Split a question's images: stem images go with the question, solution images
// (role='solution') only appear in the solutions copy.
const stemImagesOf = (q) => (q.qbank_question_images || []).filter((im) => (im.role || 'stem') !== 'solution')
const solutionImagesOf = (q) => (q.qbank_question_images || []).filter((im) => im.role === 'solution')

function dottedLines(n) {
  let h = ''
  for (let i = 0; i < n; i++) h += '<div style="height:30px;border-bottom:1px dotted #b8b8b8"></div>'
  return h
}

// "Sketch" questions get a generous blank, unlined block (~a third of a page)
// so the student can draw their own axes / plane.
const sketchSpace = () => '<div style="height:320px;margin:10px 0 6px"></div>'

// A question is a "sketch" question if its stem or any part asks to sketch.
const isSketchText = (s) => /\bsketch\b/i.test(s || '')
function isSketchQuestion(q) {
  if (isSketchText(q.stem_latex)) return true
  return (q.qbank_question_parts || []).some((p) => isSketchText(p.prompt_latex))
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
         ${imagesHtml(stemImagesOf(q))}
         <div style="margin-top:6px">${opts}</div>
       </div>
     </div>`
  return el
}

// Marking rubric grid (English): criteria rows × mark bands, cells[i] ↔ bands[i].
// Fully data-driven from the attached rubric — nothing about it is hardcoded.
function rubricTable(rubric) {
  if (!rubric || !Array.isArray(rubric.bands) || !rubric.bands.length) return ''
  const bands = rubric.bands
  const cellCss = `border:1px solid ${INK};padding:5px 7px;vertical-align:top;line-height:1.35`
  const cols = `<col style="width:21%"/>${bands.map(() => `<col style="width:${(79 / bands.length).toFixed(2)}%"/>`).join('')}`
  const head = `<tr>
      <th style="${cellCss};text-align:left;font-weight:600;background:#f3f4f6">Criteria</th>
      ${bands.map((b) => `<th style="${cellCss};text-align:center;font-weight:600;background:#f3f4f6">${esc(b.label)}</th>`).join('')}
    </tr>`
  const rows = (rubric.criteria || []).map((c) => `
    <tr>
      <td style="${cellCss};font-weight:600">${esc(c.name)}${c.max != null && c.max !== '' ? ` <span style="white-space:nowrap;font-weight:400">/${esc(c.max)}</span>` : ''}</td>
      ${bands.map((b, i) => `<td style="${cellCss}">${esc(c.cells?.[i] || '')}</td>`).join('')}
    </tr>`).join('')
  return `<div style="margin:14px 0 6px;break-inside:avoid">
      ${rubric.name ? `<div style="font-size:14px;font-weight:600;margin-bottom:4px">${esc(rubric.name)}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
        <colgroup>${cols}</colgroup>
        <thead>${head}</thead><tbody>${rows}</tbody>
      </table>
    </div>`
}

function extendedPaperBlock(q, number) {
  const marks = questionMarks(q)
  const parts = (q.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const wl = q._workingLines || null   // per-paper override from the exam slot: { partLabel|"_": lines }
  let body = `<div style="font-size:15px;line-height:1.5">${latexToHtml(q.stem_latex || '')}</div>${imagesHtml(stemImagesOf(q))}`
  if (parts.length) {
    parts.forEach((p, i) => {
      const lbl = p.part_label || 'abcdefgh'[i] || String(i + 1)
      const pm = p.marks != null ? `<span style="float:right;font-weight:600">${p.marks}</span>` : ''
      body += `<div style="margin:20px 0 16px;font-size:15px;line-height:1.5">${pm}<span style="font-weight:600">${esc(lbl)}</span>)&nbsp;${latexToHtml(p.prompt_latex || '')}</div>`
      const plines = (wl && wl[lbl] != null) ? Math.max(0, wl[lbl]) : Math.max(2, (Number(p.marks) || 1) * 2)
      body += isSketchText(p.prompt_latex) ? sketchSpace() : dottedLines(plines)
    })
  } else {
    const qlines = (wl && wl['_'] != null) ? Math.max(0, wl['_']) : Math.max(3, marks * 2)
    body += isSketchText(q.stem_latex) ? sketchSpace() : dottedLines(qlines)
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
       <td style="border:1px solid ${INK};padding:6px 10px">${latexToHtml(q.solution_latex || '')}${imagesHtml(solutionImagesOf(q))}</td>
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

function criteriaTable(label, marks, criteria, sampleHtml) {
  // Banded marking guideline: one row per mark, full marks → 1 (top is always
  // "Provides correct answer"; lower bands from overrides or generic defaults).
  const rows = criteriaBands(Number(marks) || 1, criteria).map((b) =>
    `<tr>
       <td style="border:1px solid ${INK};padding:6px 10px">${latexToHtml(b.text)}</td>
       <td style="border:1px solid ${INK};padding:6px 10px;text-align:center;background:#f3f4f6">${b.marks}</td>
     </tr>`).join('')
  const el = document.createElement('div')
  el.style.cssText = 'margin:28px 0;break-inside:avoid'
  el.innerHTML =
    `${label ? `<div style="font-size:15px;font-weight:600;margin-bottom:4px">${label}</div>` : ''}
     <table style="width:100%;border-collapse:collapse;font-size:14px">
       <thead><tr>
         <th style="font-weight:600;border:1px solid ${INK};padding:6px 10px;text-align:left">Criteria</th>
         <th style="font-weight:600;border:1px solid ${INK};padding:6px 10px;width:80px;text-align:center">Marks</th>
       </tr></thead><tbody>${rows}</tbody></table>
     <div style="border:1px solid ${INK};border-top:none;padding:8px 10px">
       <div style="font-style:italic;margin-bottom:4px">Sample Solution:</div>
       <div style="font-size:14px;line-height:1.5">${sampleHtml || ''}</div>
     </div>`
  return el
}

function solutionBlocks(q, number, paperType) {
  const parts = (q.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  // Build the answer boxes. English papers use the writing rubric (never the
  // maths banded criteria table); maths papers keep the banded criteria table.
  // Notes come from the exam slot (typed in the builder) or fall back to the bank
  // question's solution text.
  const notesSrc = (q._notes && q._notes.trim()) ? q._notes : (q.solution_latex || '')
  const sampleBox = (label) => {
    const box = document.createElement('div')
    box.style.cssText = `border:1px solid ${INK};padding:8px 10px;margin:14px 0 4px;break-inside:avoid`
    box.innerHTML = `<div style="font-style:italic;margin-bottom:4px">${label}</div><div style="font-size:14px;line-height:1.5">${latexToHtml(notesSrc) || '<span style="color:#999">—</span>'}</div>`
    return box
  }
  // Optional per question (q._showNotes); prints when there's note content.
  const wantNotes = q._showNotes !== false && latexToHtml(notesSrc).trim()
  let tables
  if (q._rubric) {
    tables = []
    if (wantNotes) tables.push(sampleBox('Sample / marker notes:'))
    const rub = document.createElement('div')
    rub.innerHTML = rubricTable(q._rubric)
    tables.push(rub)
  } else if (paperType === 'english') {
    // English writing without a rubric → optional notes only, never the maths table.
    tables = wantNotes ? [sampleBox('Sample / marker notes:')] : []
  } else {
    tables = parts.length
      ? parts.map((p, i) => {
          const lbl = p.part_label || 'abcdefgh'[i] || String(i + 1)
          return criteriaTable(`(${esc(lbl)})`, p.marks ?? 1, p.criteria, latexToHtml(p.solution_latex || ''))
        })
      : [criteriaTable('', questionMarks(q) || 1, q.criteria, latexToHtml(q.solution_latex || ''))]
  }

  // Append any solution figures/images (role='solution') after the answer boxes.
  const solnImgs = solutionImagesOf(q)
  if (solnImgs.length) {
    const imgEl = document.createElement('div')
    imgEl.style.cssText = 'break-inside:avoid;margin:6px 0'
    imgEl.innerHTML = imagesHtml(solnImgs)
    tables.push(imgEl)
  }

  // Group the "Question N" heading + stem + first answer box into one atomic
  // block so the heading is never left orphaned at the bottom of a page — the
  // paginator page-breaks before the group instead of after the heading.
  const group = document.createElement('div')
  group.style.cssText = 'break-inside:avoid'
  const head = document.createElement('div')
  head.style.cssText = 'font-size:16px;font-weight:600;margin:32px 0 2px'
  head.textContent = `Question ${number}`
  group.appendChild(head)
  if (q.stem_latex?.trim()) {
    const stem = document.createElement('div')
    stem.style.cssText = 'font-size:15px;line-height:1.5;margin-bottom:4px'
    stem.innerHTML = latexToHtml(q.stem_latex)
    group.appendChild(stem)
  }
  if (tables.length) group.appendChild(tables.shift())

  // First box travels with the heading; any remaining boxes flow on their own
  // (a long multi-part question may still split after the first box).
  return [group, ...tables]
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
    meta.paperType === 'english'
      ? 'Plan your response before you begin writing'
      : 'For questions show relevant mathematical reasoning and/or calculations',
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
       Year ${esc(meta.yearLabel) || 'XX'} ${meta.paperType === 'english' ? 'English' : 'Mathematics'}<br/>Term ${esc(meta.term) || 'XX'} Exam
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
      ? `<div style="font-size:64px;font-weight:600;margin-top:54px;text-align:center">SOLUTIONS</div>`
      : `<div style="position:absolute;left:${PAD}px;right:${PAD}px;bottom:96px">
           <table style="width:100%;border-collapse:collapse;table-layout:fixed;text-align:center;font-size:18px">
             <thead><tr>${gridCols}<th style="font-weight:600;border:1px solid ${INK};padding:8px;width:${colW}%">Total</th></tr></thead>
             <tbody><tr>${gridVals}<td style="border:1px solid ${INK};padding:10px;font-size:16px">/${totalMarks}</td></tr></tbody>
           </table>
         </div>`}`
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
  footer.innerHTML = `<span>© CUBE Tuition. All rights reserved.</span><span class="pno" style="font-style:normal"></span><span>Year ${esc(meta.yearLabel) || 'XX'} ${meta.paperType === 'english' ? 'English' : 'Mathematics'} Examination</span>`
  page.appendChild(wm); page.appendChild(inner); page.appendChild(footer)
  return { page, inner, footer }
}

// Inline every <img> as a data URL (dropping any that can't load) so a missing
// or CORS-blocked image can't fail the whole export with an [object Event] error.
async function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map(async (img) => {
    try {
      const res = await fetch(img.src, { mode: 'cors', cache: 'no-cache' })
      if (!res.ok) throw new Error('not ok')
      const blob = await res.blob()
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.onerror = reject
        fr.readAsDataURL(blob)
      })
      img.src = dataUrl
      img.removeAttribute('crossorigin')
    } catch {
      img.remove()
    }
  }))
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function exportExamPdf({ meta, sections, solutions = false, preview = false, renderTo = null }) {
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

  // For the live preview we build straight into the on-screen container; for the
  // PDF we build into a hidden off-screen stage. Identical builder either way, so
  // the preview can never drift from the exported PDF.
  const stage = renderTo || document.createElement('div')
  if (!renderTo) {
    stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1'
    document.body.appendChild(stage)
  } else {
    stage.style.cssText = 'display:flex;flex-direction:column;gap:16px;align-items:flex-start'
  }

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
        s.questions.forEach((q, i) => solutionBlocks(q, s.start + i, meta.paperType).forEach((el) => blocks.push({ kind: 'block', el })))
      }
    } else {
      blocks.push({ kind: 'header', el: sectionHeader(s, s.range, true) })
      s.questions.forEach((q, i) => {
        const number = s.start + i
        const sketch = s.type !== 'mcq' && isSketchQuestion(q)
        blocks.push({ kind: 'block', pageBreak: sketch, el: s.type === 'mcq' ? mcqPaperBlock(q, number) : extendedPaperBlock(q, number) })
      })
    }
  })

  // Pre-load every question image at the true content width BEFORE paginating.
  // Images load asynchronously, so without this a page can look like it fits
  // during layout and then overflow once the figures appear — which previously
  // forced the page to be scaled down (it looked squished).
  {
    const measure = document.createElement('div')
    measure.style.cssText = `width:${PAGE_W - 2 * PAD}px;font-family:${FONT};font-weight:400;color:${INK}`
    stage.appendChild(measure)
    blocks.forEach((b) => measure.appendChild(b.el))
    await waitForImages(measure)
    await Promise.all(Array.from(measure.querySelectorAll('img'))
      .map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())))
    blocks.forEach((b) => measure.removeChild(b.el))
    stage.removeChild(measure)
  }

  // Paginate blocks onto content pages
  const contentPages = []
  let cur = contentPage(meta); stage.appendChild(cur.page); contentPages.push(cur); pages.push(cur.page)
  let count = 0
  const newContentPage = () => {
    cur = contentPage(meta); stage.appendChild(cur.page); contentPages.push(cur); pages.push(cur.page); count = 0
  }
  for (const b of blocks) {
    // Every section starts on a fresh page (unless the current page is still empty).
    // Sketch questions also start on a fresh page so the plane has room.
    if ((b.kind === 'header' || b.pageBreak) && count > 0) newContentPage()
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
  if (renderTo) return { pages }   // live preview — leave the rendered pages on screen

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()
  for (let i = 0; i < pages.length; i++) {
    const capH = Math.max(PAGE_H, pages[i].scrollHeight)
    const dataUrl = await htmlToImage.toJpeg(pages[i], {
      quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: false,
      width: PAGE_W, height: capH,
    })
    if (i > 0) pdf.addPage()
    // Always draw at FULL PAGE WIDTH so nothing is ever squished horizontally or
    // vertically. A page that fits sits on one sheet; a taller-than-A4 page keeps
    // its width and simply continues onto further sheets (offset by -pdfH each
    // time) instead of being scaled down.
    const fullH = pdfW * (capH / PAGE_W)
    if (fullH <= pdfH + 0.5) {
      pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfW, fullH)
    } else {
      let y = 0
      let firstSlice = true
      while (y < fullH - 0.5) {
        if (!firstSlice) pdf.addPage()
        pdf.addImage(dataUrl, 'JPEG', 0, -y, pdfW, fullH)
        y += pdfH
        firstSlice = false
      }
    }
  }
  document.body.removeChild(stage)

  const safe = `year-${esc(meta.yearLabel) || 'x'}-term-${esc(meta.term) || 'x'}-exam`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
  const filename = `${safe}${solutions ? '-solutions' : ''}.pdf`
  if (preview) return { url: URL.createObjectURL(pdf.output('blob')), filename }
  pdf.save(filename)
}

function solutionsSectionHeader(s) {
  const el = document.createElement('div')
  el.style.cssText = `margin:6px 0 ${SECTION_GAP}px`
  el.innerHTML = `<div style="font-size:22px;font-weight:600">Section ${s.roman}</div><div style="border-bottom:1.5px solid ${INK};margin-top:6px"></div>`
  return el
}

// Render the exam (or solutions) as live, on-screen A4 pages into `container`
// for the side-by-side preview. Uses the same builder as the PDF.
export async function renderExamPreview(container, { meta, sections, solutions = false }) {
  if (!container) return
  container.innerHTML = ''
  try { await exportExamPdf({ meta, sections, solutions, renderTo: container }) }
  catch { container.innerHTML = '<p style="color:#b23a3a;font-size:13px;padding:16px">Preview failed.</p>' }
}

import { richToHtml, inlineRich } from '../components/qbank/LatexContent'
import { qbankImageUrl } from './qbank'
import { nodeToJpeg } from './rasterise'
import { coverHtml, BOOKLET_CSS } from './bookletRender'

// The cover names the subject in full, as the booklet cover does.
const subjectLong = (v) => {
  if (!v) return 'Mathematics'
  if (/chem/i.test(v)) return 'Chemistry'
  if (/english|eald/i.test(v)) return 'English'
  if (/math/i.test(v)) return 'Mathematics'
  return v
}

// The booklet cover, full bleed, as the worksheet's page 1. It needs the
// booklet stylesheet, which the worksheet pages otherwise don't load — scoped
// .bk-* classes, so carrying it on this page alone is harmless.
function coverPage({ title, cover, answers }) {
  const page = document.createElement('article')
  page.className = 'qbank-ws-page bk-root'
  page.style.cssText = `position:relative;width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden;background:#fff`
  const style = document.createElement('style')
  style.textContent = BOOKLET_CSS
  page.appendChild(style)
  const holder = document.createElement('div')
  holder.innerHTML = coverHtml(
    { subject: subjectLong(cover?.subject), year: cover?.year ?? '', name: title || 'Worksheet' },
    { solutions: answers, tagline: 'Additional Questions' },
  )
  page.appendChild(holder.firstElementChild)
  return page
}

/*
 * Worksheet / answer-key PDF export.
 *
 * Builds an off-screen column of A4 pages (matching the term-report PDF
 * approach used elsewhere in the portal: html-to-image.toJpeg → jsPDF), so
 * KaTeX-rendered maths and images come out crisp. Questions are packed onto
 * pages by measured height so a question is never split across a page break.
 *
 * Styled to match the CUBE booklet/workbook house style (see lib/bookletRender.js):
 * the booklet font stack and ink colours, a grey heading band with the CUBE
 * wordmark, "Question N (X marks)" titles, dotted answer lines scaled by marks,
 * neutral sample-solution boxes, and the branded page footer.
 *
 *   exportWorksheet({ title, questions, includeMarks, answers, cover })
 *     answers=false → worksheet (dotted answer lines)
 *     answers=true  → answer key (worked solutions shown)
 */

// A4 @ 96dpi
const PAGE_W = 794
const PAGE_H = 1123
const PAD = 48                       // horizontal page padding (matches measure width)
const PAD_TOP = 38
const PAD_BOTTOM = 60                // room for the footer (booklet uses 60px)

// Booklet house style (mirrors lib/bookletRender.js)
const FONT       = "'Avenir Next','Avenir','Segoe UI',system-ui,Helvetica,Arial,sans-serif"
const INK        = '#1c1c1c'         // booklet --ink
const MUTED      = '#555'            // marks / secondary
const BRAND      = '#364466'         // booklet cover brand colour
const TICK_GREEN = '#0a7d33'         // booklet correct-answer tick

const BAND_GREY  = '#e7e8ea'         // booklet --grey section band

/*
 * A grey section band, used to split one worksheet into named parts — a
 * combined classwork + homework sheet puts "Homework" here. This is the band
 * the worksheet header used before the cover page took over the title; it comes
 * back for this, rather than a second style being invented.
 */
function sectionBandHtml(label) {
  return `<div style="margin:0 0 26px"><div style="background:${BAND_GREY};padding:22px 26px;text-align:center">
    <div style="font-size:26px;font-weight:600;color:${INK};letter-spacing:-.2px">${esc(label)}</div>
  </div></div>`
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Booklet-style dotted answer lines (each line 26px, dotted #9a9a9a).
function dottedLines(n) {
  const rows = Array.from({ length: Math.max(1, n) })
    .map(() => '<div style="border-bottom:1px dotted #9a9a9a;height:26px"></div>').join('')
  return `<div style="margin-top:12px">${rows}</div>`
}
// Number of answer lines for a question/part.
//
// Writing space belongs to the MATERIAL, not to the question — a question in
// the bank carries none. When placed on a worksheet it defaults to a size
// derived from its marks, which the author can override per part via
// `q._workingLines` ({ partLabel | "_" : lines }), exactly as exam slots do.
// `writingSpace: false` drops it entirely (student-generated sheets, where
// there is no author to size it).
const linesForMarks = (m, min) => Math.max(min, Math.round((Number(m) || 1) * 2))
function linesFor(q, key, marks, min, writingSpace) {
  if (!writingSpace) return 0
  const override = q?._workingLines?.[key]
  if (override != null && override !== '') return Math.max(0, Number(override) || 0)
  return linesForMarks(marks, min)
}

// Booklet-style neutral sample-solution box (answer key only).
function solBox(label, innerHtml) {
  return `<div style="border:1px solid #c9c9c9;padding:12px 16px;margin-top:12px">
    <p style="font-style:italic;font-size:14px;color:#333;margin:0 0 6px">${esc(label)}</p>
    <div style="font-size:16px;line-height:1.55;color:${INK}">${innerHtml || '<span style="color:#aaa">—</span>'}</div>
  </div>`
}

function imagesHtml(images) {
  if (!images?.length) return ''
  const imgs = images.map((im) => {
    const url = qbankImageUrl(im.storage_path)
    return `<img src="${url}" crossorigin="anonymous" alt="${esc(im.alt)}"
      style="max-width:280px;max-height:200px;object-fit:contain;margin:6px 8px" />`
  }).join('')
  return `<div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;margin:6px 0">${imgs}</div>`
}
// Stem images go with the question; solution images (role='solution') only on the answer key.
const stemImagesOf = (q) => (q.qbank_question_images || []).filter((im) => (im.role || 'stem') !== 'solution')
const solutionImagesOf = (q) => (q.qbank_question_images || []).filter((im) => im.role === 'solution')

// A question renders as CHUNKS so a page break can fall between parts but
// never inside one: the header + stem travel with part (a) (a stem must never
// strand alone at the foot of a page), then each further part is its own chunk.
// A question with no parts is a single chunk, as before.
function questionChunks(q, index, { includeMarks, answers, writingSpace = true }) {
  const num = index + 1
  // Same as the booklet's .bk-marks — 16px, muted, separated by a plain space.
  const marks = (includeMarks && q.marks != null)
    ? `<span style="font-size:16px;font-weight:600;color:${MUTED}">(${q.marks} mark${q.marks === 1 ? '' : 's'})</span>`
    : ''

  let head = `<p style="font-size:16px;font-weight:600;color:${INK};margin:0 0 6px">Question ${num} ${marks}</p>`
  head += `<div style="font-size:16px;line-height:1.55;color:${INK}">${richToHtml(q.stem_latex || '')}</div>`
  head += imagesHtml(stemImagesOf(q))

  // Multiple-choice options (correct one highlighted on the answer key)
  const isMcq = q.qtype === 'mcq' && Array.isArray(q.options) && q.options.length > 0
  if (isMcq) {
    head += '<div style="margin:8px 0 0">'
    for (const opt of q.options) {
      const isCorrect = answers && opt.label === q.correct_option
      head += `<div style="font-size:16px;line-height:1.6;color:${INK};${isCorrect ? 'font-weight:600' : ''}"><span style="font-weight:400;margin-right:4px">${esc(opt.label)}.</span>${inlineRich(opt.latex || '')}${isCorrect ? ` <span style="color:${TICK_GREEN};font-weight:700">✓</span>` : ''}</div>`
    }
    head += '</div>'
  }

  const mk = (html, last, cont = false) => {
    const el = document.createElement('div')
    el.style.cssText = `margin-bottom:${last ? 28 : 0}px;break-inside:avoid`
    // A continuation chunk carries a hidden "(continued)" label; pagination
    // reveals it only when the chunk lands at the top of a page.
    el.innerHTML = (cont
      ? `<p class="ws-cont" style="display:none;font-size:14px;font-weight:600;color:${MUTED};margin:0 0 4px">Question ${num} <span style="font-weight:400">(continued)</span></p>`
      : '') + html
    if (cont) el.dataset.cont = '1'
    return el
  }
  const solnImgs = answers ? solutionImagesOf(q) : []
  const tail = solnImgs.length ? imagesHtml(solnImgs) : ''

  const parts = (q.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  if (parts.length) {
    const partHtml = (p, i) => {
      const lbl = p.part_label || 'abcdefgh'[i] || String(i + 1)
      // Same as the booklet's .bk-part-marks — a bare number out in the right
      // margin, in ink. Emitted BEFORE the prompt so the float lands on the
      // prompt's first line rather than after its last.
      const pm = (includeMarks && p.marks != null)
        ? `<span style="float:right;margin-left:16px;font-size:16px;font-weight:600;color:${INK}">${p.marks}</span>` : ''
      let answerArea = ''
      if (answers && p.solution_latex?.trim()) answerArea = solBox('Solution:', richToHtml(p.solution_latex))
      else if (!answers) answerArea = dottedLines(linesFor(q, lbl, p.marks, 2, writingSpace))
      return `<div style="display:flex;gap:10px;margin:8px 0">
        <div style="font-weight:600;width:20px">${esc(lbl)}.</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:16px;line-height:1.55;color:${INK}">${pm}${richToHtml(p.prompt_latex || '')}</div>
          ${answerArea}
        </div>
      </div>`
    }
    const chunks = []
    chunks.push(mk(head + `<div style="margin-top:8px">${partHtml(parts[0], 0)}</div>` + (parts.length === 1 ? tail : ''), parts.length === 1))
    for (let i = 1; i < parts.length; i++) {
      const last = i === parts.length - 1
      chunks.push(mk(`<div>${partHtml(parts[i], i)}</div>` + (last ? tail : ''), last, true))
    }
    return chunks
  }

  let body = head
  if (answers && q.solution_latex?.trim()) {
    body += solBox('Sample solution or notes:', richToHtml(q.solution_latex))
  } else if (!answers) {
    // MCQ needs no answer lines; extended questions get whatever the material asked for.
    body += isMcq ? '<div style="height:8px"></div>' : dottedLines(linesFor(q, '_', q.marks, 4, writingSpace))
  }
  return [mk(body + tail, true)]
}

function newPage() {
  const page = document.createElement('article')
  page.className = 'qbank-ws-page'
  page.style.cssText = `position:relative;width:${PAGE_W}px;min-height:${PAGE_H}px;box-sizing:border-box;padding:${PAD_TOP}px ${PAD}px ${PAD_BOTTOM}px;background:#fff;font-family:${FONT};font-weight:400;color:${INK}`
  const inner = document.createElement('div')
  page.appendChild(inner)
  return { page, inner }
}

// Booklet-style footer stamped on every page (left © · centre page no · right label).
function footerHtml(pageNo, total, rightLabel) {
  // 3-column grid so the page number is the true page centre (not offset by the
  // wider copyright text on the left, as a flex space-between layout would do).
  return `<div style="position:absolute;left:${PAD}px;right:${PAD}px;bottom:28px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;font-size:11px;color:#666">
    <span style="font-style:italic;text-align:left">© CUBE Tuition. All rights reserved.</span>
    <span style="text-align:center">${pageNo}${total ? ` / ${total}` : ''}</span>
    <span style="font-style:italic;text-align:right">${esc(rightLabel)}</span>
  </div>`
}

// Inline every <img> as a data URL (dropping any that can't load) so a missing
// or CORS-blocked image can't fail the whole export with an [object Event] error.
// SVG images are rasterised to PNG first — html-to-image's foreignObject
// snapshot is unreliable with nested SVG images and rejects with a bare Event.
async function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map(async (img) => {
    try {
      const res = await fetch(img.src, { mode: 'cors', cache: 'no-cache' })
      if (!res.ok) throw new Error('not ok')
      const blob = await res.blob()
      let dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.onerror = reject
        fr.readAsDataURL(blob)
      })
      if (blob.type.includes('svg')) {
        dataUrl = await new Promise((resolve, reject) => {
          const tmp = new Image()
          tmp.onload = () => {
            try {
              const scale = 2
              const w = tmp.naturalWidth || 400, h = tmp.naturalHeight || 300
              const canvas = document.createElement('canvas')
              canvas.width = w * scale
              canvas.height = h * scale
              const ctx = canvas.getContext('2d')
              // No background fill — keep the PNG transparent so the page
              // watermark shows through behind question images.
              ctx.scale(scale, scale)
              ctx.drawImage(tmp, 0, 0, w, h)
              resolve(canvas.toDataURL('image/png'))
            } catch (err) { reject(err) }
          }
          tmp.onerror = () => reject(new Error('SVG rasterise failed'))
          tmp.src = dataUrl
        })
      }
      img.src = dataUrl
      img.removeAttribute('crossorigin')
    } catch {
      img.remove()
    }
  }))
}

export async function exportWorksheet({ title, questions, includeMarks = true, answers = false, preview = false, renderTo = null, writingSpace = true, cover = null, breaks = [] }) {
  const { jsPDF } = await import('jspdf')

  // Off-screen staging area for the PDF; the on-screen container for the live
  // preview. Same builder so the preview matches the export.
  const stage = renderTo || document.createElement('div')
  if (!renderTo) {
    stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1'
    document.body.appendChild(stage)
  } else {
    stage.style.cssText = 'display:flex;flex-direction:column;gap:16px;align-items:flex-start'
  }

  // Build all question blocks, then pre-load their images at the true content
  // width BEFORE paginating. Figures load asynchronously, so without this a page
  // can look like it fits during layout and then overflow once the images appear
  // — which clipped the bottom question (e.g. Q12 being cut off).
  // Maths fonts load lazily; measuring before they arrive mis-sizes every line.
  try { await document.fonts.ready } catch { /* older browsers */ }
  // `breaks` is [{ index, label }] — a grey band sits BEFORE the question at
  // that position, and question numbering restarts from 1 after it, so each
  // section reads as its own paper.
  const bandAt = new Map((breaks || []).map((b) => [Number(b.index), b.label]))
  const blocks = []
  let shown = 0
  questions.forEach((q, i) => {
    if (bandAt.has(i)) {
      const holder = document.createElement('div')
      holder.innerHTML = sectionBandHtml(bandAt.get(i))
      const band = holder.firstElementChild
      band.dataset.break = '1'      // a section always opens a fresh page
      blocks.push(band)
      shown = 0
    }
    blocks.push(...questionChunks(q, shown, { includeMarks, answers, writingSpace }))
    shown += 1
  })
  {
    const measure = document.createElement('div')
    measure.style.cssText = `width:${PAGE_W - 2 * PAD}px;font-family:${FONT};font-weight:400`
    stage.appendChild(measure)
    blocks.forEach((b) => measure.appendChild(b))
    await waitForImages(measure)
    await Promise.all(Array.from(measure.querySelectorAll('img'))
      .map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())))
    blocks.forEach((b) => measure.removeChild(b))
    stage.removeChild(measure)
  }

  const pages = []
  // Page 1 is the cover — the title lives there now, so the content pages
  // open straight onto Question 1 (no grey heading band).
  const coverEl = coverPage({ title, cover, answers })
  stage.appendChild(coverEl)
  pages.push(coverEl)
  let { page, inner } = newPage()
  stage.appendChild(page)
  pages.push(page)
  let blocksOnPage = 0

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    // A section band starts its own page rather than sitting mid-sheet.
    if (block.dataset?.break === '1' && blocksOnPage > 0) {
      ;({ page, inner } = newPage())
      stage.appendChild(page)
      pages.push(page)
      blocksOnPage = 0
    }
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

  // Anything that grew after pagination (late fonts, images) is reflowed: a page
  // that no longer fits hands its trailing chunks to the next page, so nothing is
  // ever clipped at a page foot or sliced by the rasteriser.
  await waitForImages(stage)
  try { await document.fonts.ready } catch { /* older browsers */ }
  const reflow = () => {
    let moved = 0
    for (let i = 1; i < pages.length; i++) {   // 0 is the cover
      const pg = pages[i], inn = pg.firstChild
      let guard = 0
      while (pg.scrollHeight > PAGE_H && inn.children.length > 1 && guard++ < 80) {
        let next = pages[i + 1]
        if (!next) { const np = newPage(); stage.appendChild(np.page); pages.push(np.page); next = np.page }
        next.firstChild.insertBefore(inn.lastElementChild, next.firstChild.firstChild)
        moved++
      }
    }
    return moved
  }
  // A part that opens a page gets its "Question N (continued)" label shown —
  // which adds height, so label and reflow alternate until nothing moves.
  const relabel = () => {
    stage.querySelectorAll('.ws-cont').forEach((l) => { l.style.display = 'none' })
    for (let i = 2; i < pages.length; i++) {
      const first = pages[i].firstChild.firstElementChild
      if (first?.dataset.cont === '1') { const l = first.querySelector('.ws-cont'); if (l) l.style.display = 'block' }
    }
  }
  for (let pass = 0; pass < 6; pass++) { relabel(); if (!reflow()) break }
  relabel()

  // Stamp the booklet-style footer on every page (after pagination so it doesn't
  // affect the height measurements that drive page breaks).
  const footerLabel = `${title || 'Worksheet'}${answers ? ' · Answer Key' : ''}`
  pages.forEach((pg, i) => {
    if (i === 0) return   // the cover carries no footer
    const holder = document.createElement('div')
    holder.innerHTML = footerHtml(i, pages.length - 1, footerLabel)
    pg.appendChild(holder.firstElementChild)
  })

  await waitForImages(stage)
  if (renderTo) return { pages }   // live preview — leave the pages on screen

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()

  const renderPage = (page, skipFonts) => nodeToJpeg(page, {
    quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff', skipFonts,
    width: PAGE_W, height: Math.max(PAGE_H, page.scrollHeight),
  })

  for (let i = 0; i < pages.length; i++) {
    let dataUrl
    try {
      dataUrl = await renderPage(pages[i], false)
    } catch (err) {
      // html-to-image rejects with a bare Event when an embedded resource fails.
      // Recovery ladder: (1) retry without font embedding, (2) drop images that
      // won't load, (3) isolate the offending question block by elimination so
      // the export still completes and the console names the culprit.
      console.warn(`qbankWorksheet: page ${i + 1} failed first render`, err)
      try {
        dataUrl = await renderPage(pages[i], true)
      } catch {
        // Probe every image on the page; drop any that fail to load.
        const imgs = Array.from(pages[i].querySelectorAll('img'))
        await Promise.all(imgs.map((im) => new Promise((resolve) => {
          const probe = new Image()
          probe.onload = resolve
          probe.onerror = () => { console.warn('qbankWorksheet: dropping unloadable image', im.src.slice(0, 120)); im.remove(); resolve() }
          probe.src = im.src
        })))
        try {
          dataUrl = await renderPage(pages[i], true)
        } catch {
          // Last resort: render each block ALONE on a scratch page to find every
          // block that breaks serialisation, physically replace them with
          // placeholders (hiding is not enough — hidden nodes still serialise),
          // then render the page again.
          const inner = pages[i].firstChild
          const blocks = Array.from(inner.children)
          const scratch = newPage()
          pages[i].parentNode.appendChild(scratch.page)
          let badCount = 0
          for (const block of blocks) {
            const home = block.nextSibling, parent = block.parentNode
            scratch.inner.appendChild(block)
            let ok = true
            try { await renderPage(scratch.page, true) } catch (blockErr) {
              ok = false
              console.error(`qbankWorksheet: page ${i + 1} — block fails to render:`, blockErr, '\nHTML:', block.outerHTML.slice(0, 1500))
            }
            scratch.inner.removeChild(block)
            if (ok) { parent.insertBefore(block, home) }
            else {
              badCount++
              const note = document.createElement('div')
              note.style.cssText = 'padding:10px;border:1px dashed #f59e0b;border-radius:6px;color:#92400e;font-size:13px;margin-bottom:18px'
              note.textContent = `⚠ A question could not be rendered here (${(block.textContent || '').trim().slice(0, 60)}…) — view it in the portal.`
              parent.insertBefore(note, home)
            }
          }
          scratch.page.remove()
          try {
            dataUrl = await renderPage(pages[i], true)
            if (badCount) console.error(`qbankWorksheet: page ${i + 1} exported with ${badCount} placeholder(s) — see block HTML above.`)
          } catch (finalErr) {
            console.error(`qbankWorksheet: page ${i + 1} still failing with all suspect blocks removed:`, finalErr)
            throw new Error(`Page ${i + 1} of the PDF could not be rendered — check the browser console (filter: qbankWorksheet) and send me the logged error.`)
          }
        }
      }
    }
    if (i > 0) pdf.addPage()
    // Draw at full page width. A page whose content fits sits on one sheet; a
    // genuinely over-long page keeps its width and continues onto further sheets
    // (offset by -pdfH) rather than being clipped at the bottom.
    const renderedPx = Math.max(PAGE_H, pages[i].scrollHeight)
    const fullH = pdfW * (renderedPx / PAGE_W)
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

  const safe = (title || 'worksheet').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')
  const filename = `${safe || 'worksheet'}${answers ? '-answers' : ''}.pdf`
  if (preview) return { url: URL.createObjectURL(pdf.output('blob')), filename }
  pdf.save(filename)
}

// Live, on-screen render of the worksheet into `container` for side-by-side
// preview. Same builder as the PDF, so they can't drift.
export async function renderWorksheetPreview(container, opts) {
  if (!container) return
  container.innerHTML = ''
  try { await exportWorksheet({ ...opts, renderTo: container }) }
  catch { container.innerHTML = '<p style="color:#b23a3a;font-size:13px;padding:16px">Preview failed.</p>' }
}

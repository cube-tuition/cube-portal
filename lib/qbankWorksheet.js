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
const FONT = "'Avenir Next','Avenir','Nunito Sans',system-ui,-apple-system,sans-serif"

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function imagesHtml(images) {
  if (!images?.length) return ''
  const imgs = images.map((im) => {
    const url = qbankImageUrl(im.storage_path)
    return `<img src="${url}" crossorigin="anonymous" alt="${esc(im.alt)}"
      style="max-width:280px;max-height:200px;object-fit:contain;margin:6px 8px" />`
  }).join('')
  return `<div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;margin:6px 0">${imgs}</div>`
}

function questionBlock(q, index, { includeMarks, answers }) {
  const num = index + 1
  const marks = (includeMarks && q.marks != null)
    ? `<span style="float:right;color:#64748b;font-size:13px">[${q.marks} mark${q.marks === 1 ? '' : 's'}]</span>`
    : ''

  let body = `<div style="font-size:15px;line-height:1.5;color:#1f2937">${latexToHtml(q.stem_latex || '')}</div>`
  body += imagesHtml(q.qbank_question_images)

  // Multiple-choice options (correct one highlighted on the answer key)
  const isMcq = q.qtype === 'mcq' && Array.isArray(q.options) && q.options.length > 0
  if (isMcq) {
    body += '<div style="margin:8px 0 0 6px">'
    for (const opt of q.options) {
      const isCorrect = answers && opt.label === q.correct_option
      body += `<div style="font-size:14px;line-height:1.7;${isCorrect ? 'color:#166534;font-weight:700' : 'color:#1f2937'}"><span style="font-weight:700;margin-right:8px">${esc(opt.label)})</span>${latexToHtml(opt.latex || '')}${isCorrect ? ' &nbsp;✓' : ''}</div>`
    }
    body += '</div>'
  }

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
        // Working space, scaled by the part's marks (more marks → more room).
        body += `<div style="height:${Math.max(80, (Number(p.marks) || 1) * 55)}px"></div>`
      }
    })
    body += '</div>'
  } else if (answers && q.solution_latex?.trim()) {
    body += `<div style="margin-top:8px;padding:8px 12px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px;font-size:14px;color:#166534"><span style="font-weight:700">Solution. </span>${latexToHtml(q.solution_latex)}</div>`
  } else if (!answers) {
    // MCQ needs no working space; extended questions get a blank area scaled by marks.
    body += `<div style="height:${isMcq ? 8 : Math.max(140, (Number(q.marks) || 1) * 55)}px"></div>`
  }

  const el = document.createElement('div')
  el.style.cssText = 'margin-bottom:18px;break-inside:avoid'
  el.innerHTML = `<div style="font-weight:700;font-size:15px;color:#062E63;margin-bottom:4px">${marks}Q${num}.</div>${body}`
  return el
}

function newPage() {
  const page = document.createElement('article')
  page.className = 'qbank-ws-page'
  page.style.cssText = `width:${PAGE_W}px;min-height:${PAGE_H}px;box-sizing:border-box;padding:${PAD}px;background:#fff;font-family:${FONT};font-weight:400;color:#1f2937`
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

export async function exportWorksheet({ title, subtitle, questions, includeMarks = true, answers = false, preview = false, renderTo = null }) {
  const htmlToImage = await import('html-to-image')
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
  const blocks = questions.map((q, i) => questionBlock(q, i, { includeMarks, answers }))
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
  let { page, inner } = newPage()
  inner.innerHTML = headerHtml(title, subtitle, answers)
  stage.appendChild(page)
  pages.push(page)
  let blocksOnPage = 0

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
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
  if (renderTo) return { pages }   // live preview — leave the pages on screen

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()

  const renderPage = (page, skipFonts) => htmlToImage.toJpeg(page, {
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

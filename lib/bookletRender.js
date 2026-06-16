/**
 * Booklet renderer — SINGLE source of truth for how a code-built booklet looks.
 * Used by both the on-screen preview and the PDF export so they can never drift.
 * Reproduces the CUBE Word template (X.MT.Content): cover, section headers,
 * subtopic headings, Formula/Note callouts, explanations, questions with
 * sample-solution boxes or writing lines, MCQs, answer tables and writing space.
 *
 * Everything here returns plain HTML strings + a CSS string, so it is framework
 * agnostic (the preview injects it; the exporter rasterises it).
 */
import { latexToHtml } from '../components/qbank/LatexContent'
import { qbankImageUrl } from './qbank'

// ── Block factory ─────────────────────────────────────────────────────────────
let _seq = 0
const uid = () => `b_${Date.now().toString(36)}_${(_seq++).toString(36)}`

export const BLOCK_TYPES = [
  { type: 'section',    label: 'Section header',  icon: '▢', group: 'Headings' },
  { type: 'subtopic',   label: 'Subtopic heading', icon: '—', group: 'Headings' },
  { type: 'definition', label: 'Definition',      icon: '§', group: 'Boxes' },
  { type: 'formula',    label: 'Formula',         icon: 'ƒ', group: 'Boxes' },
  { type: 'note',       label: 'Notes',           icon: '▤', group: 'Boxes' },
  { type: 'worked',     label: 'Worked Solution', icon: '✓', group: 'Boxes' },
  { type: 'steps',      label: 'Steps',           icon: '≡', group: 'Boxes' },
  { type: 'mcq',        label: 'MCQ',             icon: '◉', group: 'Questions' },
  { type: 'question',   label: 'Short answer',    icon: '✎', group: 'Questions' },
  { type: 'text',       label: 'Explanation',     icon: '¶', group: 'Other' },
  { type: 'writing',    label: 'Writing space',   icon: '≣', group: 'Other' },
  // 'mcqtable' is kept renderable for backward-compatibility but no longer in the palette.
]

export const BLOCK_GROUPS = ['Headings', 'Boxes', 'Questions', 'Other']

export function newBlock(type) {
  const base = { id: uid(), type }
  switch (type) {
    case 'section':  return { ...base, number: '', title: 'Section title' }
    case 'subtopic': return { ...base, title: 'Subtopic heading' }
    case 'formula':    return { ...base, title: 'Formula', body: '', image: '' }
    case 'note':       return { ...base, title: 'Note', body: '' }
    case 'definition': return { ...base, title: 'Definition', body: '', image: '' }
    case 'worked':     return { ...base, title: 'Worked Solution', body: '', image: '' }
    case 'steps':      return { ...base, title: 'Steps', body: '' }
    case 'text':     return { ...base, body: '', image: '' }
    case 'question': return { ...base, prompt: '', image: '', parts: [], marks: '', solution: '' }
    case 'mcq':      return { ...base, prompt: '', image: '', options: [{ k: 'A', t: '' }, { k: 'B', t: '' }, { k: 'C', t: '' }, { k: 'D', t: '' }], answer: '', explanation: '' }
    case 'mcqtable': return { ...base, title: 'MCQ Answers', rows: [{ q: '1', answer: '', explanation: '' }] }
    case 'writing':  return { ...base, title: '', lines: 6 }
    default:         return base
  }
}

// ── Text helpers ──────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Inline **bold** → <strong>. Applied after KaTeX so math is untouched.
function boldify(html) {
  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

// Rich text: newlines → paragraphs, "- " lines → bullet list, $...$ → KaTeX,
// **text** → bold.
function rich(body) {
  const text = String(body ?? '')
  if (!text.trim()) return ''
  const lines = text.split('\n')
  let html = ''
  let inList = false
  const closeList = () => { if (inList) { html += '</ul>'; inList = false } }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*[-•]\s+/.test(line)) {
      if (!inList) { html += '<ul class="bk-ul">'; inList = true }
      html += `<li>${boldify(latexToHtml(line.replace(/^\s*[-•]\s+/, '')))}</li>`
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      html += `<p class="bk-p">${boldify(latexToHtml(line))}</p>`
    }
  }
  closeList()
  return html
}

function imageHtml(path, cls = 'bk-img') {
  if (!path) return ''
  const url = qbankImageUrl(path)
  if (!url) return ''
  return `<div class="${cls}"><img src="${esc(url)}" alt="" /></div>`
}

const dottedLines = (n = 6) =>
  `<div class="bk-lines">${Array.from({ length: Math.max(1, n) }).map(() => '<div class="bk-line"></div>').join('')}</div>`

// ── Per-block HTML ────────────────────────────────────────────────────────────
function questionHtml(b, ctx) {
  const n = ctx.qNum
  const partsHtml = (b.parts && b.parts.length)
    ? `<div class="bk-parts">${b.parts.map((p, i) => `
        <div class="bk-part">
          <div class="bk-part-label">${String.fromCharCode(97 + i)}.</div>
          <div class="bk-part-body">${rich(p.prompt)}${imageHtml(p.image)}</div>
        </div>`).join('')}</div>`
    : ''
  const marks = b.marks ? `<span class="bk-marks">(${esc(b.marks)} mark${String(b.marks) === '1' ? '' : 's'})</span>` : ''
  const answer = ctx.solutions
    ? `<div class="bk-solbox"><p class="bk-sol-label">Sample solution or notes:</p><div class="bk-sol-body">${rich(b.solution) || '<span class="bk-muted">—</span>'}</div></div>`
    : dottedLines(b.parts && b.parts.length ? Math.max(4, b.parts.length * 3) : 6)
  return `<div class="bk-block bk-q">
    <p class="bk-q-title">Question ${n} ${marks}</p>
    ${b.prompt ? `<div class="bk-q-prompt">${rich(b.prompt)}</div>` : ''}
    ${imageHtml(b.image)}
    ${partsHtml}
    ${answer}
  </div>`
}

function mcqHtml(b, ctx) {
  const n = ctx.qNum
  const opts = (b.options || []).map(o => {
    const correct = ctx.solutions && b.answer && o.k === b.answer
    return `<div class="bk-opt ${correct ? 'bk-opt-correct' : ''}"><span class="bk-opt-k">${esc(o.k)}.</span> <span>${boldify(latexToHtml(o.t))}</span>${correct ? ' <span class="bk-tick">✓</span>' : ''}</div>`
  }).join('')
  const expl = ctx.solutions && b.explanation
    ? `<div class="bk-solbox"><p class="bk-sol-label">Answer: ${esc(b.answer)}</p><div class="bk-sol-body">${rich(b.explanation)}</div></div>` : ''
  return `<div class="bk-block bk-q">
    <p class="bk-q-title">Question ${n} <span class="bk-mcq-tag">MCQ</span></p>
    ${b.prompt ? `<div class="bk-q-prompt">${rich(b.prompt)}</div>` : ''}
    ${imageHtml(b.image)}
    <div class="bk-opts">${opts}</div>
    ${expl}
  </div>`
}

function mcqTableHtml(b, ctx) {
  const rows = (b.rows || []).map(r => `
    <tr>
      <td class="bk-mt-q">${esc(r.q)}</td>
      <td class="bk-mt-a">${ctx.solutions ? esc(r.answer) : ''}</td>
      <td class="bk-mt-e">${ctx.solutions ? rich(r.explanation) : ''}</td>
    </tr>`).join('')
  return `<div class="bk-block">
    <table class="bk-mt">
      <thead><tr><th>MCQ</th><th>Answer</th><th>Explanation</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

// Minimal monochrome line icons (inline SVG — render reliably in the PDF, unlike
// emoji/icon-fonts). √ for formulas, a note sheet for notes, a book for definitions.
function calloutIcon(type) {
  const a = 'fill="none" stroke="#2a2035" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'
  const inner = {
    formula:    `<path d="M3 12.5 l3 6.5 4 -15 H21" ${a}/>`,
    note:       `<rect x="5" y="3.5" width="14" height="17" rx="2" ${a}/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" ${a}/>`,
    definition: `<path d="M12 6c-2-1.4-5-1.4-8-1v13c3-.4 6-.4 8 1 2-1.4 5-1.4 8-1V5c-3-.4-6-.4-8 1z" ${a}/><path d="M12 6v13" ${a}/>`,
    worked:     `<path d="M4 12.5 l4 4 L20 5.5" ${a}/>`,
    steps:      `<circle cx="5" cy="6.5" r="1.4" fill="#2a2035"/><circle cx="5" cy="12" r="1.4" fill="#2a2035"/><circle cx="5" cy="17.5" r="1.4" fill="#2a2035"/><path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h7.5" ${a}/>`,
  }[type] || ''
  return `<span class="bk-callout-icon"><svg viewBox="0 0 24 24" width="15" height="15" xmlns="http://www.w3.org/2000/svg">${inner}</svg></span>`
}

function calloutBlock(type, title, inner, boxClass) {
  return `<div class="bk-block bk-callout-wrap"><div class="bk-callout-label">${calloutIcon(type)}${esc(title)}</div><div class="bk-callout ${boxClass}">${inner}</div></div>`
}

// Steps box: each non-empty line becomes a numbered step (any "1." the user
// typed is stripped to avoid double numbering).
function stepsHtml(body) {
  const lines = String(body ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return ''
  return `<ol class="bk-ol">${lines.map(l => `<li>${boldify(latexToHtml(l.replace(/^\s*\d+[.)]\s*/, '')))}</li>`).join('')}</ol>`
}

export function blockHtml(b, ctx) {
  switch (b.type) {
    case 'section':
      return `<div class="bk-block bk-section"><span class="bk-section-num">${esc(b.number)}</span><span class="bk-section-title">${esc(b.title)}</span></div>`
    case 'subtopic':
      return `<div class="bk-block bk-subtopic">${esc(b.title)}</div>`
    case 'formula':
      return calloutBlock('formula', b.title || 'Formula', `${rich(b.body)}${imageHtml(b.image, 'bk-img bk-img-center')}`, 'bk-callout-grey')
    case 'note':
      return calloutBlock('note', b.title || 'Note', rich(b.body), 'bk-callout-clear')
    case 'definition':
      return calloutBlock('definition', b.title || 'Definition', `${rich(b.body)}${imageHtml(b.image, 'bk-img bk-img-center')}`, 'bk-callout-grey')
    case 'worked':
      return calloutBlock('worked', b.title || 'Worked Solution', `${rich(b.body)}${imageHtml(b.image, 'bk-img bk-img-center')}`, 'bk-callout-white')
    case 'steps':
      return calloutBlock('steps', b.title || 'Steps', stepsHtml(b.body), 'bk-callout-tint')
    case 'text':
      return `<div class="bk-block bk-text">${rich(b.body)}${imageHtml(b.image, 'bk-img bk-img-center')}</div>`
    case 'question':  return questionHtml(b, ctx)
    case 'mcq':       return mcqHtml(b, ctx)
    case 'mcqtable':  return mcqTableHtml(b, ctx)
    case 'writing':
      return `<div class="bk-block bk-writing">${b.title ? `<p class="bk-writing-title">${esc(b.title)}</p>` : ''}${dottedLines(b.lines || 8)}</div>`
    default: return ''
  }
}

// ── Cover ─────────────────────────────────────────────────────────────────────
// Ink-light cover: white background with thin blue line-art only — a large
// outlined isometric cube, a couple of outline diamonds and two small accent
// bars. No solid panels or fills, so it prints cheaply but still looks designed.
// Simple, type-led cover: one calm accent — a pale disc with two thin concentric
// rings bleeding off the top-right corner — plus a header hairline. Very low ink.
// Minimal cover: white background, one thin brand rule, and a single outlined
// diamond holding the title. Type-led, very low ink.
const COVER_BG_SVG = `<svg viewBox="0 0 794 1123" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
  <rect x="0" y="0" width="794" height="5" fill="#325099"/>
  <polygon points="397,330 640,561 397,792 154,561" fill="none" stroke="#d7e1f3" stroke-width="1.5"/>
</svg>`

// Official CUBE cube mark (from Asset 20.svg). Rendered in any colour.
export function cubeMark(color) {
  return `<svg viewBox="0 0 697.82 777.12" xmlns="http://www.w3.org/2000/svg" fill="${color}" stroke="${color}" stroke-miterlimit="10">
    <path stroke-width="5" d="M608.72,638.56l41.59-24.01c27.85-16.08,45.01-45.8,45.01-77.97V235.2c0-28.86-15.39-55.52-40.39-69.95L393.96,14.57c-27.87-16.09-62.22-16.09-90.09,0l-41.56,23.99,306.35,176.87c24.79,14.31,40.06,40.76,40.06,69.38v353.75Z"/>
    <path stroke-width="5" d="M477,262.52L175.71,88.56,47.58,162.54C19.17,180.49,2.5,208.41,2.5,240.62v295.93c0,32.19,17.17,61.93,45.05,78.02l256.3,147.98c27.88,16.1,62.24,16.1,90.12,0l41.54-23.98,41.49-23.95c27.92-16.12,45.11-45.9,45.11-78.14v-295.82c0-32.24-17.2-62.02-45.11-78.14ZM435.51,628.34c0,6.33-3.38,12.18-8.86,15.34l-50.32,29.05c-16.97,9.8-37.88,9.8-54.85,0l-209.66-121.05c-14.06-8.12-22.72-23.12-22.72-39.35V250.65c0-7.48,3.76-13.48,10.47-18.13l65.77-37.97c6.41-3.7,14.31-3.7,20.73,0l239.23,138.12c6.32,3.65,10.22,10.4,10.22,17.7v277.98Z"/>
    <path stroke-width="3" d="M348.91,538.56v42.52c0,3.32-3.6,5.4-6.48,3.74l-162.69-93.93c-2.5-1.44-4.04-4.11-4.04-7v-186.26c0-4.03,4.37-6.55,7.86-4.54l78.74,45.46,82.69,47.74c2.42,1.4,3.91,3.98,3.91,6.77v45.49l-129.9-75v100l129.9,75Z"/>
  </svg>`
}
const COVER_LOGO = cubeMark('#cdd9f1')

export function coverHtml(meta, { solutions } = {}) {
  return `<div class="bk-cover">
    <div class="bk-cover-bg">${COVER_BG_SVG}</div>
    <div class="bk-cover-logo"><span class="bk-cover-mark">${COVER_LOGO}</span><span class="bk-cover-wordmark">CUBE TUITION</span></div>
    <div class="bk-cover-main">
      <div class="bk-cover-kicker">${solutions ? 'Solutions Booklet' : 'Student Booklet'}</div>
      <div class="bk-cover-subject">${esc(meta.subject || 'Mathematics')}</div>
      <div class="bk-cover-rule"></div>
      <div class="bk-cover-meta"><span class="bk-cover-year">Year ${esc(meta.year ?? '')}</span><span class="bk-cover-dot">·</span><span class="bk-cover-topic">${esc(meta.topic || '')}</span></div>
    </div>
    <div class="bk-cover-name"><span>Name</span><span class="bk-cover-nameline"></span></div>
    <div class="bk-cover-foot">CUBE Tuition · Chatswood</div>
  </div>`
}

export function footerHtml(pageNo) {
  return `<div class="bk-footer"><span class="bk-foot-l">© CUBE Tuition. All rights reserved.</span><span class="bk-foot-c">${pageNo ?? ''}</span><span class="bk-foot-r">Mathematics Booklet</span></div>`
}

// Assign running question numbers (question + mcq) in order, then render.
export function blocksToHtml(blocks, { solutions } = {}) {
  let qNum = 0
  return (blocks || []).map(b => {
    if (b.type === 'question' || b.type === 'mcq') qNum++
    return blockHtml(b, { solutions, qNum })
  }).join('')
}

// ── Stylesheet ────────────────────────────────────────────────────────────────
export const BOOKLET_CSS = `
.bk-root{ --ink:#1c1c1c; --blue:#5b7bc4; --grey:#e7e8ea; --rule:#333; font-family:'Avenir Next','Avenir','Segoe UI',system-ui,Helvetica,Arial,sans-serif; color:var(--ink); }
.bk-page{ position:relative; width:794px; min-height:1123px; background:#fff; padding:38px 48px 60px; box-sizing:border-box; overflow:hidden; }
.bk-page + .bk-page{ margin-top:24px; }
.bk-watermark{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; }
.bk-watermark svg{ height:360px; width:auto; opacity:.04; }
.bk-content{ position:relative; z-index:1; }
.bk-block{ margin:0 0 32px; }
/* Cover */
.bk-cover{ position:relative; width:794px; height:1123px; background:#fff; overflow:hidden; box-sizing:border-box; font-family:'Avenir Next','Avenir','Segoe UI',system-ui,Helvetica,Arial,sans-serif; }
.bk-cover-bg{ position:absolute; inset:0; }
.bk-cover-bg svg{ width:100%; height:100%; display:block; }
.bk-cover-logo{ position:absolute; left:64px; top:60px; z-index:2; display:flex; align-items:center; gap:12px; }
.bk-cover-mark{ height:40px; display:inline-flex; }
.bk-cover-mark svg{ height:100%; width:auto; display:block; }
.bk-cover-wordmark{ font-size:15px; letter-spacing:.4em; color:#dce4f5; font-weight:800; }
.bk-cover-main{ position:absolute; left:150px; right:150px; top:470px; z-index:2; text-align:center; }
.bk-cover-kicker{ font-size:12px; letter-spacing:.34em; text-transform:uppercase; color:#5b7bc4; font-weight:700; margin-bottom:18px; }
.bk-cover-subject{ font-size:60px; font-weight:800; color:#062E63; line-height:1; letter-spacing:-0.02em; }
.bk-cover-rule{ height:3px; width:80px; background:linear-gradient(90deg,#5b7bc4,#a8beec); margin:26px auto; border-radius:2px; }
.bk-cover-meta{ display:flex; justify-content:center; align-items:center; gap:12px; font-weight:400; }
.bk-cover-year{ font-size:26px; color:#2a2035; }
.bk-cover-dot{ font-size:13px; color:#a8beec; }
.bk-cover-topic{ font-size:26px; font-weight:600; color:#325099; }
.bk-cover-name{ position:absolute; left:64px; bottom:96px; z-index:2; display:flex; align-items:flex-end; gap:12px; font-size:16px; color:#dce4f5; }
.bk-cover-name span:first-child{ font-weight:600; }
.bk-cover-nameline{ display:inline-block; width:280px; border-bottom:1.5px solid #6f86b6; height:13px; }
.bk-cover-foot{ position:absolute; left:64px; bottom:56px; z-index:2; font-size:11px; letter-spacing:.26em; text-transform:uppercase; color:#9fb2d8; font-weight:600; }
/* Section header */
.bk-section{ background:#eef3fc; padding:28px 22px 28px 32px; display:flex; align-items:center; gap:30px; }
.bk-section-num{ font-size:27px; font-weight:700; color:#1f1f1f; }
.bk-section-title{ font-size:27px; font-weight:600; color:#1f1f1f; }
/* Subtopic — 16pt */
.bk-subtopic{ font-size:21px; font-weight:600; color:#1f1f1f; border-bottom:1px solid var(--rule); padding-bottom:6px; margin-top:6px; }
/* Callouts */
.bk-callout-wrap{ margin:28px 0 36px; }
.bk-callout-label{ display:flex; align-items:center; font-size:13px; color:#2a2035; line-height:1; margin-bottom:0; padding-bottom:1px; }
.bk-callout-icon{ display:inline-flex; align-items:center; margin-right:6px; }
.bk-callout-icon svg{ display:block; }
.bk-callout{ border-left:2.5px solid #2a2035; padding:16px 20px; }
.bk-callout-grey{ background:var(--grey); }
.bk-callout-white{ background:#fff; border:1px solid #cfcfcf; border-left:2.5px solid #2a2035; }
.bk-callout-clear{ background:transparent; border:1px solid #cfcfcf; border-left:2.5px solid #2a2035; }
.bk-callout-tint{ background:#eef3fc; }
/* keep inner top/bottom spacing equal to the box padding */
.bk-callout > :first-child, .bk-solbox > :first-child{ margin-top:0; }
.bk-callout > :last-child, .bk-solbox > :last-child{ margin-bottom:0; }
/* Text */
.bk-root strong, .bk-content strong, .bk-callout strong{ font-weight:600; }
.bk-p{ margin:0 0 8px; font-size:16px; line-height:1.55; }
.bk-ul{ list-style:disc outside; margin:4px 0 8px; padding-left:26px; }
.bk-ul li{ list-style:disc; display:list-item; font-size:16px; line-height:1.55; margin:2px 0; }
.bk-ul li::marker{ color:#2a2035; }
.bk-ol{ list-style:decimal outside; margin:2px 0 0; padding-left:28px; }
.bk-ol li{ list-style:decimal; display:list-item; font-size:16px; line-height:1.55; margin:5px 0; }
.bk-ol li::marker{ color:#2a2035; font-weight:600; }
.bk-img{ margin:12px 0; }
.bk-img img{ max-width:100%; }
.bk-img-center{ text-align:center; }
.bk-img-center img{ margin:0 auto; }
/* Questions */
.bk-q-title{ font-size:16px; font-weight:600; color:#1c1c1c; margin:0 0 6px; }
.bk-marks{ font-size:13px; font-weight:600; color:#555; }
.bk-mcq-tag{ font-size:11px; font-weight:700; color:#5b7bc4; border:1px solid #c9d6f0; border-radius:10px; padding:1px 7px; margin-left:4px; }
.bk-q-prompt{ font-size:16px; margin-bottom:6px; }
.bk-parts{ margin:6px 0; }
.bk-part{ display:flex; gap:10px; margin:8px 0; }
.bk-part-label{ font-weight:600; width:20px; }
.bk-part-body{ flex:1; }
.bk-opts{ margin:8px 0; }
.bk-opt{ font-size:16px; margin:4px 0; }
.bk-opt-k{ font-weight:700; margin-right:4px; }
.bk-opt-correct{ font-weight:600; }
.bk-tick{ color:#0a7d33; font-weight:700; }
/* Sample-solution box / writing lines */
.bk-solbox{ border:1px solid #c9c9c9; padding:12px 16px; margin-top:12px; }
.bk-sol-label{ font-style:italic; font-size:14px; color:#333; margin:0 0 6px; }
.bk-sol-body{ font-size:16px; }
.bk-muted{ color:#aaa; }
.bk-lines{ margin-top:12px; }
.bk-line{ border-bottom:1px dotted #9a9a9a; height:26px; }
.bk-writing-title{ font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:#777; font-weight:700; margin:0 0 6px; }
/* MCQ answer table */
.bk-mt{ width:100%; border-collapse:collapse; font-size:14px; }
.bk-mt th, .bk-mt td{ border:1px solid #cfcfcf; padding:7px 10px; text-align:left; vertical-align:top; }
.bk-mt th{ background:#f1f3f8; font-weight:700; }
.bk-mt-q{ width:60px; font-weight:600; }
.bk-mt-a{ width:80px; }
/* Footer */
.bk-footer{ position:absolute; left:48px; right:48px; bottom:28px; display:flex; justify-content:space-between; font-size:11px; color:#666; }
.bk-foot-l, .bk-foot-r{ font-style:italic; }
.katex{ font-size:1em; }
`

// Faint CUBE watermark — the official cube mark in light blue.
export const WATERMARK_SVG = cubeMark('#5b7bc4')

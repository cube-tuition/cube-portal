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
  { type: 'stimulus',   label: 'Stimulus text',   icon: '❝', group: 'Boxes' },
  { type: 'mcq',        label: 'MCQ',             icon: '◉', group: 'Questions' },
  { type: 'question',   label: 'Short answer',    icon: '✎', group: 'Questions' },
  { type: 'text',       label: 'Explanation',     icon: '¶', group: 'Other' },
  { type: 'image',      label: 'Image',           icon: '🖼', group: 'Other' },
  { type: 'mathobj',    label: 'Maths object',    icon: '📐', group: 'Other' },
  { type: 'writing',    label: 'Writing space',   icon: '≣', group: 'Other' },
  { type: 'table',      label: 'Table',           icon: '▦', group: 'Other' },
  { type: 'pagebreak',  label: 'New page',        icon: '⤓', group: 'Other' },
  // 'mcqtable' is kept renderable for backward-compatibility but no longer in the palette.
]

export const BLOCK_GROUPS = ['Headings', 'Boxes', 'Questions', 'Other']

export function newBlock(type) {
  const base = { id: uid(), type }
  switch (type) {
    case 'section':  return { ...base, number: '', title: 'Section title', syllabus: '', syllabus_points: [] }
    case 'subtopic': return { ...base, title: 'Subtopic heading' }
    case 'formula':    return { ...base, title: 'Formula', body: '', body2: '', twoCol: false, image: '' }
    case 'note':       return { ...base, title: 'Note', body: '', body2: '', twoCol: false }
    case 'definition': return { ...base, title: 'Definition', body: '', body2: '', twoCol: false, image: '' }
    case 'worked':     return { ...base, title: 'Worked Solution', body: '', body2: '', twoCol: false, image: '' }
    case 'steps':      return { ...base, title: 'Steps', heading: '', body: '' }
    case 'stimulus': return { ...base, title: '', source: '', body: '', image: '' }
    case 'text':     return { ...base, body: '', image: '' }
    case 'image':    return { ...base, image: '', caption: '', width: '' }
    case 'mathobj':  return {
      ...base, objType: 'cartesian', width: '60', pos: '',
      // cartesian
      xMin: '-5', xMax: '5', yMin: '-5', yMax: '5', grid: true, intercepts: true, points: [], lines: [],
      // number line
      nlMin: '0', nlMax: '10', nlStep: '1', nlPoints: '',
      // box plot — bpPlots rows on a shared axis (legacy single-plot bp* fields still render)
      bpTitle: '', bpUnits: '', bpPlots: [], bpMin: '', bpQ1: '', bpMed: '', bpQ3: '', bpMax: '', bpOutliers: '',
      // histogram — hgBars rows (legacy comma-separated hgValues/hgFreqs still render)
      hgTitle: '', hgBars: [], hgValues: '', hgFreqs: '', hgXLabel: '', hgYLabel: '',
      // table of values
      tbX: '0, 1, 2, 3', tbY: '', tbXLabel: 'x', tbYLabel: 'y',
      // stem-and-leaf plot
      slTitle: '', slData: '', slLeaf: '1', slHeaders: true,
    }
    case 'question': return { ...base, prompt: '', image: '', parts: [], marks: '', solution: '', solutionImage: '', lines: '' }
    case 'mcq':      return { ...base, prompt: '', image: '', options: [{ k: 'A', t: '' }, { k: 'B', t: '' }, { k: 'C', t: '' }, { k: 'D', t: '' }], answer: '', explanation: '', marks: '' }
    case 'mcqtable': return { ...base, title: 'MCQ Answers', rows: [{ q: '1', answer: '', explanation: '' }] }
    case 'writing':  return { ...base, title: '', lines: 6 }
    case 'table':    return { ...base, headerRow: false, width: '', align: '', colWidths: [], rows: [['', '', ''], ['', '', ''], ['', '', '']] }
    case 'pagebreak': return { ...base }
    default:         return base
  }
}

// ── Text helpers ──────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Inline formatting applied after KaTeX (so $…$ maths is untouched):
//   **bold** → <strong>,  ^sup^ → <sup> (e.g. Ca^2+^),  ~sub~ → <sub> (e.g. H~2~O)
function boldify(html) {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\^([^^\s][^^]*?)\^/g, '<sup>$1</sup>')
    .replace(/~([^~\s][^~]*?)~/g, '<sub>$1</sub>')
}

// Chemical-reaction arrows in plain text (outside $…$ maths):
//   ->  →  →     <-  →  ←     <-> / <=>  →  ⇌ (equilibrium)
const MATH_SEG = /(\$\$[^$]*\$\$|\$[^$]+\$)/
function chemArrows(s) {
  return String(s ?? '').split(MATH_SEG).map((seg, i) =>
    i % 2 === 1
      ? seg // a $…$ maths segment — leave untouched
      : seg.replace(/<=>|<-->|<->/g, '⇌').replace(/-->|->/g, '→').replace(/<--|<-/g, '←')
  ).join('')
}

// Rich text: newlines → paragraphs, "- " lines → bullet list (indent a "- " line
// with spaces/tab for a sub-dot-point — level 1 shows hollow circles), $...$ →
// KaTeX, **text** → bold.
function rich(body) {
  const text = String(body ?? '')
  if (!text.trim()) return ''
  const lines = text.split('\n')
  let html = ''
  let curLevel = -1   // current open bullet level (-1 = no list open)
  const closeList = () => { if (curLevel >= 0) { html += '</ul>'; curLevel = -1 } }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const bullet = line.match(/^(\s*)[-•]\s+(.*)$/)
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, '  ').length
      const level = Math.min(2, Math.floor(indent / 2))   // 0, 1 (sub), 2
      if (curLevel !== level) { closeList(); html += `<ul class="bk-ul bk-ul-${level}">`; curLevel = level }
      html += `<li>${boldify(latexToHtml(chemArrows(bullet[2])))}</li>`
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      // A line starting with "-> " is centred (Cmd/Ctrl-E in the editor).
      const centered = /^->\s?/.test(line)
      const content = centered ? line.replace(/^->\s?/, '') : line
      html += `<p class="bk-p${centered ? ' bk-center' : ''}">${boldify(latexToHtml(chemArrows(content)))}</p>`
    }
  }
  closeList()
  return html
}

function imageHtml(path, cls = 'bk-img', opts = {}) {
  if (!path) return ''
  // Allow direct URLs / public-folder paths / data URIs (e.g. level-test diagrams
  // served from /public) as well as qbank storage paths.
  const url = /^(https?:|data:|\/)/.test(path) ? path : qbankImageUrl(path)
  if (!url) return ''
  const w = Number(opts.width)
  const hasW = Number.isFinite(w) && w > 0 && w <= 100
  // Float layout: text wraps around the image; width is % of the container.
  if (opts.pos === 'left' || opts.pos === 'right') {
    return `<div class="bk-img-float bk-img-float-${opts.pos}"${hasW ? ` style="width:${w}%"` : ''}><img src="${esc(url)}" alt="" /></div>`
  }
  return `<div class="${cls}"><img src="${esc(url)}" alt=""${hasW ? ` style="width:${w}%"` : ''} /></div>`
}
// Layout opts for a block's own image (position + width come from the editor).
const imgOpts = (b) => ({ pos: b.imagePos, width: b.imageWidth })
const imgFloats = (b) => !!b.image && (b.imagePos === 'left' || b.imagePos === 'right')

// 0 lines is a real choice (e.g. "plot on the plane" questions) — render nothing.
const dottedLines = (n = 6) =>
  n > 0
    ? `<div class="bk-lines">${Array.from({ length: n }).map(() => '<div class="bk-line"></div>').join('')}</div>`
    : ''
// Answer-line count: blank/unset falls back to the default; an explicit 0 sticks.
const lineCount = (v, dflt) => {
  if (v === '' || v === null || v === undefined) return dflt
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : dflt
}
// Plain empty answer space, height given in cm (A4 page ≈ 1123px / 29.7cm).
const blankSpace = (cm) => {
  const n = Number(cm)
  if (!Number.isFinite(n) || n <= 0) return ''
  return `<div class="bk-answer-blank" style="height:${Math.round(n * 37.8)}px"></div>`
}
// Student-copy answer area for a question or part: maths object, blank space
// or dotted writing lines. answerType is authoritative; legacy rows without it
// are inferred from which fields are set.
const answerArea = (h, dfltLines) => {
  const t = h.answerType || (h.answerObj ? 'object' : (h.answerBlank ?? '') !== '' ? 'blank' : 'lines')
  if (t === 'object' && h.answerObj) return mathObjHtml(h.answerObj)
  if (t === 'blank') return blankSpace((h.answerBlank ?? '') === '' ? 4 : h.answerBlank)
  return dottedLines(lineCount(h.lines, dfltLines))
}

// ── Per-block HTML ────────────────────────────────────────────────────────────
// One sub-question (part): label, prompt/media, and its answer area — writing
// lines (student copy) or its own solution box (solutions copy).
function qPartHtml(p, i, ctx) {
  const partSol = `${rich(p.solution)}${imageHtml(p.solutionImage, 'bk-img bk-img-center')}${p.solutionMathObj ? mathObjHtml(p.solutionMathObj) : ''}`
  const partAnswer = ctx.solutions
    ? `<div class="bk-solbox bk-part-sol"><p class="bk-sol-label">Solution:</p><div class="bk-sol-body">${partSol || '<span class="bk-muted">—</span>'}</div></div>`
    : answerArea(p, 3)
  const partObj = p.mathObj ? mathObjHtml(p.mathObj) : ''
  const partObjFloats = !!p.mathObj && (p.mathObj.pos === 'left' || p.mathObj.pos === 'right')
  return `<div class="bk-part">
    <div class="bk-part-label">${String.fromCharCode(97 + i)}.</div>
    <div class="bk-part-body">${partObjFloats ? partObj : ''}${rich(p.prompt)}${imageHtml(p.image)}${partObjFloats ? '' : partObj}${partAnswer}</div>
  </div>`
}

// Question header: number/marks, floated media, prompt, non-floated media.
// Floated media goes before the prompt so text wraps around it.
function qHeadHtml(b, ctx) {
  const marks = (b.marks && !ctx?.hideMarks) ? `<span class="bk-marks">(${esc(b.marks)} mark${String(b.marks) === '1' ? '' : 's'})</span>` : ''
  const qImg = imageHtml(b.image, 'bk-img', imgOpts(b))
  const qObj = b.mathObj ? mathObjHtml(b.mathObj) : ''
  const qObjFloats = !!b.mathObj && (b.mathObj.pos === 'left' || b.mathObj.pos === 'right')
  return `<p class="bk-q-title">Question ${ctx.qNum} ${marks}</p>
    ${imgFloats(b) ? qImg : ''}${qObjFloats ? qObj : ''}
    ${b.prompt ? `<div class="bk-q-prompt">${rich(b.prompt)}</div>` : ''}
    ${imgFloats(b) ? '' : qImg}${qObjFloats ? '' : qObj}`
}

// Overall solution box for the whole question (solutions copy).
function qBottomAnswer(b, ctx) {
  const hasParts = !!(b.parts && b.parts.length)
  const solContent = `${rich(b.solution)}${imageHtml(b.solutionImage, 'bk-img bk-img-center')}`
  // Question-level answer: for single questions always; for multipart only when
  // an overall solution/notes was provided.
  return hasParts
    ? (ctx.solutions && solContent.trim()
        ? `<div class="bk-solbox"><p class="bk-sol-label">Sample solution or notes:</p><div class="bk-sol-body">${solContent}</div></div>`
        : '')
    : (ctx.solutions
        ? `<div class="bk-solbox"><p class="bk-sol-label">Sample solution or notes:</p><div class="bk-sol-body">${solContent || '<span class="bk-muted">—</span>'}</div></div>`
        : answerArea(b, 6))
}

function questionHtml(b, ctx) {
  const hasParts = !!(b.parts && b.parts.length)
  const partsCls = (Number(b.partsCols) === 2) ? 'bk-parts bk-parts-2col' : 'bk-parts'
  const partsHtml = hasParts
    ? `<div class="${partsCls}">${b.parts.map((p, i) => qPartHtml(p, i, ctx)).join('')}</div>`
    : ''
  return `<div class="bk-block bk-q">
    ${qHeadHtml(b, ctx)}
    ${partsHtml}
    ${qBottomAnswer(b, ctx)}
  </div>`
}

// Split rendering for a multi-part question that is taller than one A4 page:
// chunk 0 = header + part (a); each later chunk = one part in a continuation
// wrapper (the overall solution box rides on the last chunk). Paginators fall
// back to these chunks so an oversized question breaks between parts instead of
// stretching its page. Returns null when the block can't (or needn't) split.
export function questionChunksHtml(b, ctx) {
  if (!b || b.type !== 'question') return null
  const parts = b.parts || []
  if (parts.length < 2 || Number(b.partsCols) === 2) return null
  const bottom = qBottomAnswer(b, ctx)
  const bid = b.id ? ` data-bid="${esc(b.id)}"` : ''
  return parts.map((p, i) => {
    const inner = `<div class="bk-parts">${qPartHtml(p, i, ctx)}</div>${i === parts.length - 1 ? bottom : ''}`
    return i === 0
      ? `<div${bid} class="bk-block bk-q">${qHeadHtml(b, ctx)}${inner}</div>`
      : `<div${bid} class="bk-block bk-q bk-q-cont">${inner}</div>`
  })
}

// Stimulus / reading passage — an unnumbered boxed text (poem, extract,
// article) that the questions after it refer to. Lines are kept exactly as
// typed (verse keeps its shape); blank lines separate stanzas/paragraphs.
// $...$ maths and **bold** still work inside.
function stimulusBodyHtml(body) {
  const text = String(body ?? '')
  if (!text.trim()) return ''
  return text.split(/\n\s*\n/).map(st =>
    `<p class="bk-stim-stanza">${st.split('\n').map(l => boldify(latexToHtml(l))).join('<br>')}</p>`
  ).join('')
}

function stimulusHtml(b) {
  const title = (b.title || '').trim()
  const source = (b.source || '').trim()
  return `<div class="bk-block bk-stimulus">
    ${title ? `<p class="bk-stim-title">${boldify(latexToHtml(title))}</p>` : ''}
    ${source ? `<p class="bk-stim-source">${boldify(latexToHtml(source))}</p>` : ''}
    <div class="bk-stim-body">${stimulusBodyHtml(b.body)}</div>
    ${imageHtml(b.image, 'bk-img bk-img-center')}
  </div>`
}

function mcqHtml(b, ctx) {
  const n = ctx.qNum
  const opts = (b.options || []).map(o => {
    const correct = ctx.solutions && b.answer && o.k === b.answer
    return `<div class="bk-opt ${correct ? 'bk-opt-correct' : ''}"><span class="bk-opt-k">${esc(o.k)}.</span> <span>${boldify(latexToHtml(chemArrows(o.t)))}</span>${correct ? ' <span class="bk-tick">✓</span>' : ''}</div>`
  }).join('')
  const expl = ctx.solutions && b.explanation
    ? `<div class="bk-solbox"><p class="bk-sol-label">Answer: ${esc(b.answer)}</p><div class="bk-sol-body">${rich(b.explanation)}</div></div>` : ''
  const qObj = b.mathObj ? mathObjHtml(b.mathObj) : ''
  const qObjFloats = !!b.mathObj && (b.mathObj.pos === 'left' || b.mathObj.pos === 'right')
  return `<div class="bk-block bk-q">
    <p class="bk-q-title">Question ${n}</p>
    ${qObjFloats ? qObj : ''}
    ${b.prompt ? `<div class="bk-q-prompt">${rich(b.prompt)}</div>` : ''}
    ${imageHtml(b.image)}
    ${qObjFloats ? '' : qObj}
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
// emoji/icon-fonts). Clean, consistent 24-grid line glyphs at 1.6 stroke:
//   definition → open book · formula → equation token · note → document ·
//   worked → check-circle · steps → ordered list.
function calloutIcon(type) {
  const a = 'fill="none" stroke="#2a2035" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'
  const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="1.15" fill="#2a2035"/>`
  const inner = {
    // Open book with a soft spine.
    definition: `<path d="M12 7c-1.7-1.1-4.1-1.5-6.7-1.2A1 1 0 0 0 4.5 6.8v9.6a1 1 0 0 0 1.1 1c2.4-.3 4.7.1 6.4 1.1 1.7-1 4-1.4 6.4-1.1a1 1 0 0 0 1.1-1V6.8a1 1 0 0 0-.8-1C16.1 5.5 13.7 5.9 12 7z" ${a}/><path d="M12 7v11.6" ${a}/>`,
    // Equation token: a rounded tile with an equals sign.
    formula: `<rect x="3.5" y="4.5" width="17" height="15" rx="3.5" ${a}/><path d="M8 10.5h8M8 14h8" ${a}/>`,
    // Document with a folded corner and text lines.
    note: `<path d="M13.5 4H7a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V9z" ${a}/><path d="M13.5 4v4a1 1 0 0 0 1 1h4" ${a}/><path d="M9 13h6M9 16h4" ${a}/>`,
    // Check inside a circle.
    worked: `<circle cx="12" cy="12" r="8.3" ${a}/><path d="M8.4 12.3l2.5 2.5 4.7-5.2" ${a}/>`,
    // Ordered list: leading dots + lines.
    steps: `${dot(5, 6.5)}${dot(5, 12)}${dot(5, 17.5)}<path d="M9.5 6.5h9.5M9.5 12h9.5M9.5 17.5h7" ${a}/>`,
  }[type] || ''
  return `<span class="bk-callout-icon"><svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">${inner}</svg></span>`
}

function calloutBlock(type, title, inner, boxClass) {
  return `<div class="bk-block bk-callout-wrap"><div class="bk-callout-label">${calloutIcon(type)}${esc(title)}</div><div class="bk-callout ${boxClass}">${inner}</div></div>`
}

// Callout body: a single rich column, or — when twoCol is set — a left/right
// two-column split with a thin divider. Images and embedded maths objects sit
// beneath the text, or — with a float position — the text wraps around them.
function calloutBody(b, { image = true } = {}) {
  const img = image ? imageHtml(b.image, 'bk-img bk-img-center', imgOpts(b)) : ''
  const obj = b.mathObj ? mathObjHtml(b.mathObj) : ''
  const objFloats = !!b.mathObj && (b.mathObj.pos === 'left' || b.mathObj.pos === 'right')
  // Optional empty room at the bottom of the box (e.g. space for working).
  const blank = b.blankSpace != null ? blankSpace(b.blankSpace === '' ? 4 : b.blankSpace) : ''
  if (b.twoCol) {
    return `<div class="bk-callout-2col"><div>${rich(b.body)}</div><div>${rich(b.body2)}</div></div>${img}${obj}${blank}`
  }
  // Floated media must come before the text in the DOM for the wrap to work.
  const pre = `${(image && imgFloats(b)) ? img : ''}${objFloats ? obj : ''}`
  const post = `${(image && !imgFloats(b)) ? img : ''}${objFloats ? '' : obj}`
  return `${pre}${rich(b.body)}${post}${blank}`
}

// ── Maths objects — parameter-driven SVG (Cartesian plane, number line, box plot)
const numOr = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d }
// Points/lines are structured rows ([{x, y, label}] / [{m, c, label}]); legacy
// blocks stored them as "x, y, label"-per-line text, still accepted here.
const parseXYPoints = (v) => {
  const rows = Array.isArray(v)
    ? v.map(p => ({ x: Number(p.x), y: Number(p.y), label: String(p.label ?? '').trim() }))
    : String(v ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const parts = l.replace(/[()]/g, '').split(',').map(p => p.trim())
        return { x: Number(parts[0]), y: Number(parts[1]), label: parts.slice(2).join(', ') }
      })
  return rows.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
}
// Curves: rows of { eq, label } where eq is any expression in x ("y =" prefix
// optional). Older rows stored { m, c } (linear) or "m, c, label" text.
const parseCurveRows = (v) => {
  if (Array.isArray(v)) {
    return v.map(l => {
      if (l && typeof l === 'object' && l.eq !== undefined) return { eq: String(l.eq), label: String(l.label ?? '').trim() }
      if (l && typeof l === 'object') {
        const m = Number(l.m), c = Number(l.c)
        if (!Number.isFinite(m) || !Number.isFinite(c)) return null
        return { eq: `${m}x ${c < 0 ? '-' : '+'} ${Math.abs(c)}`, label: String(l.label ?? '').trim() }
      }
      return null
    }).filter(Boolean)
  }
  return String(v ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(',').map(p => p.trim())
    const m = Number(parts[0]), c = Number(parts[1])
    if (!Number.isFinite(m) || !Number.isFinite(c)) return null
    return { eq: `${m}x ${c < 0 ? '-' : '+'} ${Math.abs(c)}`, label: parts.slice(2).join(', ') }
  }).filter(Boolean)
}

// Compile an expression in x and y into a safe function f(x, y). Supports
// + - * / ^, parentheses, implicit multiplication (2x, xy, 2(x+1)),
// sqrt/abs/sin/cos/tan and pi. Returns null if the input doesn't parse.
function compileXY(src) {
  let e = String(src ?? '').toLowerCase().replace(/\s+/g, '')
  if (!e) return null
  e = e.replace(/π|pi/g, '(3.141592653589793)')
  // Function names → placeholder tokens so the whitelist and implicit-multiply
  // rules can't mangle them.
  e = e.replace(/sqrt/g, '#s').replace(/abs/g, '#a').replace(/sin/g, '#i').replace(/cos/g, '#o').replace(/tan/g, '#t')
  if (!/^[0-9xy+\-*/().^#saiot]*$/.test(e)) return null
  // Implicit multiplication: 2x, xy, 2(…), x(…), )(, )x, 2sqrt(…) etc.
  e = e.replace(/(\d|x|y|\))(?=(x|y|\(|#))/g, '$1*')
  e = e.replace(/\)(?=\d)/g, ')*')
  e = e.replace(/\^/g, '**')
  // Maths convention -x^2 = -(x^2); JS rejects bare "-x**2", so wrap it.
  e = e.replace(/-(x|y|\d+\.?\d*)\*\*(\([^()]*\)|x|y|\d+\.?\d*)/g, '-($1**$2)')
  e = e.replace(/#s/g, 'Math.sqrt').replace(/#a/g, 'Math.abs').replace(/#i/g, 'Math.sin').replace(/#o/g, 'Math.cos').replace(/#t/g, 'Math.tan')
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function('x', 'y', `"use strict"; return (${e});`)
    f(1, 1); f(0, 0)   // smoke-test — throws on stray identifiers
    return f
  } catch { return null }
}

// Interpret a curve input flexibly:
//  • "y = <expr in x>"  or a bare expression → explicit function of x
//  • anything with "=" (e.g. "x^2 + y^2 = 9") → implicit curve F(x,y) = 0
function compileCurve(src) {
  const e = String(src ?? '').toLowerCase().replace(/\s+/g, '')
  if (!e) return null
  const i = e.indexOf('=')
  if (i >= 0) {
    const lhs = e.slice(0, i), rhs = e.slice(i + 1)
    if ((lhs === 'y' || lhs === 'f(x)') && !rhs.includes('y')) {
      const f = compileXY(rhs)
      return f ? { kind: 'explicit', f: (x) => f(x, 0) } : null
    }
    const L = compileXY(lhs), R = compileXY(rhs)
    return (L && R) ? { kind: 'implicit', F: (x, y) => L(x, y) - R(x, y) } : null
  }
  if (e.includes('y')) return null
  const f = compileXY(e)
  return f ? { kind: 'explicit', f: (x) => f(x, 0) } : null
}

function cartesianSvg(b) {
  let xMin = numOr(b.xMin, -5), xMax = numOr(b.xMax, 5)
  let yMin = numOr(b.yMin, -5), yMax = numOr(b.yMax, 5)
  if (xMax <= xMin) xMax = xMin + 1
  if (yMax <= yMin) yMax = yMin + 1
  // Units per gridline (default 1) — lets real-data graphs (e.g. dollars per
  // week) use scales like 10 per square without a giant plane.
  const stepOf = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 1 }
  const xU = stepOf(b.xStep), yU = stepOf(b.yStep)
  const U = 34, PAD = 36
  const W = ((xMax - xMin) / xU) * U + PAD * 2, H = ((yMax - yMin) / yU) * U + PAD * 2
  const X = (x) => PAD + ((x - xMin) / xU) * U
  const Y = (y) => PAD + ((yMax - y) / yU) * U
  let s = ''
  if (b.grid !== false) {
    for (let x = xMin; x <= xMax + 1e-9; x += xU) s += `<line x1="${X(x)}" y1="${Y(yMax)}" x2="${X(x)}" y2="${Y(yMin)}" stroke="#c9c9c9" stroke-width="0.6"/>`
    for (let y = yMin; y <= yMax + 1e-9; y += yU) s += `<line x1="${X(xMin)}" y1="${Y(y)}" x2="${X(xMax)}" y2="${Y(y)}" stroke="#c9c9c9" stroke-width="0.6"/>`
  }
  // Axes sit on 0 when it's inside the range, otherwise on the nearest edge.
  const ax = Math.min(Math.max(0, xMin), xMax)
  const ay = Math.min(Math.max(0, yMin), yMax)
  s += `<line x1="${X(xMin) - 12}" y1="${Y(ay)}" x2="${X(xMax) + 12}" y2="${Y(ay)}" stroke="#222" stroke-width="1.5"/>`
  s += `<line x1="${X(ax)}" y1="${Y(yMin) + 12}" x2="${X(ax)}" y2="${Y(yMax) - 12}" stroke="#222" stroke-width="1.5"/>`
  s += `<path d="M ${X(xMax) + 12} ${Y(ay)} l -8 -4 v 8 z" fill="#222"/>`
  s += `<path d="M ${X(xMin) - 12} ${Y(ay)} l 8 -4 v 8 z" fill="#222"/>`
  s += `<path d="M ${X(ax)} ${Y(yMax) - 12} l -4 8 h 8 z" fill="#222"/>`
  s += `<path d="M ${X(ax)} ${Y(yMin) + 12} l -4 -8 h 8 z" fill="#222"/>`
  // Axis letters in the KaTeX maths-italic font, matching $x$/$y$ in the text.
  const axisFont = `font-family="KaTeX_Math, 'Times New Roman', serif" font-style="italic"`
  s += `<text x="${X(xMax) + 16}" y="${Y(ay) + 5}" font-size="15" ${axisFont} fill="#222">x</text>`
  s += `<text x="${X(ax) - 4}" y="${Y(yMax) - 21}" font-size="15" ${axisFont} fill="#222">y</text>`
  // Axis numbering + intercept coordinates are all gated by the
  // "Show intercept labels" toggle — unticked gives a number-free plane.
  const showNums = b.intercepts !== false
  const xLblStep = ((xMax - xMin) / xU) > 16 ? 2 * xU : xU
  const yLblStep = ((yMax - yMin) / yU) > 16 ? 2 * yU : yU
  const fmtTick = (v) => String(Math.round(v * 1000) / 1000)
  if (showNums) {
    for (let x = xMin; x <= xMax + 1e-9; x += xLblStep) if (Math.abs(x) > 1e-9) s += `<text x="${X(x)}" y="${Y(ay) + 14}" font-size="10.5" text-anchor="middle" fill="#555">${fmtTick(x)}</text>`
    for (let y = yMin; y <= yMax + 1e-9; y += yLblStep) if (Math.abs(y) > 1e-9) s += `<text x="${X(ax) - 6}" y="${Y(y) + 3.5}" font-size="10.5" text-anchor="end" fill="#555">${fmtTick(y)}</text>`
    if (xMin <= 0 && 0 <= xMax && yMin <= 0 && 0 <= yMax) s += `<text x="${X(0) - 6}" y="${Y(0) + 14}" font-size="11" ${axisFont} text-anchor="end" fill="#555">O</text>`
  }
  // Curves: any equation in x, sampled across the visible range. Segments
  // break at asymptotes / out-of-range values so hyperbolas draw correctly.
  const fmtN = (v) => String(Math.round(v * 100) / 100)
  // 1-D root finder along a line (used for axis-crossing labels).
  const rootsOf = (g, lo, hi, N = 240) => {
    const out = []
    const at = (t) => { try { const v = g(t); return Number.isFinite(v) ? v : NaN } catch { return NaN } }
    let pt = lo, pv = at(lo)
    for (let i = 1; i <= N; i++) {
      const t = lo + (i / N) * (hi - lo)
      const v = at(t)
      if (Number.isFinite(pv) && Number.isFinite(v)) {
        if ((pv < 0 && v > 0) || (pv > 0 && v < 0) || v === 0) {
          let a = pt, bx = t, fa = pv
          for (let k = 0; k < 30; k++) {
            const m = (a + bx) / 2, fm = at(m)
            if (!Number.isFinite(fm)) break
            if ((fa < 0 && fm < 0) || (fa > 0 && fm > 0)) { a = m; fa = fm } else bx = m
          }
          const r = (a + bx) / 2
          if (Math.abs(at(r)) < 0.05 && !out.some(q => Math.abs(q - r) < (hi - lo) / 100)) out.push(r)
        }
      }
      pt = t; pv = v
    }
    return out
  }
  // Intercept labels carry a white halo (paint-order stroke) and sit clear of
  // the axes so they stay readable over curves and gridlines.
  const xDot = (xi) => { s += `<circle cx="${X(xi)}" cy="${Y(0)}" r="3.4" fill="#0F766E"/><text x="${X(xi) + 8}" y="${Y(0) + 18}" font-size="11" font-weight="bold" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" fill="#0F766E">(${fmtN(xi)}, 0)</text>` }
  const yDot = (yi) => { s += `<circle cx="${X(0)}" cy="${Y(yi)}" r="3.4" fill="#0F766E"/><text x="${X(0) + 9}" y="${Y(yi) - 8}" font-size="11" font-weight="bold" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" fill="#0F766E">(0, ${fmtN(yi)})</text>` }

  for (const cv of parseCurveRows(b.lines)) {
    const cur = compileCurve(cv.eq)
    if (!cur) continue

    if (cur.kind === 'explicit') {
      const f = cur.f
      const N = 240, yPad = (yMax - yMin) * 0.02
      const evalAt = (x) => { try { const y = f(x); return Number.isFinite(y) ? y : NaN } catch { return NaN } }
      const segs = []
      let seg = []
      for (let i = 0; i <= N; i++) {
        const x = xMin + (i / N) * (xMax - xMin)
        const y = evalAt(x)
        if (Number.isFinite(y) && y >= yMin - yPad && y <= yMax + yPad) {
          seg.push([x, Math.max(yMin, Math.min(yMax, y))])
        } else if (seg.length) { segs.push(seg); seg = [] }
      }
      if (seg.length) segs.push(seg)
      for (const sg of segs) {
        if (sg.length < 2) continue
        const pts = sg.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')
        s += `<polyline points="${pts}" fill="none" stroke="#325099" stroke-width="1.8" stroke-linejoin="round"/>`
      }
      const lastSeg = segs[segs.length - 1]
      const end = lastSeg && lastSeg[lastSeg.length - 1]
      if (cv.label && end) s += `<text x="${X(end[0]) - 4}" y="${Y(end[1]) - 7}" font-size="11.5" font-weight="bold" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" fill="#325099" text-anchor="end">${esc(cv.label)}</text>`
      if (showNums) {
        const y0 = (0 >= xMin && 0 <= xMax) ? evalAt(0) : NaN
        const yIntAtOrigin = Number.isFinite(y0) && Math.abs(y0) < 1e-9
        if (Number.isFinite(y0) && y0 >= yMin && y0 <= yMax) yDot(y0)
        if (0 >= yMin && 0 <= yMax) {
          for (const r of rootsOf(evalAt, xMin, xMax)) {
            if (yIntAtOrigin && Math.abs(r) < 1e-6) continue   // origin already labelled
            if (r >= xMin && r <= xMax) xDot(r)
          }
        }
      }
      continue
    }

    // Implicit curve F(x, y) = 0 (circles, ellipses…): marching squares over
    // the visible grid.
    const F = cur.F
    const Fat = (x, y) => { try { const v = F(x, y); return Number.isFinite(v) ? v : NaN } catch { return NaN } }
    const NX = 110, NY = 110
    const gx = (i) => xMin + (i / NX) * (xMax - xMin)
    const gy = (j) => yMin + (j / NY) * (yMax - yMin)
    const grid = []
    for (let j = 0; j <= NY; j++) { const row = []; for (let i = 0; i <= NX; i++) row.push(Fat(gx(i), gy(j))); grid.push(row) }
    const lerp = (p1, p2, v1, v2) => { const t = v1 === v2 ? 0.5 : v1 / (v1 - v2); return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] }
    let labelPt = null
    let paths = ''
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const v = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
        if (v.some(x => !Number.isFinite(x))) continue
        const c = [[gx(i), gy(j)], [gx(i + 1), gy(j)], [gx(i + 1), gy(j + 1)], [gx(i), gy(j + 1)]]
        const crossings = []
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) % 4
          if ((v[k] < 0 && v[k2] >= 0) || (v[k] >= 0 && v[k2] < 0)) crossings.push(lerp(c[k], c[k2], v[k], v[k2]))
        }
        if (crossings.length >= 2) {
          for (let k = 0; k + 1 < crossings.length; k += 2) {
            const [p, q] = [crossings[k], crossings[k + 1]]
            paths += `M ${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)} L ${X(q[0]).toFixed(1)} ${Y(q[1]).toFixed(1)} `
            if (!labelPt || p[0] > labelPt[0]) labelPt = p
          }
        }
      }
    }
    if (paths) s += `<path d="${paths}" fill="none" stroke="#325099" stroke-width="1.8" stroke-linecap="round"/>`
    if (cv.label && labelPt) s += `<text x="${X(labelPt[0]) + 6}" y="${Y(labelPt[1]) - 6}" font-size="11.5" font-weight="bold" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" fill="#325099">${esc(cv.label)}</text>`
    if (showNums && paths) {
      // Axis crossings of the implicit curve, capped to keep the plane readable.
      const xr = (0 >= yMin && 0 <= yMax) ? rootsOf((x) => Fat(x, 0), xMin, xMax) : []
      const yr = (0 >= xMin && 0 <= xMax) ? rootsOf((y) => Fat(0, y), yMin, yMax) : []
      for (const r of xr.slice(0, 4)) if (Math.abs(r) > 1e-6) xDot(r)
      for (const r of yr.slice(0, 4)) if (Math.abs(r) > 1e-6) yDot(r)
    }
  }
  for (const p of parseXYPoints(b.points)) {
    s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.6" fill="#B23A3A"/>`
    if (p.label) s += `<text x="${X(p.x) + 6}" y="${Y(p.y) - 6}" font-size="11.5" font-weight="bold" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" fill="#B23A3A">${esc(p.label)}</text>`
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" style="height:auto">${s}</svg>`
}

function numberlineSvg(b) {
  const min = numOr(b.nlMin, 0), max0 = numOr(b.nlMax, 10)
  const max = max0 > min ? max0 : min + 1
  const step = Math.abs(numOr(b.nlStep, 1)) || 1
  const units = (max - min) / step
  const U = Math.max(28, Math.min(64, 480 / units))
  const PAD = 40, W = units * U + PAD * 2, H = 84, Ly = 52
  const X = (v) => PAD + ((v - min) / step) * U
  let s = `<line x1="${PAD - 16}" y1="${Ly}" x2="${W - PAD + 16}" y2="${Ly}" stroke="#222" stroke-width="1.5"/>`
  s += `<path d="M ${W - PAD + 16} ${Ly} l -8 -4 v 8 z" fill="#222"/>`
  s += `<path d="M ${PAD - 16} ${Ly} l 8 -4 v 8 z" fill="#222"/>`
  const dp = String(step).includes('.') ? String(step).split('.')[1].length : 0
  for (let i = 0; i <= Math.round(units); i++) {
    const v = min + i * step
    s += `<line x1="${X(v)}" y1="${Ly - 6}" x2="${X(v)}" y2="${Ly + 6}" stroke="#222" stroke-width="1.2"/>`
    s += `<text x="${X(v)}" y="${Ly + 22}" font-size="11" text-anchor="middle" fill="#555">${v.toFixed(dp)}</text>`
  }
  // Marked values: "value[, label]" one per line
  for (const l of String(b.nlPoints ?? '').split('\n').map(x => x.trim()).filter(Boolean)) {
    const parts = l.split(',').map(p => p.trim())
    const v = Number(parts[0])
    if (!Number.isFinite(v) || v < min || v > max) continue
    s += `<circle cx="${X(v)}" cy="${Ly}" r="4" fill="#B23A3A"/>`
    if (parts[1]) s += `<text x="${X(v)}" y="${Ly - 14}" font-size="11.5" font-weight="bold" text-anchor="middle" fill="#B23A3A">${esc(parts.slice(1).join(', '))}</text>`
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" style="height:auto">${s}</svg>`
}

// One or more box plots stacked on a shared axis. New blocks store
// bpPlots [{label, min, q1, med, q3, max, outliers}]; blocks from before
// multi-plot support fall back to the legacy single-plot bp* fields.
// Outliers are comma-separated values drawn as × marks; labels sit to the
// right of each plot; an optional title is centred above the plot area.
function boxplotSvg(b) {
  const raw = Array.isArray(b.bpPlots) && b.bpPlots.length
    ? b.bpPlots
    : [{ label: '', min: b.bpMin, q1: b.bpQ1, med: b.bpMed, q3: b.bpQ3, max: b.bpMax, outliers: b.bpOutliers }]
  const plots = raw.map(p => ({
    v: [numOr(p.min, 0), numOr(p.q1, 2), numOr(p.med, 5), numOr(p.q3, 7), numOr(p.max, 10)].sort((a, c) => a - c),
    outliers: String(p.outliers || '').split(',').map(t => parseFloat(t.trim())).filter(Number.isFinite),
    label: String(p.label || '').trim(),
  }))
  const lo = Math.min(...plots.flatMap(p => [p.v[0], ...p.outliers]))
  const hi = Math.max(...plots.flatMap(p => [p.v[4], ...p.outliers]))
  const span = Math.max(hi - lo, 1)
  // A padded "nice" axis: step of 1/2/5×10ⁿ giving ~8 ticks.
  const rawStep = span / 8
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const step = [1, 2, 5, 10].map(k => k * pow).find(k => k >= rawStep) || pow * 10
  // Clamp at zero when the data never goes negative (score-style axes).
  const aMin = Math.max(lo >= 0 ? 0 : -Infinity, Math.floor((lo - span * 0.08) / step) * step)
  const aMax = Math.ceil((hi + span * 0.08) / step) * step
  const title = String(b.bpTitle || '').trim()
  const units = String(b.bpUnits || '').trim()   // axis label under the numbers, e.g. "Score %"
  const TH = title ? 24 : 0
  const LW = plots.some(p => p.label) ? 84 : 0   // right margin for plot labels
  const n = plots.length
  const boxH = n > 1 ? 34 : 40
  const rowH = boxH + 24
  const top0 = TH + 16
  const PAD = 44, W = 520
  const Ly = top0 + n * rowH + 2
  const H = Ly + 34 + (units ? 22 : 0)
  const X = (x) => PAD + ((x - aMin) / (aMax - aMin)) * (W - PAD * 2 - LW)
  let s = ''
  if (title) s += `<text x="${(W - LW) / 2}" y="16" font-size="13.5" font-weight="bold" text-anchor="middle" fill="#1c1c1c">${esc(title)}</text>`
  plots.forEach((p, i) => {
    const [mn, q1, med, q3, mx] = p.v
    const boxTop = top0 + i * rowH, boxBot = boxTop + boxH, mid = (boxTop + boxBot) / 2
    // whiskers
    s += `<line x1="${X(mn)}" y1="${mid}" x2="${X(q1)}" y2="${mid}" stroke="#222" stroke-width="1.4"/>`
    s += `<line x1="${X(q3)}" y1="${mid}" x2="${X(mx)}" y2="${mid}" stroke="#222" stroke-width="1.4"/>`
    s += `<line x1="${X(mn)}" y1="${boxTop + 8}" x2="${X(mn)}" y2="${boxBot - 8}" stroke="#222" stroke-width="1.4"/>`
    s += `<line x1="${X(mx)}" y1="${boxTop + 8}" x2="${X(mx)}" y2="${boxBot - 8}" stroke="#222" stroke-width="1.4"/>`
    // box + median
    s += `<rect x="${X(q1)}" y="${boxTop}" width="${X(q3) - X(q1)}" height="${boxH}" fill="#EEF4FF" stroke="#222" stroke-width="1.4"/>`
    s += `<line x1="${X(med)}" y1="${boxTop}" x2="${X(med)}" y2="${boxBot}" stroke="#222" stroke-width="1.8"/>`
    // outliers as × marks on the whisker line
    for (const o of p.outliers) {
      const r = 4.5
      s += `<path d="M ${X(o) - r} ${mid - r} L ${X(o) + r} ${mid + r} M ${X(o) - r} ${mid + r} L ${X(o) + r} ${mid - r}" stroke="#222" stroke-width="1.6" stroke-linecap="round"/>`
    }
    if (p.label) s += `<text x="${W - PAD - LW + 26}" y="${mid + 4.5}" font-size="12.5" fill="#1c1c1c">${esc(p.label)}</text>`
  })
  // axis
  s += `<line x1="${PAD - 14}" y1="${Ly}" x2="${W - PAD - LW + 14}" y2="${Ly}" stroke="#222" stroke-width="1.3"/>`
  s += `<path d="M ${W - PAD - LW + 14} ${Ly} l -8 -4 v 8 z" fill="#222"/>`
  const dp = String(step).includes('.') ? Math.min(2, String(step).split('.')[1].length) : 0
  for (let t = aMin; t <= aMax + 1e-9; t += step) {
    s += `<line x1="${X(t)}" y1="${Ly - 5}" x2="${X(t)}" y2="${Ly + 5}" stroke="#222" stroke-width="1"/>`
    s += `<text x="${X(t)}" y="${Ly + 20}" font-size="11" text-anchor="middle" fill="#555">${t.toFixed(dp)}</text>`
  }
  if (units) s += `<text x="${(W - LW) / 2}" y="${Ly + 40}" font-size="13" text-anchor="middle" fill="#1c1c1c">${esc(units)}</text>`
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" style="height:auto">${s}</svg>`
}

// Histogram: touching bars over class labels, frequency up the y-axis.
// Bars come from hgBars rows [{label, freq}]; blocks saved before per-row
// editing fall back to the legacy comma-separated hgValues/hgFreqs pair.
// Optional title above, axis labels (y defaults to "Frequency").
function histogramSvg(b) {
  let bars
  if (Array.isArray(b.hgBars) && b.hgBars.length) {
    bars = b.hgBars.map(x => ({ label: String(x.label ?? '').trim(), f: parseFloat(x.freq) }))
  } else {
    const labels = String(b.hgValues || '').split(',').map(t => t.trim())
    const rawF = String(b.hgFreqs || '').split(',').map(t => parseFloat(t.trim()))
    const m = Math.max(labels.filter(l => l !== '').length, rawF.filter(Number.isFinite).length)
    bars = Array.from({ length: m }, (_, i) => ({ label: labels[i] ?? '', f: rawF[i] }))
  }
  const n = bars.length
  if (!n) return ''
  const f = bars.map(x => (Number.isFinite(x.f) ? Math.max(0, x.f) : 0))
  const fMax = Math.max(...f, 1)
  // Nice y step: 1/2/5×10ⁿ giving ≤ ~6 ticks.
  const rawStep = fMax / 5
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const yStep = [1, 2, 5, 10].map(k => k * pow).find(k => k >= rawStep) || pow * 10
  const yMax = Math.ceil(fMax / yStep) * yStep
  const title = String(b.hgTitle || '').trim()
  const xLab = String(b.hgXLabel || '').trim()
  const yLab = String(b.hgYLabel || '').trim() || 'Frequency'
  const TH = title ? 24 : 0
  const W = 520, PADL = 64, PADR = 26
  const plotH = 150
  const top = TH + 14
  const axisY = top + plotH
  const H = axisY + 26 + (xLab ? 22 : 0)
  const bw = (W - PADL - PADR) / n
  const Y = (v) => axisY - (v / yMax) * plotH
  let s = ''
  if (title) s += `<text x="${(PADL + W - PADR) / 2}" y="16" font-size="13.5" font-weight="bold" text-anchor="middle" fill="#1c1c1c">${esc(title)}</text>`
  // y gridlines, ticks + numbers
  const dp = String(yStep).includes('.') ? Math.min(2, String(yStep).split('.')[1].length) : 0
  for (let t = 0; t <= yMax + 1e-9; t += yStep) {
    if (t > 0) s += `<line x1="${PADL}" y1="${Y(t)}" x2="${W - PADR}" y2="${Y(t)}" stroke="#e0e3ea" stroke-width="0.8"/>`
    s += `<line x1="${PADL - 5}" y1="${Y(t)}" x2="${PADL}" y2="${Y(t)}" stroke="#222" stroke-width="1"/>`
    s += `<text x="${PADL - 10}" y="${Y(t) + 4}" font-size="11" text-anchor="end" fill="#555">${t.toFixed(dp)}</text>`
  }
  // bars (touching, histogram-style)
  f.forEach((v, i) => {
    if (v <= 0) return
    const x = PADL + i * bw
    s += `<rect x="${x}" y="${Y(v)}" width="${bw}" height="${axisY - Y(v)}" fill="#EEF4FF" stroke="#222" stroke-width="1.4"/>`
  })
  // axes
  s += `<line x1="${PADL}" y1="${top - 6}" x2="${PADL}" y2="${axisY}" stroke="#222" stroke-width="1.3"/>`
  s += `<line x1="${PADL}" y1="${axisY}" x2="${W - PADR + 6}" y2="${axisY}" stroke="#222" stroke-width="1.3"/>`
  // x labels centred under each bar
  bars.forEach((x, i) => {
    if (x.label) s += `<text x="${PADL + i * bw + bw / 2}" y="${axisY + 17}" font-size="11" text-anchor="middle" fill="#555">${esc(x.label)}</text>`
  })
  if (xLab) s += `<text x="${(PADL + W - PADR) / 2}" y="${H - 6}" font-size="12.5" text-anchor="middle" fill="#1c1c1c">${esc(xLab)}</text>`
  s += `<text transform="rotate(-90 16 ${(top + axisY) / 2})" x="16" y="${(top + axisY) / 2 + 4}" font-size="12.5" text-anchor="middle" fill="#1c1c1c">${esc(yLab)}</text>`
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" style="height:auto">${s}</svg>`
}

// Table of values: an x-row and y-row rendered as the classic bordered table.
// Values are comma-separated; cells support $…$ maths.
function xyTableHtml(o) {
  const parse = (t) => String(t ?? '').split(',').map(s => s.trim())
  const xs = parse(o.tbX), ys = parse(o.tbY)
  const n = Math.max(xs.length, ys.length)
  if (!n || (xs.every(v => v === '') && ys.every(v => v === ''))) return ''
  const varCell = (v) => `<td class="bk-xyt-var">${latexToHtml(`$${(v || '').trim() || 'x'}$`)}</td>`
  const valCell = (v) => `<td>${boldify(latexToHtml(chemArrows(v ?? '')))}</td>`
  const row = (label, vals) => `<tr>${varCell(label)}${Array.from({ length: n }).map((_, i) => valCell(vals[i] ?? '')).join('')}</tr>`
  return `<table class="bk-xyt">${row(o.tbXLabel || 'x', xs)}${row(o.tbYLabel || 'y', ys)}</table>`
}

// Stem-and-leaf plot from raw data. Each value is split into a stem (all but
// the last leaf-digit) and a leaf; leaves sit sorted beside their stem, and
// stems with no data still show (standard convention). The "leaf place" scales
// where the split falls so tens (2|3 = 230) and decimals (2|3 = 2.3) work too.
// Renders as a bordered HTML table + a key line, not an SVG.
function stemLeafHtml(o) {
  const nums = String(o.slData ?? '').split(/[\s,]+/).map(t => t.trim()).filter(Boolean)
    .map(Number).filter(Number.isFinite)
  if (!nums.length) return ''
  const p = Number(o.slLeaf) > 0 ? Number(o.slLeaf) : 1     // leaf place value (1 = units)
  const scaled = nums.map(v => Math.round(v / p))            // value counted in leaf-units
  const stemOf = (s) => Math.floor(s / 10)
  const leafOf = (s) => ((s % 10) + 10) % 10
  const sorted = [...scaled].sort((a, b) => a - b)
  const minStem = stemOf(sorted[0]), maxStem = stemOf(sorted[sorted.length - 1])
  const rows = []
  for (let st = minStem; st <= maxStem; st++) {
    rows.push({ stem: st, leaves: sorted.filter(s => stemOf(s) === st).map(leafOf) })
  }
  const dp = p < 1 ? (String(p).split('.')[1] || '').length : 0
  const first = rows.find(r => r.leaves.length) || rows[0]
  const keyStem = first.stem, keyLeaf = first.leaves[0] ?? 0
  const keyVal = ((keyStem * 10 + keyLeaf) * p).toFixed(dp)
  const title = String(o.slTitle || '').trim()
  const head = o.slHeaders !== false
    ? `<tr><th>Stem</th><th>Leaf</th></tr>` : ''
  const body = rows.map(r =>
    `<tr><td class="bk-slp-stem">${r.stem}</td><td class="bk-slp-leaf">${r.leaves.join(' ')}</td></tr>`
  ).join('')
  return `${title ? `<div class="bk-slp-title">${esc(title)}</div>` : ''}` +
    `<table class="bk-slp">${head}${body}</table>` +
    `<div class="bk-slp-key">Key: ${keyStem} | ${keyLeaf} = ${keyVal}</div>`
}

function mathObjectSvg(b) {
  if (b.objType === 'numberline') return numberlineSvg(b)
  if (b.objType === 'boxplot') return boxplotSvg(b)
  if (b.objType === 'histogram') return histogramSvg(b)
  if (b.objType === 'xytable') return xyTableHtml(b)
  if (b.objType === 'stemleaf') return stemLeafHtml(b)
  return cartesianSvg(b)
}

// Wrap a maths object for layout: centred at its width %, or floated so the
// surrounding text wraps. `topLevel` adds bk-block (standalone palette block);
// without it the same markup embeds inside callout boxes.
function mathObjHtml(o, topLevel = false) {
  const w = Number(o.width)
  const wPct = Number.isFinite(w) && w > 0 && w <= 100 ? w : 60
  const blockCls = topLevel ? 'bk-block ' : ''
  if (o.pos === 'left' || o.pos === 'right') {
    return `<div class="${blockCls}bk-img-float bk-img-float-${o.pos} bk-mathobj-floatblock" style="width:${wPct}%">${mathObjectSvg(o)}</div>`
  }
  return `<div class="${blockCls}bk-mathobj"><div class="bk-mathobj-inner" style="width:${wPct}%">${mathObjectSvg(o)}</div></div>`
}

// Steps box: each non-empty line becomes a numbered step (any "1." the user
// typed is stripped to avoid double numbering).
function stepsHtml(body) {
  const lines = String(body ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return ''
  return `<ol class="bk-ol">${lines.map(l => `<li>${boldify(latexToHtml(l.replace(/^\s*\d+[.)]\s*/, '')))}</li>`).join('')}</ol>`
}

// Public renderer: tags the root element with the source block id (data-bid)
// so the builder's live preview can map a double-click back to its block card.
export function blockHtml(b, ctx) {
  const html = blockBodyHtml(b, ctx)
  if (!html || !b?.id) return html
  return html.replace('<div', `<div data-bid="${esc(b.id)}"`)
}

function blockBodyHtml(b, ctx) {
  switch (b.type) {
    case 'section': {
      // Syllabus dotpoints drawn from the master list (per section) print as a
      // band beneath the header. `b.syllabus` is generated from b.syllabus_points.
      // Maths booklets suppress the band (ctx.hideSectionSyllabus) — the points
      // still drive coverage, they just don't print under the heading.
      const syllabus = (!ctx?.hideSectionSyllabus && b.syllabus && b.syllabus.trim())
        ? `<div class="bk-section-syllabus">${rich(b.syllabus)}</div>` : ''
      // Titles support $…$ maths (latexToHtml escapes the plain-text parts).
      return `<div class="bk-block bk-section-wrap"><div class="bk-section"><span class="bk-section-num">${esc(b.number)}</span><span class="bk-section-title">${latexToHtml(b.title)}</span></div>${syllabus}</div>`
    }
    case 'subtopic':
      return `<div class="bk-block bk-subtopic">${latexToHtml(b.title)}</div>`
    // Callout labels are fixed per block type (the editable label field was
    // removed — any stored custom title is ignored).
    case 'formula':
      return calloutBlock('formula', 'Formula', calloutBody(b), 'bk-callout-tint')
    case 'note':
      return calloutBlock('note', 'Note', calloutBody(b, { image: false }), 'bk-callout-clear')
    case 'definition':
      return calloutBlock('definition', 'Definition', calloutBody(b), 'bk-callout-tint')
    case 'worked':
      return calloutBlock('worked', 'Worked Solution', calloutBody(b), 'bk-callout-white')
    case 'steps': {
      const stepsHead = (b.heading || '').trim()
        ? `<p class="bk-steps-heading">${boldify(latexToHtml(b.heading.trim()))}</p>` : ''
      return calloutBlock('steps', 'Steps', `${stepsHead}${stepsHtml(b.body)}${b.mathObj ? mathObjHtml(b.mathObj) : ''}${b.blankSpace != null ? blankSpace(b.blankSpace === '' ? 4 : b.blankSpace) : ''}`, 'bk-callout-tint')
    }
    case 'text': {
      const tImg = imageHtml(b.image, 'bk-img bk-img-center', imgOpts(b))
      return `<div class="bk-block bk-text">${imgFloats(b) ? tImg : ''}${rich(b.body)}${imgFloats(b) ? '' : tImg}</div>`
    }
    case 'mathobj':
      // Code-generated maths object (Cartesian plane / number line / box plot).
      return mathObjHtml(b, true)
    case 'image': {
      // Standalone image with optional caption, width (% of page) and alignment.
      if (!b.image) return ''
      const w = Number(b.width)
      const style = Number.isFinite(w) && w > 0 && w <= 100 ? ` style="width:${w}%"` : ''
      const cap = (b.caption || '').trim() ? `<p class="bk-img-caption">${boldify(latexToHtml(b.caption))}</p>` : ''
      const url = /^(https?:|data:|\/)/.test(b.image) ? b.image : qbankImageUrl(b.image)
      const align = b.align === 'left' ? 'bk-img-left' : b.align === 'right' ? 'bk-img-right' : 'bk-img-center'
      return `<div class="bk-block bk-img ${align} bk-img-block"><img src="${esc(url || '')}" alt=""${style} />${cap}</div>`
    }
    case 'stimulus':  return stimulusHtml(b)
    case 'question':  return questionHtml(b, ctx)
    case 'mcq':       return mcqHtml(b, ctx)
    case 'mcqtable':  return mcqTableHtml(b, ctx)
    case 'writing':
      return `<div class="bk-block bk-writing">${b.title ? `<p class="bk-writing-title">${esc(b.title)}</p>` : ''}${dottedLines(b.lines || 8)}</div>`
    case 'table':     return tableHtml(b)
    case 'pagebreak': return ''   // handled by the paginator, renders nothing itself
    default: return ''
  }
}

// Flexible grey table — thin borders, centred cells, optional grey header row.
// Cells support $…$ maths and **bold** (rendered inline like MCQ options).
// Width is an optional % of the page (empty/100 = full width, the historical
// default); a narrowed table is centred unless align says otherwise.
function tableHtml(b) {
  const rows = Array.isArray(b.rows) ? b.rows : []
  if (!rows.length) return ''
  const cellHtml = (c) => String(c || '').split('\n').map((line) => boldify(latexToHtml(chemArrows(line)))).join('<br>')
  const tr = (cells, tag) => `<tr>${cells.map((c) => `<${tag}>${cellHtml(c)}</${tag}>`).join('')}</tr>`
  const head = b.headerRow ? tr(rows[0], 'th') : ''
  const body = (b.headerRow ? rows.slice(1) : rows).map((r) => tr(r, 'td')).join('')
  const w = Number(b.width)
  const hasW = Number.isFinite(w) && w > 0 && w < 100
  const margin = b.align === 'left' ? '0 auto 0 0' : b.align === 'right' ? '0 0 0 auto' : '0 auto'
  // Per-column widths (% of the table, blank = auto). When any are set the
  // table uses fixed layout so the browser honours them exactly.
  const cws = Array.isArray(b.colWidths) ? b.colWidths : []
  const parsedCw = (rows[0] || []).map((_, i) => {
    const n = Number(cws[i])
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : null
  })
  const anyCw = parsedCw.some(v => v != null)
  const colgroup = anyCw
    ? `<colgroup>${parsedCw.map(v => v != null ? `<col style="width:${v}%">` : '<col>').join('')}</colgroup>`
    : ''
  const styles = [
    ...(hasW ? [`width:${w}%`, `margin:${margin}`] : []),
    ...(anyCw ? ['table-layout:fixed'] : []),
  ]
  const style = styles.length ? ` style="${styles.join(';')}"` : ''
  return `<div class="bk-block bk-tbl-wrap"><table class="bk-tbl"${style}>${colgroup}${head}${body}</table></div>`
}

// ── Cover ─────────────────────────────────────────────────────────────────────
// Per-subject A4 cover (design handoff "CUBE Cover — Concept 03"): brand lockup,
// a periodic-style year/symbol tile, a big subject title with an accent rule, the
// topic, a "Name:" line, and a cluster of translucent squares — all themed from a
// single accent colour derived from the subject.

// Official CUBE cube mark (from Asset 20.svg). Rendered in any colour.
export function cubeMark(color) {
  return `<svg viewBox="0 0 697.82 777.12" xmlns="http://www.w3.org/2000/svg" fill="${color}" stroke="${color}" stroke-miterlimit="10">
    <path stroke-width="5" d="M608.72,638.56l41.59-24.01c27.85-16.08,45.01-45.8,45.01-77.97V235.2c0-28.86-15.39-55.52-40.39-69.95L393.96,14.57c-27.87-16.09-62.22-16.09-90.09,0l-41.56,23.99,306.35,176.87c24.79,14.31,40.06,40.76,40.06,69.38v353.75Z"/>
    <path stroke-width="5" d="M477,262.52L175.71,88.56,47.58,162.54C19.17,180.49,2.5,208.41,2.5,240.62v295.93c0,32.19,17.17,61.93,45.05,78.02l256.3,147.98c27.88,16.1,62.24,16.1,90.12,0l41.54-23.98,41.49-23.95c27.92-16.12,45.11-45.9,45.11-78.14v-295.82c0-32.24-17.2-62.02-45.11-78.14ZM435.51,628.34c0,6.33-3.38,12.18-8.86,15.34l-50.32,29.05c-16.97,9.8-37.88,9.8-54.85,0l-209.66-121.05c-14.06-8.12-22.72-23.12-22.72-39.35V250.65c0-7.48,3.76-13.48,10.47-18.13l65.77-37.97c6.41-3.7,14.31-3.7,20.73,0l239.23,138.12c6.32,3.65,10.22,10.4,10.22,17.7v277.98Z"/>
    <path stroke-width="3" d="M348.91,538.56v42.52c0,3.32-3.6,5.4-6.48,3.74l-162.69-93.93c-2.5-1.44-4.04-4.11-4.04-7v-186.26c0-4.03,4.37-6.55,7.86-4.54l78.74,45.46,82.69,47.74c2.42,1.4,3.91,3.98,3.91,6.77v45.49l-129.9-75v100l129.9,75Z"/>
  </svg>`
}
// Cube logo for the cover (fills via currentColor).
const COVER_CUBE = `<svg viewBox="0 0 697.82 777.12" xmlns="http://www.w3.org/2000/svg"><path d="M608.72,638.56l41.59-24.01c27.85-16.08,45.01-45.8,45.01-77.97V235.2c0-28.86-15.39-55.52-40.39-69.95L393.96,14.57c-27.87-16.09-62.22-16.09-90.09,0l-41.56,23.99,306.35,176.87c24.79,14.31,40.06,40.76,40.06,69.38v353.75Z"/><path d="M477,262.52L175.71,88.56,47.58,162.54C19.17,180.49,2.5,208.41,2.5,240.62v295.93c0,32.19,17.17,61.93,45.05,78.02l256.3,147.98c27.88,16.1,62.24,16.1,90.12,0l41.54-23.98,41.49-23.95c27.92-16.12,45.11-45.9,45.11-78.14v-295.82c0-32.24-17.2-62.02-45.11-78.14ZM435.51,628.34c0,6.33-3.38,12.18-8.86,15.34l-50.32,29.05c-16.97,9.8-37.88,9.8-54.85,0l-209.66-121.05c-14.06-8.12-22.72-23.12-22.72-39.35V250.65c0-7.48,3.76-13.48,10.47-18.13l65.77-37.97c6.41-3.7,14.31-3.7,20.73,0l239.23,138.12c6.32,3.65,10.22,10.4,10.22,17.7v277.98Z"/><path d="M348.91,538.56v42.52c0,3.32-3.6,5.4-6.48,3.74l-162.69-93.93c-2.5-1.44-4.04-4.11-4.04-7v-186.26c0-4.03,4.37-6.55,7.86-4.54l78.74,45.46,82.69,47.74c2.42,1.4,3.91,3.98,3.91,6.77v45.49l-129.9-75v100l129.9,75Z"/></svg>`

// Subject → { symbol, accent }. Matches the three presets in the handoff, with
// sensible fallbacks for any other subject text.
function coverPreset(subject = '') {
  const s = subject.toLowerCase()
  if (s.includes('chem')) return { symbol: 'Ch', accent: 'oklch(0.55 0.1 155)' }
  if (s.includes('english') || s.includes('eald')) return { symbol: 'En', accent: 'oklch(0.55 0.11 28)' }
  if (s.includes('math')) return { symbol: 'Ma', accent: '#325099' }
  const letters = subject.replace(/[^A-Za-z]/g, '')
  const symbol = letters ? (letters[0].toUpperCase() + (letters[1] || '').toLowerCase()) : '—'
  return { symbol, accent: '#325099' }
}

// Translucent square cluster (left, top, size, fill, opacity) inside a 560×600 box.
const COVER_SQUARES = [
  [320, 330, 210, 'var(--accent)', 0.5],
  [190, 360, 150, 'color-mix(in oklab,var(--accent) 55%,white)', 0.72],
  [380, 168, 150, 'color-mix(in oklab,var(--accent) 28%,white)', 0.86],
  [268, 208, 122, 'color-mix(in oklab,var(--accent) 74%,#1f2b45)', 0.42],
  [148, 248, 100, 'color-mix(in oklab,var(--accent) 50%,white)', 0.6],
  [432, 332, 120, 'color-mix(in oklab,var(--accent) 32%,white)', 0.7],
  [300, 92, 84, 'var(--accent)', 0.3],
  [108, 372, 130, 'color-mix(in oklab,var(--accent) 18%,white)', 0.62],
  [448, 468, 120, 'color-mix(in oklab,var(--accent) 45%,white)', 0.55],
]

export function coverHtml(meta = {}, { solutions } = {}) {
  const subjectName = meta.subject || 'Mathematics'
  const { symbol, accent } = coverPreset(subjectName)
  const yearNumber = (meta.year ?? '') === '' ? '' : String(meta.year)
  let workbookName = meta.name || meta.topic || ''   // shown under the year
  // Chemistry names are stored compactly (e.g. "M8W1") but spelled out on the
  // cover. Chemistry counts in "Lessons" rather than "Weeks".
  const chemWk = /^M(\d+)W(\d+)$/i.exec(workbookName)
  if (chemWk && /chem/i.test(subjectName)) workbookName = `Module ${chemWk[1]} Lesson ${chemWk[2]}`
  const squares = COVER_SQUARES.map(([l, t, s, bg, op]) =>
    `<span style="position:absolute;left:${l}px;top:${t}px;width:${s}px;height:${s}px;background:${bg};opacity:${op}"></span>`).join('')
  return `<div class="bk-cv" style="--accent:${accent}">
    <div class="bk-cv-squares">${squares}</div>
    <div class="bk-cv-brand">
      <span class="bk-cv-logo">${COVER_CUBE}</span>
      <span class="bk-cv-word"><span class="bk-cv-word-1">CUBE</span><span class="bk-cv-word-2">TUITION</span></span>
    </div>
    <div class="bk-cv-tile">
      <span class="bk-cv-tile-year">${esc(yearNumber)}</span>
      <span class="bk-cv-tile-sym">${esc(symbol)}</span>
    </div>
    <div class="bk-cv-subject">
      ${solutions ? `<div class="bk-cv-soln">Solutions</div>` : ''}
      <div class="bk-cv-name-big">${esc(subjectName)}</div>
      <div class="bk-cv-rule"></div>
      ${yearNumber ? `<div class="bk-cv-year">Year ${esc(yearNumber)}</div>` : ''}
      ${workbookName ? `<div class="bk-cv-topic">${esc(workbookName)}</div>` : ''}
    </div>
    <div class="bk-cv-namefield">Name:</div>
  </div>`
}

// ── Level-test cover ───────────────────────────────────────────────────────────
// A simpler, exam-style cover (not the periodic-tile booklet cover): Student
// Name/Date lines, the CUBE lockup, a big two-line title, General Instructions +
// Total Marks lists, and a marker table. Instruction/total lines and the title
// come from meta.cover (with sensible defaults) so it stays editable.
export const DEFAULT_LT_INSTRUCTIONS = [
  'Working time – 60 minutes',
  'Write using black pen',
  'Calculators are **not** allowed',
  'For questions show relevant mathematical reasoning and/or calculations',
]
export const DEFAULT_LT_TOTALS = [
  '60 marks',
  'Attempt Questions 1–12',
  'Allow about 1 minute per mark',
]

// Sum of marks across a test's question/MCQ blocks (parts sum if present,
// MCQs default to 1 mark). Used to print "/X" on the pre-test marker box.
export function testTotalMarks(blocks = []) {
  let sum = 0
  for (const b of blocks || []) {
    if (!b || (b.type !== 'question' && b.type !== 'mcq')) continue
    if (Array.isArray(b.parts) && b.parts.length && b.parts.some(p => p.marks != null && p.marks !== '')) {
      sum += b.parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
    } else if (b.type === 'mcq') {
      sum += Number(b.marks) || 1
    } else {
      sum += Number(b.marks) || 0
    }
  }
  return sum
}

export function levelTestCoverHtml(meta = {}, { solutions, totalMarks = 0 } = {}) {
  const cover = meta.cover || {}
  const subject = meta.subject || 'Mathematics'
  const yearNo = (meta.year ?? '') === '' ? '' : String(meta.year)
  const titleTop = cover.title || `${yearNo ? `Year ${yearNo} ` : ''}${subject}`
  const titleBottom = cover.subtitle || 'Level Test'
  // An explicitly empty list hides the section; only a missing/absent list
  // falls back to the defaults.
  const baseInstructions = Array.isArray(cover.instructions) ? cover.instructions : DEFAULT_LT_INSTRUCTIONS
  // The calculator line follows the year: Year 7+ may use a NESA-approved
  // calculator; below that they're not allowed. Any existing calculator line is
  // swapped to the right wording so it always matches the year.
  const calcLine = Number(meta.year) >= 7
    ? 'A calculator approved by NESA may be used'
    : 'Calculators are **not** allowed'
  const instructions = baseInstructions.map(l => (/calculator/i.test(l) ? calcLine : l)).filter(l => String(l).trim())
  const totals = (Array.isArray(cover.totals) ? cover.totals : DEFAULT_LT_TOTALS).filter(l => String(l).trim())
  const li = (arr) => arr.map(t => `<li>${boldify(esc(t))}</li>`).join('')
  return `<div class="bk-lt">
    <div class="bk-lt-namebar">
      <div class="bk-lt-nf"><span>Student Name:</span><span class="bk-lt-line"></span></div>
      <div class="bk-lt-nf"><span>Date:</span><span class="bk-lt-line"></span></div>
    </div>
    <div class="bk-lt-brand">
      <span class="bk-lt-logo">${cubeMark('#2f3b5c')}</span>
      <span class="bk-lt-word"><span class="bk-lt-word-1">CUBE</span> <span class="bk-lt-word-2">Tuition</span></span>
    </div>
    ${solutions ? `<div class="bk-lt-soln">Solutions</div>` : ''}
    <h1 class="bk-lt-title">${esc(titleTop)}<br>${esc(titleBottom)}</h1>
    <div class="bk-lt-info">
      ${instructions.length ? `<div class="bk-lt-row"><div class="bk-lt-lbl">General Instructions</div><ul class="bk-lt-ul">${li(instructions)}</ul></div>` : ''}
      ${totals.length ? `<div class="bk-lt-row"><div class="bk-lt-lbl">Total Marks:</div><ul class="bk-lt-ul">${li(totals)}</ul></div>` : ''}
    </div>
    <table class="bk-lt-marker bk-lt-marker-solo">
      <thead><tr><th>Total mark</th></tr></thead>
      <tbody><tr><td class="bk-lt-total">/${totalMarks}</td></tr></tbody>
    </table>
  </div>`
}

export function footerHtml(pageNo, rightLabel = 'Mathematics Booklet') {
  return `<div class="bk-footer"><span class="bk-foot-l">© CUBE Tuition. All rights reserved.</span><span class="bk-foot-c">${pageNo ?? ''}</span><span class="bk-foot-r">${esc(rightLabel)}</span></div>`
}

// Assign running question numbers (question + mcq) in order, then render.
export function blocksToHtml(blocks, { solutions } = {}) {
  let qNum = 0
  return (blocks || []).map(b => {
    // A stimulus text starts a fresh question group (English reading
    // comprehension: each text's questions are numbered from 1).
    if (b.type === 'stimulus') qNum = 0
    if (b.type === 'question' || b.type === 'mcq') qNum++
    return blockHtml(b, { solutions, qNum })
  }).join('')
}

// ── Homework section helpers ──────────────────────────────────────────────────
// The booklet has three parts: an automatic cover (page 1), the editable Content
// pages, then a Homework page. Homework only ever contains questions + writing
// space, grouped into two fixed subsections, and its question numbering restarts
// at 1. These helpers render the homework title + subsection headings.
export const HW_GROUPS = [
  { id: 'foundational', label: 'MCQ + Foundational Questions' },
  { id: 'developmental', label: 'Developmental Questions' },
]
// Block types allowed in the homework section (no boxes/headings — questions only).
export const HW_BLOCK_TYPES = BLOCK_TYPES.filter(t => t.group === 'Questions' || t.type === 'writing' || t.type === 'stimulus')

function homeworkTitleHtml(meta = {}) {
  // Same grey section box as the content page's section header, but centred and
  // with no number. The topic sits inside the box, under "Homework" and lighter,
  // so it's clear which homework this page belongs to.
  return `<div class="bk-block bk-section bk-section-center bk-section-hw"><span class="bk-section-title">Homework</span>${meta.topic ? `<span class="bk-hw-topic">${esc(meta.topic)}</span>` : ''}</div>`
}
function hwHeadingHtml(label) {
  return `<div class="bk-block bk-subtopic">${esc(label)}</div>`
}

// Revision quiz header: grey section box (centred "Revision Quiz" + topic) with a
// "Name:" line above and a "/N" score box on the right (N = total quiz marks).
function revisionQuizTitleHtml(meta = {}, total = 0) {
  return `<div class="bk-block bk-quiz-head">
    <div class="bk-quiz-name">Name:</div>
    <div class="bk-section bk-section-quiz">
      <div class="bk-quiz-titlewrap"><span class="bk-section-title">Revision Quiz</span>${meta.topic ? `<span class="bk-hw-topic">${esc(meta.topic)}</span>` : ''}</div>
      <div class="bk-quiz-mark"><span class="bk-quiz-mark-num">/${total}</span></div>
    </div>
  </div>`
}

// Total marks for the revision quiz: each question/MCQ contributes its `marks`
// value, defaulting to 1 when blank. Writing space contributes nothing.
function quizTotalMarks(quiz) {
  return quiz.reduce((sum, b) => {
    if (b.type !== 'question' && b.type !== 'mcq') return sum
    const m = parseInt(b.marks, 10)
    return sum + (Number.isFinite(m) && m > 0 ? m : 1)
  }, 0)
}

const sectionOf = (b) => (b?.section === 'homework' ? 'homework' : b?.section === 'revision' ? 'revision' : 'content')
const hwGroupOf = (b) => (b?.hwGroup === 'developmental' ? 'developmental' : 'foundational')

// Ordered render items for the whole booklet body (content → homework → revision
// quiz). Each item = { html, pageBreakBefore?, homework?, quiz? }. Question
// numbering runs 1..N across content, then restarts for homework, then restarts
// again for the revision quiz. Consumed by both the live preview and the PDF
// exporter so they never drift.
export function bookletRenderItems(blocks, { solutions, meta } = {}) {
  const all = blocks || []
  const content = all.filter(b => sectionOf(b) === 'content')
  const hw = all.filter(b => sectionOf(b) === 'homework')
  const quiz = all.filter(b => sectionOf(b) === 'revision')
  const found = hw.filter(b => hwGroupOf(b) === 'foundational')
  const dev = hw.filter(b => hwGroupOf(b) === 'developmental')

  // Maths booklets don't print the syllabus band under section headings, and
  // marks only appear in the revision quiz (content + homework hide them).
  // Exam-style docs (level tests / pre-tests) keep marks everywhere.
  const isExamDoc = meta?.docType === 'level_test' || meta?.docType === 'pre_test'
  const isMaths = /maths/i.test(meta?.subject || '') && !isExamDoc
  const isEnglish = /english/i.test(meta?.subject || '')
  const hideSectionSyllabus = isMaths

  const items = []
  let qn = 0
  let pendingBreak = false
  for (const b of content) {
    // A "page break" block forces the following content onto a new page.
    if (b.type === 'pagebreak') { pendingBreak = true; continue }
    // A stimulus text starts a fresh question group (English reading
    // comprehension: each text's questions are numbered from 1).
    if (b.type === 'stimulus') qn = 0
    if (b.type === 'question' || b.type === 'mcq') qn++
    const ctx = { solutions, qNum: qn, hideSectionSyllabus, hideMarks: isMaths }
    items.push({ html: blockHtml(b, ctx), chunks: questionChunksHtml(b, ctx), pageBreakBefore: pendingBreak })
    pendingBreak = false
  }

  if (hw.length > 0) {
    items.push({ html: homeworkTitleHtml(meta), pageBreakBefore: true, homework: true })
    let hq = 0
    const pushBlock = (b) => {
      // A stimulus text starts a fresh question group (reading comprehension).
      if (b.type === 'stimulus') hq = 0
      if (b.type === 'question' || b.type === 'mcq') hq++
      const ctx = { solutions, qNum: hq, hideMarks: isMaths }
      items.push({ html: blockHtml(b, ctx), chunks: questionChunksHtml(b, ctx), homework: true })
    }
    if (isEnglish) {
      // English homework is a single flexible list: no fixed Foundational /
      // Developmental split — teachers add their own subheadings (subtopic
      // blocks), which render inline in document order.
      for (const b of hw) pushBlock(b)
    } else {
      const pushGroup = (list, label) => {
        if (list.length === 0) return
        items.push({ html: hwHeadingHtml(label), homework: true })
        for (const b of list) pushBlock(b)
      }
      pushGroup(found, 'MCQ + Foundational Questions')
      pushGroup(dev, 'Developmental Questions')
    }
  }

  if (quiz.length > 0) {
    items.push({ html: revisionQuizTitleHtml(meta, quizTotalMarks(quiz)), pageBreakBefore: true, quiz: true })
    let zq = 0
    for (const b of quiz) {
      if (b.type === 'stimulus') zq = 0
      if (b.type === 'question' || b.type === 'mcq') zq++
      const ctx = { solutions, qNum: zq }
      items.push({ html: blockHtml(b, ctx), chunks: questionChunksHtml(b, ctx), quiz: true })
    }
  }

  return items
}

// ── Stylesheet ────────────────────────────────────────────────────────────────
export const BOOKLET_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700&display=swap');
.bk-root{ --ink:#1c1c1c; --blue:#5b7bc4; --grey:#e7e8ea; --rule:#333; font-family:'Avenir Next','Avenir','Segoe UI',system-ui,Helvetica,Arial,sans-serif; color:var(--ink); }
.bk-page{ position:relative; width:794px; min-height:1123px; background:#fff; padding:38px 48px 60px; box-sizing:border-box; overflow:hidden; }
.bk-page + .bk-page{ margin-top:24px; }
.bk-watermark{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; }
.bk-watermark svg{ height:360px; width:auto; opacity:.04; }
.bk-content{ position:relative; z-index:1; }
.bk-block{ margin:0 0 32px; }
/* Cover (per-subject "Concept 03") */
.bk-cv{ position:relative; width:794px; height:1123px; background:#F5F6F8; overflow:hidden; box-sizing:border-box; font-family:'Jost','Avenir Next','Segoe UI',system-ui,Helvetica,Arial,sans-serif; color:#364466; }
.bk-cv-squares{ position:absolute; right:-60px; bottom:-60px; width:560px; height:600px; }
.bk-cv-brand{ position:absolute; top:76px; left:76px; display:flex; align-items:center; gap:13px; z-index:2; }
.bk-cv-logo{ display:block; width:40px; color:#364466; line-height:0; }
.bk-cv-logo svg{ display:block; width:100%; height:auto; fill:currentColor; }
.bk-cv-word{ display:flex; flex-direction:column; }
.bk-cv-word-1{ font-weight:600; font-size:19px; letter-spacing:4px; color:#364466; line-height:1.1; }
.bk-cv-word-2{ font-weight:500; font-size:10px; letter-spacing:4px; color:rgba(54,68,102,.55); line-height:1.1; }
.bk-cv-tile{ position:absolute; top:76px; right:76px; width:130px; height:150px; background:#fff; border:2px solid var(--accent); display:flex; flex-direction:column; justify-content:space-between; padding:14px 16px; box-sizing:border-box; z-index:2; }
.bk-cv-tile-year{ font-weight:500; font-size:24px; color:#364466; line-height:1; }
.bk-cv-tile-sym{ font-weight:600; font-size:54px; color:var(--accent); line-height:1; align-self:flex-end; }
.bk-cv-subject{ position:absolute; left:76px; right:200px; top:316px; z-index:2; }
.bk-cv-name-big{ font-weight:600; font-size:82px; line-height:.94; color:#364466; letter-spacing:-2px; }
.bk-cv-rule{ width:120px; height:5px; background:var(--accent); margin:32px 0 22px; }
.bk-cv-year{ font-weight:500; font-size:30px; color:#364466; }
.bk-cv-topic{ font-weight:400; font-size:24px; color:rgba(54,68,102,.62); margin-top:8px; }
.bk-cv-namefield{ position:absolute; left:76px; bottom:66px; font-weight:500; font-size:16px; color:#364466; z-index:2; }
.bk-cv-soln{ display:inline-block; background:var(--accent); color:#fff; font-weight:600; font-size:15px; letter-spacing:3px; text-transform:uppercase; padding:7px 14px; margin-bottom:18px; }
/* Section header */
.bk-section-wrap{ margin:0 0 32px; }
.bk-section{ background:var(--grey); padding:28px 22px 28px 32px; display:flex; align-items:center; gap:30px; }
/* Syllabus dot-points band sits flush under the header, a touch lighter */
.bk-section-syllabus{ background:color-mix(in oklab, var(--grey) 55%, #fff); padding:18px 32px 20px; }
.bk-section-syllabus .bk-ul{ margin:0; padding-left:52px; }
.bk-section-syllabus .bk-ul li{ margin:6px 0; }
/* Subdotpoints: one extra indent and an em-dash marker (no circle). The li rule
   below overrides the global .bk-ul-1 li{ list-style:circle }. */
.bk-section-syllabus .bk-ul-1{ padding-left:84px; }
.bk-section-syllabus .bk-ul-1 li{ list-style:none; position:relative; }
.bk-section-syllabus .bk-ul-1 li::marker{ content:""; }
.bk-section-syllabus .bk-ul-1 li::before{ content:"—"; position:absolute; left:-22px; }
.bk-section-syllabus .bk-p{ margin:0 0 6px; }
.bk-section-syllabus :last-child{ margin-bottom:0; }
.bk-section-center{ justify-content:center; text-align:center; }
.bk-section-hw{ flex-direction:column; gap:8px; }
.bk-hw-topic{ font-size:20px; font-weight:500; color:#1f1f1f; }
/* Revision quiz header */
.bk-quiz-name{ font-size:13px; font-weight:600; color:#1f1f1f; margin:24px 0 4px 0; padding-left:10px; }
.bk-quiz-titlewrap{ flex:1; display:flex; flex-direction:column; align-items:center; gap:8px; }
.bk-quiz-mark{ flex:0 0 auto; margin-right:28px; }
.bk-quiz-mark-num{ font-size:31px; font-weight:600; color:#1f1f1f; }
.bk-section-num{ font-size:31px; font-weight:700; color:#1f1f1f; }
.bk-section-title{ font-size:27px; font-weight:600; color:#1f1f1f; }
/* Subtopic — 16pt */
.bk-subtopic{ font-size:21px; font-weight:600; color:#1f1f1f; border-bottom:1px solid var(--rule); padding-bottom:6px; margin-top:6px; }
/* Callouts */
.bk-callout-wrap{ margin:28px 0 36px; }
.bk-callout-label{ display:flex; align-items:flex-end; font-size:17px; font-weight:600; color:#2a2035; line-height:1; margin-bottom:-2px; padding-bottom:0; }
.bk-callout-icon{ display:inline-flex; align-items:flex-end; margin-right:7px; }
.bk-callout-icon svg{ display:block; }
.bk-callout{ border-left:2.5px solid #2a2035; padding:16px 20px; }
.bk-callout-grey{ background:var(--grey); }
.bk-callout-white{ background:#fff; border:1px solid #cfcfcf; border-left:2.5px solid #2a2035; }
.bk-callout-clear{ background:transparent; border:1px solid #cfcfcf; border-left:2.5px solid #2a2035; }
.bk-callout-tint{ background:#eef3fc; }
/* keep inner top/bottom spacing equal to the box padding */
.bk-callout > :first-child, .bk-solbox > :first-child{ margin-top:0; }
.bk-callout > :last-child, .bk-solbox > :last-child{ margin-bottom:0; }
/* Two-column callout body — thin divider between the columns */
.bk-callout-2col{ display:grid; grid-template-columns:1fr 1fr; column-gap:30px; align-items:start; }
.bk-callout-2col > div{ min-width:0; }
.bk-callout-2col > div:first-child{ padding-right:30px; border-right:1px solid rgba(42,32,53,.16); }
.bk-callout-2col > div > :first-child{ margin-top:0; }
.bk-callout-2col > div > :last-child{ margin-bottom:0; }
/* Text */
.bk-root strong, .bk-content strong, .bk-callout strong{ font-weight:600; }
.bk-p{ margin:0 0 8px; font-size:16px; line-height:1.55; }
.bk-center{ text-align:center; }
.bk-part-sol{ margin-top:8px; }
.bk-ul{ list-style:disc outside; margin:4px 0 8px; padding-left:26px; }
.bk-ul li{ list-style:disc; display:list-item; font-size:16px; line-height:1.55; margin:4px 0; }
.bk-ul li::marker{ color:#2a2035; }
/* Sub-dot-points: indent a "- " line to nest it. Level 1 = hollow circle. */
.bk-ul-1{ padding-left:52px; }
.bk-ul-1 li{ list-style:circle; }
.bk-ul-2{ padding-left:78px; }
.bk-ul-2 li{ list-style:square; }
.bk-steps-heading{ font-size:16px; font-weight:600; color:#2a2035; margin:0 0 6px; }
.bk-ol{ list-style:decimal outside; margin:2px 0 0; padding-left:28px; }
.bk-ol li{ list-style:decimal; display:list-item; font-size:16px; line-height:1.55; margin:5px 0; }
.bk-ol li::marker{ color:#2a2035; font-weight:600; }
.bk-img{ margin:12px 0; }
.bk-img img{ max-width:100%; }
.bk-img-center{ text-align:center; }
.bk-img-center img{ margin:0 auto; }
.bk-img-block{ margin:18px 0; }
.bk-img-caption{ margin:8px 0 0; font-size:13px; color:#666; font-style:italic; text-align:center; }
.bk-img-left{ text-align:left; }
.bk-img-right{ text-align:right; }
.bk-img-float{ margin:4px 0 10px; }
.bk-img-float img{ max-width:100%; }
.bk-img-float-right{ float:right; margin-left:16px; }
.bk-img-float-left{ float:left; margin-right:16px; }
/* Clear floats at the end of each block so a tall image never bleeds into the
   next block or breaks pagination measurements. */
.bk-q::after, .bk-text::after, .bk-callout::after, .bk-part-body::after{ content:""; display:block; clear:both; }
.bk-mathobj{ margin:16px 0; text-align:center; }
.bk-mathobj-inner{ display:inline-block; }
.bk-mathobj-floatblock{ margin-top:2px; }
.bk-xyt{ border-collapse:collapse; margin:10px auto; }
.bk-xyt td{ border:1.3px solid #333; padding:5px 15px; text-align:center; font-size:14.5px; min-width:42px; }
.bk-xyt td.bk-xyt-var{ background:var(--grey); font-weight:600; }
.bk-slp-title{ font-size:13.5px; font-weight:bold; text-align:center; margin-bottom:4px; }
.bk-slp{ border-collapse:collapse; margin:8px auto 3px; }
.bk-slp th{ font-size:12px; font-weight:600; color:#555; padding:2px 16px 4px; border-bottom:1.3px solid #333; }
.bk-slp td{ font-size:14.5px; padding:2.5px 16px; }
.bk-slp td.bk-slp-stem{ border-right:1.6px solid #333; font-weight:600; text-align:right; min-width:30px; }
.bk-slp td.bk-slp-leaf{ text-align:left; letter-spacing:2px; font-variant-numeric:tabular-nums; min-width:60px; }
.bk-slp-key{ font-size:12.5px; color:#444; text-align:center; margin-top:2px; }
/* Questions */
.bk-q-title{ font-size:16px; font-weight:600; color:#1c1c1c; margin:0 0 6px; }
.bk-marks{ font-size:13px; font-weight:600; color:#555; }
.bk-mcq-tag{ font-size:11px; font-weight:700; color:#5b7bc4; border:1px solid #c9d6f0; border-radius:10px; padding:1px 7px; margin-left:4px; }
.bk-q-prompt{ font-size:16px; margin-bottom:6px; }
.bk-parts{ margin:6px 0; }
.bk-q-cont{ margin-top:-20px; }
.bk-stimulus{ border:1px solid #c9c9c9; padding:18px 24px; }
.bk-stim-title{ font-size:16px; font-weight:600; margin:0 0 2px; text-align:center; }
.bk-stim-source{ font-size:13px; font-style:italic; color:#555; margin:0 0 10px; text-align:center; }
.bk-stim-body{ font-size:15px; line-height:1.7; }
.bk-stim-stanza{ margin:0 0 14px; }
.bk-stim-stanza:last-child{ margin-bottom:0; }
/* Two-column parts (a | b) — used by level tests and side-by-side sub-questions. */
.bk-parts-2col{ display:grid; grid-template-columns:1fr 1fr; column-gap:36px; row-gap:4px; }
.bk-parts-2col > .bk-part{ min-width:0; }
.bk-part{ display:flex; gap:10px; margin:12px 0; }
.bk-part-label{ font-weight:600; width:20px; }
.bk-part-body{ flex:1; }
.bk-opts{ margin:8px 0; }
.bk-opt{ font-size:16px; margin:4px 0; }
.bk-opt-k{ font-weight:400; margin-right:4px; }
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
/* Flexible table block — slightly grey, thin borders, centred cells */
.bk-tbl-wrap{ margin:0 0 32px; }
.bk-tbl{ width:100%; border-collapse:collapse; font-size:14px; }
.bk-tbl td, .bk-tbl th{ border:1px solid #d7d7d7; padding:8px 10px; text-align:center; vertical-align:middle; overflow-wrap:break-word; }
.bk-tbl th{ background:#f0f1f3; font-weight:600; }
/* Footer */
/* 3-column grid (not space-between) so the page number is the true page centre
   regardless of the side text widths. */
.bk-footer{ position:absolute; left:48px; right:48px; bottom:28px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; font-size:11px; color:#666; }
.bk-foot-l{ text-align:left; }
.bk-foot-c{ text-align:center; }
.bk-foot-r{ text-align:right; }
.bk-foot-l, .bk-foot-r{ font-style:italic; }
.katex{ font-size:1em; }
/* ── Level-test cover ──────────────────────────────────────────────────────── */
.bk-lt{ position:relative; width:794px; height:1123px; background:#fff; box-sizing:border-box; padding:64px 72px; font-family:'Avenir Next','Avenir','Segoe UI',system-ui,Helvetica,Arial,sans-serif; color:#1c1c1c; }
.bk-lt-namebar{ position:absolute; top:64px; right:72px; width:420px; }
.bk-lt-nf{ display:flex; align-items:baseline; justify-content:flex-end; gap:12px; margin-bottom:20px; font-size:15px; color:#1c1c1c; }
.bk-lt-nf > span:first-child{ white-space:nowrap; }
.bk-lt-line{ display:inline-block; width:250px; border-bottom:1px solid #1c1c1c; height:13px; }
.bk-lt-brand{ display:flex; align-items:center; gap:18px; margin-top:150px; }
.bk-lt-logo{ width:78px; color:#2f3b5c; display:inline-block; line-height:0; }
.bk-lt-logo svg{ width:100%; height:auto; fill:currentColor; stroke:currentColor; }
.bk-lt-word{ font-size:48px; font-weight:500; color:#2f3b5c; letter-spacing:.5px; }
.bk-lt-word-1{ color:#062E63; font-weight:600; }
.bk-lt-word-2{ color:#325099; font-weight:400; }
.bk-lt-soln{ display:inline-block; background:#2f3b5c; color:#fff; font-weight:600; font-size:14px; letter-spacing:2px; text-transform:uppercase; padding:5px 12px; margin-top:24px; }
.bk-lt-title{ font-size:46px; font-weight:400; line-height:1.32; margin:34px 0 0; color:#1c1c1c; letter-spacing:-.5px; }
.bk-lt-info{ margin-top:46px; }
.bk-lt-row{ display:grid; grid-template-columns:150px 1fr; column-gap:24px; margin-bottom:34px; }
.bk-lt-lbl{ font-weight:600; font-size:16px; line-height:1.5; }
.bk-lt-ul{ list-style:disc outside; margin:0; padding-left:22px; }
.bk-lt-ul li{ font-size:16px; line-height:1.5; margin:9px 0; }
.bk-lt-ul li:first-child{ margin-top:0; }
.bk-lt-marker{ position:absolute; left:72px; right:72px; bottom:118px; width:calc(100% - 144px); border-collapse:collapse; }
.bk-lt-marker th, .bk-lt-marker td{ border:1px solid #1c1c1c; }
.bk-lt-marker th{ padding:11px 10px; font-weight:600; font-size:16px; text-align:center; }
.bk-lt-marker th:first-child{ width:38%; }
.bk-lt-marker td{ height:110px; }
/* Pre-test: a single, centred "Total mark" box showing /X. */
.bk-lt-marker-solo{ left:50%; right:auto; transform:translateX(-50%); width:300px; }
.bk-lt-marker-solo th{ width:auto; }
.bk-lt-marker-solo td{ height:56px; }
.bk-lt-total{ text-align:right; padding-right:120px; vertical-align:middle; font-size:17px; font-weight:500; color:#1c1c1c; }
`

// Faint CUBE watermark — the official cube mark in light blue.
export const WATERMARK_SVG = cubeMark('#5b7bc4')

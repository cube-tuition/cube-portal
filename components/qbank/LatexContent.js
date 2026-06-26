'use client'
import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/*
 * LatexContent — renders a string that mixes plain text and LaTeX math.
 *
 *   Inline math:   $ ... $
 *   Display math:  $$ ... $$
 *   Escaped $:     \$  (renders a literal dollar sign)
 *
 * Plain-text segments are HTML-escaped and newlines become <br>. Math segments
 * are rendered with KaTeX (throwOnError:false, so a typo shows the raw source
 * in red rather than blowing up the page).
 *
 * Used everywhere a question / solution is shown: editor preview, browse list,
 * and the worksheet/answer-key export.
 */

const escapeHtml = (s) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')

function renderMath(tex, displayMode) {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'html',
    })
  } catch {
    return `<span style="color:#dc2626">${escapeHtml(tex)}</span>`
  }
}

export function latexToHtml(input) {
  if (!input) return ''
  // Protect escaped dollar signs first.
  const PLACEHOLDER = '\uE000' // private-use char: XML-safe (the old NUL-wrapped token broke PDF export)
  let src = input.replace(/\\\$/g, PLACEHOLDER)

  let html = ''
  let i = 0
  while (i < src.length) {
    if (src.startsWith('$$', i)) {
      const end = src.indexOf('$$', i + 2)
      if (end === -1) { html += escapeHtml(src.slice(i)); break }
      html += renderMath(src.slice(i + 2, end).replaceAll(PLACEHOLDER, '\\$'), true)
      i = end + 2
    } else if (src[i] === '$') {
      const end = src.indexOf('$', i + 1)
      if (end === -1) { html += escapeHtml(src.slice(i)); break }
      html += renderMath(src.slice(i + 1, end).replaceAll(PLACEHOLDER, '\\$'), false)
      i = end + 1
    } else {
      // accumulate plain text up to the next $
      let next = src.indexOf('$', i)
      if (next === -1) next = src.length
      html += escapeHtml(src.slice(i, next))
      i = next
    }
  }
  return html.replaceAll(PLACEHOLDER, '$')
}

// ── Rich text (workbook-builder formatting) ─────────────────────────────────────
// Inline markers, applied AFTER KaTeX/escaping so they survive: **bold**,
// ^superscript^, ~subscript~. Mirrors the booklet renderer so the same shortcuts
// work in the question builder.
function boldify(html) {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\^([^^\s][^^]*?)\^/g, '<sup>$1</sup>')
    .replace(/~([^~\s][^~]*?)~/g, '<sub>$1</sub>')
}
// Chemical-reaction arrows in plain text (outside $…$): -> → →, <-> → ⇌, etc.
const MATH_SEG = /(\$\$[^$]*\$\$|\$[^$]+\$)/
function chemArrows(s) {
  return String(s ?? '').split(MATH_SEG).map((seg, i) => (i % 2 === 1
    ? seg
    : seg.replace(/<=>|<-->|<->/g, '⇌').replace(/-->|->/g, '→').replace(/<--|<-/g, '←'))).join('')
}

// Inline rich (one line): maths + bold/sup/sub + arrows. No block/bullets/centre.
export function inlineRich(input) {
  return boldify(latexToHtml(chemArrows(input)))
}

// Block rich: paragraphs, "-> " centred lines, "- " (nested) bullet lists, plus
// the inline formatting above. Used for stems / solutions / part prompts.
export function richToHtml(input) {
  const text = String(input ?? '')
  if (!text.trim()) return ''
  const lines = text.split('\n')
  let html = ''
  let curLevel = -1
  const closeList = () => { if (curLevel >= 0) { html += '</ul>'; curLevel = -1 } }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const bullet = line.match(/^(\s*)[-•]\s+(.*)$/)
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, '  ').length
      const level = Math.min(2, Math.floor(indent / 2))
      const marker = level === 1 ? 'circle' : level === 2 ? 'square' : 'disc'
      if (curLevel !== level) { closeList(); html += `<ul style="margin:2px 0;padding-left:${22 + level * 18}px;list-style:${marker} outside">`; curLevel = level }
      html += `<li>${inlineRich(bullet[2])}</li>`
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      const centered = /^->\s?/.test(line)
      const content = centered ? line.replace(/^->\s?/, '') : line
      html += `<p style="margin:0 0 4px${centered ? ';text-align:center' : ''}">${inlineRich(content)}</p>`
    }
  }
  closeList()
  return html
}

export default function LatexContent({ text, className = '', style, rich = false }) {
  const html = useMemo(() => (rich ? richToHtml(text) : latexToHtml(text)), [text, rich])
  const Tag = rich ? 'div' : 'span'
  return (
    <Tag
      className={`qbank-latex ${className}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

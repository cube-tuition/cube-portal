/*
 * Rich text for the class's shared notes page — a small, deliberately limited
 * HTML vocabulary (bold, italic, underline, strike, headings, lists, tables,
 * paragraphs) that survives a round trip through the database and is safe to
 * render for every student in the class.
 *
 * Bodies written before formatting existed are plain text; `toHtml` lifts
 * them into paragraphs the first time they are opened.
 */

const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DIV', 'SPAN'])
// Wrappers that browsers introduce while editing; their children are kept, they are not.
const UNWRAP = new Set(['DIV', 'SPAN', 'FONT'])
// Elements whose CONTENT must go too — code and embeds have no place on a notes page.
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH'])

export const looksLikeHtml = (s) => /<\/?[a-z][\s\S]*>/i.test(String(s || ''))

const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Plain text → paragraphs (blank lines) with line breaks kept inside them. */
export function textToHtml(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n')
  if (!t.trim()) return ''
  return t.split(/\n{2,}/).map(par => `<p>${escapeText(par).replace(/\n/g, '<br>')}</p>`).join('')
}

/** Whatever is stored → safe HTML for the editor. */
export function toHtml(stored) {
  return looksLikeHtml(stored) ? sanitizeHtml(stored) : textToHtml(stored)
}

/** Drop anything outside the vocabulary: unknown tags are unwrapped, every
 *  attribute is removed (no styles, no scripts, no links), and empty editing
 *  wrappers vanish. Runs in the browser (needs DOMParser). */
export function sanitizeHtml(html) {
  if (typeof window === 'undefined') return String(html || '')
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html')
  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue }
      const tag = child.tagName
      if (DROP.has(tag)) { child.remove(); continue }
      if (!ALLOWED.has(tag) || UNWRAP.has(tag)) {
        // Unknown or wrapper element: keep the words, lose the box. A block-level
        // stranger becomes a paragraph so its text does not run into the last line.
        clean(child)
        const isBlock = /^(DIV|SECTION|ARTICLE|BLOCKQUOTE|PRE|HEADER|FOOTER|FIGURE|H4|H5|H6|DL|DT|DD|ADDRESS)$/.test(tag)
        if (isBlock && child.childNodes.length && !/^(P|H1|H2|H3|UL|OL|TABLE)$/.test(child.firstElementChild?.tagName || '')) {
          const p = doc.createElement('p'); while (child.firstChild) p.appendChild(child.firstChild); child.replaceWith(p)
        } else {
          while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child)
          child.remove()
        }
        continue
      }
      for (const a of [...child.attributes]) child.removeAttribute(a.name)
      clean(child)
    }
  }
  clean(doc.body)
  // A table cell must never be empty or it collapses and cannot be clicked into.
  for (const cell of doc.body.querySelectorAll('td, th')) if (!cell.textContent.trim() && !cell.querySelector('br')) cell.innerHTML = '<br>'
  return doc.body.innerHTML
}

/** Plain-text view of a body, for previews. */
export function htmlToText(html) {
  if (typeof window === 'undefined') return String(html || '').replace(/<[^>]+>/g, ' ')
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html')
  return doc.body.textContent || ''
}

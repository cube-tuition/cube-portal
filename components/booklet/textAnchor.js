/*
 * Anchoring a highlight to the workbook's own text.
 *
 * A note has to survive being reloaded, and the page it points at is rendered
 * HTML — so the anchor can't be a DOM node. Instead every block the renderer
 * emits (tagged data-bid) has a "text space": its visible characters, in
 * document order, concatenated. A note is then just a character range in that
 * space, which is stable across re-renders and across a block being split over
 * two pages.
 *
 * Maths and diagrams are excluded from that space entirely. KaTeX renders each
 * formula twice (MathML for screen readers, spans for sighted users), so its
 * textContent is doubled and meaningless as an offset; an <svg> has no
 * characters worth pointing at. Leaving them out of BOTH the offsets and the
 * painting keeps the two consistent — a selection dragged across a formula
 * simply skips over it rather than landing somewhere unpredictable.
 *
 * The one thing this cannot survive is the booklet being edited underneath a
 * student: offsets are positions, not content, so inserting a sentence earlier
 * in a block slides every later highlight along by that much. checkQuote()
 * exists for that — it re-reads the text at the stored range and reports
 * whether it still matches what was highlighted.
 */

// Answer fields are live inputs with their own anchoring scheme, so they are
// never part of a block's text space.
const SKIP = 'svg, .katex, .bk-answer-live, script, style'

/** Every element belonging to one block, in document order. */
export function blockElements(root, blockId) {
  if (!root) return []
  return Array.from(root.querySelectorAll(`[data-bid="${CSS.escape(blockId)}"]`))
}

/** The visible text nodes of those elements, in order. */
export function textNodes(els) {
  const out = []
  for (const el of els) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && !n.parentElement?.closest(SKIP)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT),
    })
    let n
    while ((n = walk.nextNode())) out.push(n)
  }
  return out
}

/** The block's whole text space, as a string. */
export function blockText(els) {
  return textNodes(els).map(n => n.nodeValue).join('')
}

/**
 * Where a live selection sits in a block's text space.
 * Returns { start, end, quote } or null if the selection isn't inside it.
 */
export function rangeToOffsets(els, range) {
  const nodes = textNodes(els)
  let at = 0, start = -1, end = -1
  for (const n of nodes) {
    const len = n.nodeValue.length
    if (range.intersectsNode(n)) {
      // comparePoint === 0 means the point lies inside the range, which is how
      // a node that merely *starts* mid-selection is told from the first one.
      if (start < 0) start = (n === range.startContainer) ? at + range.startOffset
        : (range.comparePoint(n, 0) === 0 ? at : at + len)
      end = (n === range.endContainer) ? at + range.endOffset : at + len
    }
    at += len
  }
  if (start < 0 || end <= start) return null
  const text = nodes.map(n => n.nodeValue).join('')
  return { start, end, quote: text.slice(start, end) }
}

/** Has the text under a stored range drifted since it was highlighted? */
export function checkQuote(els, note) {
  if (!note.quote) return true
  return blockText(els).slice(note.range_start, note.range_end) === note.quote
}

/** Remove marks this module painted, leaving the rendered HTML as it was. */
export function unpaint(els) {
  for (const el of els) {
    el.querySelectorAll('mark[data-note]').forEach(m => {
      m.replaceWith(...m.childNodes)
    })
    el.normalize()   // stitch the split text nodes back together
  }
}

/**
 * Wrap one character range in <mark>. Splitting text nodes invalidates any list
 * held across calls, so the caller paints one note at a time and this re-walks.
 * Returns the first mark element, for positioning a margin card against.
 */
export function paintRange(els, { start, end, id, className, onClick }) {
  let at = 0, first = null
  // Snapshot first: splitText() mutates the tree as we go.
  const plan = []
  for (const n of textNodes(els)) {
    const len = n.nodeValue.length
    const from = Math.max(start - at, 0)
    const to = Math.min(end - at, len)
    if (to > from) plan.push({ node: n, from, to })
    at += len
    if (at >= end) break
  }
  for (const seg of plan) {
    let node = seg.node
    if (seg.from > 0) node = node.splitText(seg.from)
    if (seg.to - seg.from < node.nodeValue.length) node.splitText(seg.to - seg.from)
    const mark = document.createElement('mark')
    mark.className = className
    mark.dataset.note = id
    node.parentNode.replaceChild(mark, node)
    mark.appendChild(node)
    if (onClick) mark.addEventListener('click', onClick)
    if (!first) first = mark
  }
  return first
}

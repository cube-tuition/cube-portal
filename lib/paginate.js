/**
 * Splitting a too-tall block across pages.
 *
 * The paginators (BookletPreview + bookletExport) place one render item at a
 * time and start a new page when the current one overflows. That works while
 * every item is shorter than a page. A block that is taller than a page on its
 * own — 40 writing lines, a long table, a big callout — had no fallback: it
 * stayed put and stretched the page past A4, which then printed as a sliced,
 * footer-clipped PDF.
 *
 * A multi-part question can fall back to its per-part chunks. Everything else
 * uses splitToFit below, which moves trailing children onto the next page.
 */

/**
 * Trim `el` (already in the DOM) until `fits()` is true, returning the removed
 * tail as a detached element to place on the next page — or null if it already
 * fitted or cannot be split any further.
 *
 * Descends when an element has a single tall child, so a writing block
 * (.bk-writing > .bk-lines > .bk-line ×N) splits at the individual line, and a
 * table splits between rows, while the wrapper markup is rebuilt around each
 * piece via shallow clones.
 *
 * An element with no children is atomic (an image, one long word). It is
 * returned unsplit and the caller lets it overflow rather than looping forever.
 */
// Elements that must never be broken apart. Splitting a table row would move
// some of its cells to the next page and leave a duplicate-looking stub on this
// one; an image or SVG simply has no split point.
const ATOMIC = new Set(['TR', 'IMG', 'SVG', 'BR', 'HR', 'CANVAS', 'VIDEO', 'COLGROUP'])

export function splitToFit(el, fits) {
  if (fits()) return null
  if (ATOMIC.has(el.tagName)) return null            // move it whole instead

  const kids = Array.from(el.children)
  if (kids.length === 0) return null                 // atomic — nothing to split on

  if (kids.length === 1) {
    const inner = splitToFit(kids[0], fits)
    if (!inner) return null
    const rest = el.cloneNode(false)
    rest.appendChild(inner)
    return rest
  }

  // Pop children off the end until what remains fits. Always keep at least one
  // so the head never becomes an empty shell.
  const moved = []
  for (let i = kids.length - 1; i >= 1; i--) {
    el.removeChild(kids[i])
    moved.unshift(kids[i])
    if (fits()) break
  }

  // The child that tipped it over may itself be splittable. Put it back and
  // split inside it, so this page is filled rather than left mostly empty —
  // otherwise a writing block puts its heading alone on one page and every line
  // on the next.
  if (moved.length) {
    const first = moved[0]
    el.appendChild(first)
    const tail = splitToFit(first, fits)
    if (fits()) {
      if (tail) moved[0] = tail          // head stays here, tail carries over
      else moved.shift()                 // it fitted whole after all
    } else {
      // Splitting it did not free enough room. Put the pieces back together and
      // move the whole child to the next page rather than leaving this one over.
      if (tail) while (tail.firstChild) first.appendChild(tail.firstChild)
      el.removeChild(first)
    }
  }

  // Still too tall with a single child left: split inside that child.
  let head = null
  if (!fits() && el.lastElementChild) head = splitToFit(el.lastElementChild, fits)

  const rest = el.cloneNode(false)
  if (head) rest.appendChild(head)
  for (const m of moved) rest.appendChild(m)
  return rest.children.length ? rest : null
}

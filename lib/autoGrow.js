/*
 * Auto-size a textarea to its content without moving the page.
 *
 * The naive version — height:'auto' to measure, then set the real height —
 * shrinks the document for one layout pass, and the browser clamps the scroll
 * to the shorter page. To someone typing far down a long page that reads as
 * "the screen jumps every time I type". Both writes happen in the same frame
 * here, so nothing paints in between; the scroll positions (window and any
 * scrollable ancestor) are captured first and put back after, making the
 * measurement invisible.
 */
export function autoGrow(el, minHeight) {
  if (!el) return
  const scrollers = []
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (a.scrollTop || a.scrollLeft) scrollers.push([a, a.scrollTop, a.scrollLeft])
  }
  const wx = window.scrollX, wy = window.scrollY
  el.style.height = 'auto'
  el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
  window.scrollTo(wx, wy)
  for (const [a, t, l] of scrollers) { a.scrollTop = t; a.scrollLeft = l }
}

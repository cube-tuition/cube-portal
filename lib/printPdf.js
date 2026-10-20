/*
 * Print a PDF straight to the browser's print dialog — no download, no
 * preview page. The PDF is fetched as a blob so its URL is same-origin, then
 * loaded in a hidden frame whose window is asked to print: Chrome and Edge's
 * PDF viewer answers that call. A viewer that won't (Firefox) throws on the
 * frame window, and the PDF is opened in a new tab instead, whose own Ctrl+P
 * prints it.
 *
 *   printPdf(blobOrUrl, { onDone })
 */
export async function printPdf(src, { onDone } = {}) {
  const blob = src instanceof Blob ? src : await (await fetch(src, { mode: 'cors' })).blob()
  const url = URL.createObjectURL(blob)
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none'
  frame.src = url
  await new Promise((resolve) => { frame.onload = resolve; document.body.appendChild(frame) })
  try {
    const win = frame.contentWindow
    // afterprint fires when the dialog closes; the frame is kept until then
    // (and for a while regardless, in case the event never comes).
    const cleanup = () => { try { frame.remove() } catch { /* already gone */ } URL.revokeObjectURL(url); onDone?.() }
    win.addEventListener('afterprint', cleanup, { once: true })
    setTimeout(cleanup, 10 * 60 * 1000)
    win.focus(); win.print()
  } catch {
    frame.remove()
    window.open(url, '_blank', 'noopener')
    onDone?.()
  }
}

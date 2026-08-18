/*
 * Rasterise a DOM node to a JPEG data URL — the step every PDF export in the
 * portal runs on each of its pages.
 *
 * This is html-to-image's own toCanvas() + toJpeg() with ONE step removed: the
 * library resolves its internal image load inside a requestAnimationFrame, and
 * a BACKGROUND BROWSER TAB NEVER FIRES ONE. Switching tabs part-way through an
 * export therefore froze it on that line until the user came back — which is
 * exactly when someone switches away, because the export is slow. Everything
 * else in the pipeline (cloning, font/image embedding, fetches, canvas work)
 * runs happily in a hidden tab; only the frame wait does not.
 *
 * Here the frame wait is replaced by decode(), which is not frame-throttled.
 * Options are handed to toSvg unchanged and the canvas is built exactly as
 * toCanvas builds it — including the maximum-canvas-size guard, which matters
 * for the exporters whose pages can be taller than A4 — so the rendered page
 * is identical to what the library produced.
 *
 * Drop-in replacement: nodeToJpeg(node, opts) === htmlToImage.toJpeg(node, opts).
 */

// @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas#maximum_canvas_size
const CANVAS_LIMIT = 16384

// A page taller than the canvas limit (a long worksheet question, a report
// page that grew) is scaled down to fit rather than silently rasterising blank.
function clampCanvas(canvas) {
  const { width: w, height: h } = canvas
  if (w <= CANVAS_LIMIT && h <= CANVAS_LIMIT) return
  if (w > h) {
    canvas.height = Math.floor(h * (CANVAS_LIMIT / w))
    canvas.width = CANVAS_LIMIT
  } else {
    canvas.width = Math.floor(w * (CANVAS_LIMIT / h))
    canvas.height = CANVAS_LIMIT
  }
}

export async function nodeToJpeg(node, options = {}) {
  const htmlToImage = await import('html-to-image')   // cached after first use
  const svgUrl = await htmlToImage.toSvg(node, options)

  const img = new Image()
  img.decoding = 'async'
  img.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => {
    img.onload = resolve
    // html-to-image rejects with a bare Event here; callers with a recovery
    // ladder (the worksheet export) match on the rejection, not its shape.
    img.onerror = () => reject(new Error('Could not rasterise a page'))
    img.src = svgUrl
  })
  // Belt and braces: onload can precede the decode on some engines. A failure
  // is not fatal — the image has loaded, so drawing it still works.
  try { await img.decode() } catch { /* already decoded, or decode unsupported */ }

  // toSvg sizes the SVG with the same getImageSize() the library uses, so the
  // loaded image's natural size IS the measured node size when the caller
  // didn't pass explicit dimensions.
  const width = options.width || img.naturalWidth
  const height = options.height || img.naturalHeight
  const ratio = options.pixelRatio || window.devicePixelRatio || 1

  const canvas = document.createElement('canvas')
  canvas.width = width * ratio
  canvas.height = height * ratio
  if (!options.skipAutoScale) clampCanvas(canvas)
  // The fill must follow the clamp: assigning width/height clears the canvas.
  const ctx = canvas.getContext('2d')
  if (options.backgroundColor) {
    ctx.fillStyle = options.backgroundColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', options.quality || 1)
}

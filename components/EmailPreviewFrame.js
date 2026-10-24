'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * An email preview that updates in place. A plain <iframe srcDoc={html}>
 * reloads the whole document on every change — it flashes and jumps back to
 * the top, so ticking several boxes meant scrolling back down after each one.
 * This loads the first version once, then swaps the new email into the same
 * document, keeping where the preview was scrolled to.
 *
 * Drop-in for <iframe srcDoc={html} …>: pass `html` plus any iframe props.
 */
export default function EmailPreviewFrame({ html, ...props }) {
  const ref = useRef(null)
  const latest = useRef(html)
  const [initial] = useState(html)   // never changes, so the frame never reloads

  const apply = useCallback(() => {
    const doc = ref.current?.contentDocument
    if (!doc?.body) return
    const next = new DOMParser().parseFromString(latest.current || '', 'text/html')
    if (doc.head.innerHTML !== next.head.innerHTML) doc.head.innerHTML = next.head.innerHTML
    for (const a of [...doc.body.attributes]) doc.body.removeAttribute(a.name)
    for (const a of [...next.body.attributes]) doc.body.setAttribute(a.name, a.value)
    if (doc.body.innerHTML !== next.body.innerHTML) doc.body.innerHTML = next.body.innerHTML
  }, [])

  useEffect(() => {
    latest.current = html
    apply()
  }, [html, apply])

  // A change made while the first version was still loading lands on load.
  return <iframe ref={ref} srcDoc={initial} onLoad={apply} {...props} />
}

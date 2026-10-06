'use client'
import { useEffect, useRef } from 'react'

/*
 * useKeyboardFit — keep a full-screen chat layout inside the part of the
 * screen the on-screen keyboard leaves free.
 *
 * iOS doesn't shrink the page when the keyboard opens; it scrolls the whole
 * page up to show the focused box, so a pinned header and the conversation
 * shoot off the top. The visual viewport knows the real visible area, so
 * while the keyboard is up the element is sized to that area and the page is
 * held at the top. The result is the iMessage behaviour: header stays, the
 * reply box sits on the keyboard, the latest messages show in between.
 *
 *   const rootRef = useKeyboardFit()
 *   <div ref={rootRef} className="fixed inset-0 flex flex-col">…</div>
 */
export function useKeyboardFit() {
  const ref = useRef(null)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const el = ref.current
    if (!vv || !el) return
    const apply = () => {
      const keyboardUp = vv.height < window.innerHeight - 80
      if (keyboardUp) {
        el.style.height = `${vv.height}px`
        el.style.top = `${vv.offsetTop}px`
        el.style.bottom = 'auto'
        window.scrollTo(0, 0)
      } else {
        el.style.height = ''
        el.style.top = ''
        el.style.bottom = ''
      }
      // Tell the chat inside to keep its last messages in view.
      el.dispatchEvent(new CustomEvent('keyboardfit', { bubbles: false, detail: { keyboardUp } }))
    }
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply) }
  }, [])
  return ref
}

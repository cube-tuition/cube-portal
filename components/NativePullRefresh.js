'use client'
import { useEffect, useRef, useState } from 'react'
import { isNativeApp } from '../lib/nativeApp'

/*
 * Pull down to refresh, inside the iPhone app only (the app's web view has no
 * built-in pull-to-refresh, unlike Safari). Drag down from the very top of the
 * page past the threshold and let go: the page reloads, picking up anything
 * new — including a just-deployed version of the portal.
 *
 * Stays out of the way: it only starts when the page is scrolled to the top,
 * the touch didn't begin inside something that scrolls on its own (a list, a
 * chat thread, a table) that isn't at its own top, and no sheet or modal has
 * locked the page scroll.
 */
const THRESHOLD = 70      // px of (damped) pull needed to refresh
const MAX = 110 // px cap on how far the indicator travels

function scrollsAwayFromTop(el) {
  for (let n = el instanceof Element ? el : null; n && n !== document.body; n = n.parentElement) {
    const st = getComputedStyle(n)
    if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return true
  }
  return false
}

export default function NativePullRefresh() {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const startY = useRef(null)
  const pullRef = useRef(0)

  useEffect(() => {
    const onStart = (e) => {
      if (!isNativeApp() || window.scrollY > 0 || document.body.style.overflow === 'hidden' || e.touches.length !== 1) { startY.current = null; return }
      if (scrollsAwayFromTop(e.target)) { startY.current = null; return }
      startY.current = e.touches[0].clientY
    }
    const onMove = (e) => {
      if (startY.current == null) return
      const dy = e.touches[0].clientY - startY.current
      pullRef.current = dy <= 0 || window.scrollY > 0 ? 0 : Math.min(MAX, dy * 0.5)
      setPull(pullRef.current)
    }
    const onEnd = () => {
      if (startY.current == null) return
      startY.current = null
      if (pullRef.current >= THRESHOLD) { setBusy(true); setTimeout(() => window.location.reload(), 150) }
      pullRef.current = 0
      setPull(0)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  if (!pull && !busy) return null
  const ready = pull >= THRESHOLD
  const shown = busy ? THRESHOLD : pull
  return (
    <div className="fixed left-0 right-0 z-[80] flex justify-center pointer-events-none"
      style={{ top: `calc(env(safe-area-inset-top) + ${Math.max(8, shown - 36)}px)` }}>
      <div className="w-9 h-9 rounded-full bg-white shadow-lg border border-[#DEE7FF] flex items-center justify-center">
        <svg className={`w-5 h-5 text-[#325099] ${busy ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" style={busy ? undefined : { transform: `rotate(${ready ? 180 : (pull / THRESHOLD) * 180}deg)`, transition: 'transform .1s' }}>
          {busy ? <path d="M21 12a9 9 0 1 1-6.2-8.6" /> : <path d="M12 5v14M6 13l6 6 6-6" />}
        </svg>
      </div>
    </div>
  )
}

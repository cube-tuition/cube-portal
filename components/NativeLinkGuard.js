'use client'
import { useEffect } from 'react'
import { isNativeApp } from '../lib/nativeApp'

/*
 * Inside the iPhone app a "new tab" doesn't exist: WKWebView hands any
 * target=_blank link or window.open() to Safari, so the user leaves the app.
 * For the portal's own pages that's never wanted — open them in place instead.
 * Links to other sites (and blob: PDFs, mailto:, tel:) keep their normal
 * behaviour. A no-op in the browser.
 */
export default function NativeLinkGuard() {
  useEffect(() => {
    if (!isNativeApp()) return
    const sameSite = (href) => {
      try { const u = new URL(href, window.location.href); return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === window.location.origin ? u : null }
      catch { return null }
    }
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0) return
      const a = e.target.closest?.('a[target="_blank"]')
      if (!a || a.hasAttribute('download')) return
      const u = sameSite(a.getAttribute('href') || '')
      if (!u) return
      e.preventDefault()
      window.location.assign(u.pathname + u.search + u.hash)
    }
    document.addEventListener('click', onClick, true)
    const nativeOpen = window.open
    window.open = function (url, ...rest) {
      const u = url ? sameSite(String(url)) : null
      if (u) { window.location.assign(u.pathname + u.search + u.hash); return window }
      return nativeOpen.call(window, url, ...rest)
    }
    return () => { document.removeEventListener('click', onClick, true); window.open = nativeOpen }
  }, [])
  return null
}

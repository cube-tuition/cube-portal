'use client'
import { useEffect } from 'react'

/*
 * Disables the browser's default "scroll wheel changes the value" behaviour on
 * <input type="number"> across the whole app. When a number input is focused and
 * the user scrolls, we blur it — so the value doesn't change and the page scrolls
 * normally. Keyboard up/down arrows still work for stepping.
 */
export default function NoNumberScroll() {
  useEffect(() => {
    const onWheel = () => {
      const el = document.activeElement
      if (el && el.tagName === 'INPUT' && el.type === 'number') el.blur()
    }
    document.addEventListener('wheel', onWheel, { passive: true })
    return () => document.removeEventListener('wheel', onWheel)
  }, [])
  return null
}

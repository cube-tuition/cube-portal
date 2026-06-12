'use client'
import { useEffect, useState } from 'react'
import { performUndo, subscribeUndoToast, isTypingTarget } from '../lib/undo'

/*
 * GlobalUndo — mounted once inside TutorNav so every tutor/admin page gets
 * Ctrl/Cmd+Z undo + a confirmation toast. See lib/undo.js for the service.
 */
export default function GlobalUndo() {
  const [toast, setToast] = useState(null) // { msg, ok, at }

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || e.altKey) return
      if (isTypingTarget(e.target)) return // native text undo wins while typing
      e.preventDefault()
      performUndo()
    }
    document.addEventListener('keydown', onKey)
    const unsub = subscribeUndoToast(setToast)
    return () => { document.removeEventListener('keydown', onKey); unsub() }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  if (!toast) return null
  return (
    <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold border ${
      toast.ok ? 'bg-[#062E63] text-white border-[#325099]' : 'bg-white text-[#92400E] border-[#FDE68A]'
    }`}>
      {toast.ok ? '↩ ' : '⚠ '}{toast.msg}
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

/*
 * The phone menu shared by the staff nav (TutorNav) and the student nav
 * (PortalNav): a sheet that slides in from the right over a dimmed page. Who
 * you are on top, the everyday pages as big tiles, then each section as a
 * labelled grid of icon buttons, and log out at the foot.
 *
 *   primary  — [{ label, href, icon }]                      the big tiles
 *   sections — [{ label, links: [{ label, href, icon }] }]  labelled grids
 *   isActive — (href) => boolean                            which tile is lit
 *
 * Rendered through a portal to <body>: the nav bar has backdrop-blur, and a
 * backdrop-filter makes fixed-position children position against the nav
 * instead of the screen, which would clip the sheet to the bar.
 */
export default function NavSheet({ open, onClose, name, role, primary, sections = [], isActive, onLogout }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id) }, [])
  // Lock the page behind the sheet, and let Escape close it.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open, onClose])
  if (!mounted || !open) return null

  const first = (name || '').split(' ')[0]

  const tile = (link, big) => {
    const active = isActive(link.href)
    return (
      <Link key={link.href} href={link.href} onClick={onClose}
        className={`flex ${big ? 'flex-col items-start gap-2 p-3.5' : 'items-center gap-2.5 px-3 py-2.5'} rounded-2xl border transition active:scale-[0.98] ${
          active ? 'bg-[#062E63] border-[#062E63] text-white' : 'bg-white border-[#E5ECFF] text-[#2A2035] active:bg-[#F0F4FF]'}`}>
        <span className={`${big ? 'text-xl' : 'text-base'} leading-none`}>{link.icon || '•'}</span>
        <span className={`text-[13px] font-semibold leading-tight ${active ? 'text-white' : ''}`}>
          {link.label}
          {link.soon && <span className={`ml-1.5 text-[9px] font-bold uppercase tracking-wider ${active ? 'text-white/70' : 'text-[#325099]/60'}`}>Soon</span>}
        </span>
      </Link>
    )
  }

  return createPortal(
    <div className="md:hidden fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-[#0B1020]/45 backdrop-blur-[2px] nav-sheet-fade" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-[88%] max-w-sm bg-[#F7F9FE] shadow-2xl flex flex-col nav-sheet-in"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {/* Who you are */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#325099] to-[#062E63] text-white text-lg font-bold flex items-center justify-center shrink-0">
            {(first || 'C').slice(0, 1).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-[#062E63] truncate">{name || 'CUBE Tuition'}</p>
            <p className="text-[11px] font-semibold text-[#325099]/70">{role} · CUBE Portal</p>
          </div>
          <button onClick={onClose} aria-label="Close menu"
            className="w-9 h-9 rounded-full bg-white border border-[#E5ECFF] text-[#062E63] text-lg flex items-center justify-center active:bg-[#F0F4FF]">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">
          {/* Everyday pages */}
          <div className={`grid gap-2.5 ${primary.length === 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {primary.map((l) => tile(l, true))}
          </div>
          {/* Each section */}
          {sections.map((g) => (
            <div key={g.label}>
              <p className="px-1 mb-2 text-[10px] font-bold tracking-[0.18em] uppercase text-[#325099]/60">{g.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {g.links.map((l) => tile(l, false))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 pt-2 pb-4 border-t border-[#E5ECFF] bg-[#F7F9FE]">
          <button onClick={onLogout}
            className="w-full py-3 rounded-2xl bg-white border border-[#FECACA] text-sm font-semibold text-[#B91C1C] active:bg-[#FEF2F2]">
            Log out
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

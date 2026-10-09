'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ADMIN_FLAT_LINKS, ADMIN_GROUPS, BASE_LINKS, RESOURCES_GROUP } from '../lib/portalNavLinks'

/*
 * The director menu drawer — every destination in the director portal, in
 * hierarchical sections, so the top bar can stay at four items. Opened from
 * the panel icon at the right end of the top bar (next to Logout) and slides
 * in from the RIGHT, over the page: nothing shifts, nothing to re-layout.
 * Desktop only (hidden below md; the phone menu sheet lists everything).
 *
 * Per-section expansion is a per-browser convenience kept in localStorage —
 * never state that matters. The drawer closes on backdrop click, Escape, or
 * navigation (TutorNav closes it on route change).
 */

const SECTIONS_KEY = 'dirSidebarSections'

const SECTIONS = [
  { label: 'Main', links: BASE_LINKS.concat(ADMIN_FLAT_LINKS) },
  RESOURCES_GROUP,
  ...ADMIN_GROUPS,
]

export default function DirectorSidebar({ open, onClose, pathname }) {
  const [collapsed, setCollapsed] = useState({})   // section label → true (closed)

  // Stored preference applied after mount (guarded for private windows).
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}')
      if (stored && typeof stored === 'object') setCollapsed(stored)
    } catch { /* storage unavailable — defaults are fine */ }
  }, [])

  // Escape closes, like every other sheet in the portal.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const isActive = (href) => (href === '/tutor' ? pathname === '/tutor' : pathname?.startsWith(href))

  const toggleSection = (label) => setCollapsed(c => {
    const next = { ...c, [label]: !c[label] }
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)) } catch { /* fine */ }
    return next
  })

  // A section containing the current page never renders closed — finding
  // yourself is the whole point of a menu.
  const forcedOpen = (section) => section.links.some(l => isActive(l.href))

  return (
    <div className="hidden md:block fixed inset-0 z-[70]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px] nav-sheet-fade" onClick={onClose} />

      {/* Drawer — slides in from the right (same animation as the phone sheet) */}
      <aside className="absolute right-0 top-0 bottom-0 w-[280px] flex flex-col bg-white border-l border-[#DEE7FF] shadow-2xl nav-sheet-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0F4FF] shrink-0">
          <span className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-bold">Menu</span>
          <button
            onClick={onClose}
            title="Close the menu"
            aria-label="Close the menu"
            className="flex items-center justify-center w-7 h-7 rounded-lg text-[#325099]/60 hover:text-[#062E63] hover:bg-[#F8FAFF] transition text-lg leading-none"
          >×</button>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto py-2">
          {SECTIONS.map(section => {
            const shut = collapsed[section.label] && !forcedOpen(section)
            return (
              <div key={section.label} className="px-3 pb-1">
                <button
                  onClick={() => toggleSection(section.label)}
                  className="w-full flex items-center justify-between px-2 py-2 text-[10px] font-bold tracking-[0.18em] uppercase text-[#325099]/55 hover:text-[#325099] transition"
                >
                  {section.label}
                  <svg className={`w-2.5 h-2.5 transition-transform duration-150 ${shut ? '-rotate-90' : ''}`}
                    viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {!shut && section.links.map(link => {
                  const active = isActive(link.href)
                  return (
                    <Link key={link.href} href={link.href} onClick={onClose}
                      className={`flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] transition ${
                        active
                          ? 'bg-[#F0F4FF] text-[#062E63] font-semibold'
                          : 'text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium'
                      }`}>
                      <span className="text-[15px] leading-none w-5 text-center shrink-0">{link.icon}</span>
                      <span className="truncate">{link.label}</span>
                      {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#325099] shrink-0" />}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Messages — same new-tab behaviour as the envelope in the top bar */}
        <div className="px-3 py-3 border-t border-[#F0F4FF] shrink-0">
          <a href="/tutor/admin/messages" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium transition">
            <span className="text-[15px] leading-none w-5 text-center shrink-0">💬</span>
            Messages
            <span className="ml-auto text-[10px] text-[#325099]/40">new tab ↗</span>
          </a>
        </div>
      </aside>
    </div>
  )
}

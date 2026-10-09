'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ADMIN_FLAT_LINKS, ADMIN_GROUPS, BASE_LINKS, RESOURCES_GROUP } from '../lib/portalNavLinks'

/*
 * The director sidebar — every destination in the director portal, in
 * hierarchical sections, so the top bar can stay at four items. Desktop only
 * (hidden below md; the phone menu sheet lists everything already).
 *
 * Pages know nothing about it: the sidebar toggles `dir-sidebar-open` on
 * <body>, and the <style> rendered below shifts content right (shipped with
 * the component, not globals.css, so the rule can never go stale separately).
 * Collapsed, it leaves a slim reopen tab on the left edge. Open/closed and
 * per-section expansion are per-browser conveniences kept in localStorage —
 * never state that matters.
 */

// Desktop only — on phones the NavSheet menu covers everything.
const BODY_SHIFT_CSS = `@media (min-width: 768px) { body.dir-sidebar-open { padding-left: 240px; } }`

const OPEN_KEY = 'dirSidebarOpen'
const SECTIONS_KEY = 'dirSidebarSections'

export default function DirectorSidebar({ pathname }) {
  // Server render and first client render must match, so start open and let
  // the stored preference apply in an effect (one-frame shift, no hydration
  // mismatch; the storage read is guarded for private windows).
  const [open, setOpen] = useState(true)
  const [collapsed, setCollapsed] = useState({})   // section label → true (closed)
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === '0') setOpen(false)
      const stored = JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}')
      if (stored && typeof stored === 'object') setCollapsed(stored)
    } catch { /* storage unavailable — defaults are fine */ }
  }, [])

  // The body class does the layout; cleanup matters when navigating to a
  // page without the sidebar (login, student portal).
  useEffect(() => {
    document.body.classList.toggle('dir-sidebar-open', open)
    return () => document.body.classList.remove('dir-sidebar-open')
  }, [open])

  const sections = useMemo(() => [
    { label: 'Main', links: BASE_LINKS.concat(ADMIN_FLAT_LINKS) },
    RESOURCES_GROUP,
    ...ADMIN_GROUPS,
  ], [])

  const isActive = (href) => (href === '/tutor' ? pathname === '/tutor' : pathname?.startsWith(href))

  const toggleOpen = () => setOpen(o => {
    try { localStorage.setItem(OPEN_KEY, o ? '0' : '1') } catch { /* fine */ }
    return !o
  })
  const toggleSection = (label) => setCollapsed(c => {
    const next = { ...c, [label]: !c[label] }
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)) } catch { /* fine */ }
    return next
  })

  // A section containing the current page never renders closed — finding
  // yourself is the whole point of a sidebar.
  const forcedOpen = (section) => section.links.some(l => isActive(l.href))

  if (!open) {
    return (
      <>
      <style>{BODY_SHIFT_CSS}</style>
      <button
        onClick={toggleOpen}
        title="Open the menu sidebar"
        aria-label="Open the menu sidebar"
        className="hidden md:flex fixed left-0 top-20 z-40 items-center justify-center w-6 h-12 rounded-r-xl bg-white border border-l-0 border-[#DEE7FF] text-[#325099] shadow-sm hover:bg-[#F8FAFF] transition"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      </>
    )
  }

  return (
    <>
    <style>{BODY_SHIFT_CSS}</style>
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-[60] w-[240px] flex-col bg-white border-r border-[#DEE7FF]">
      {/* Header: what this rail is, and the collapse control */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#F0F4FF] shrink-0">
        <span className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-bold">Menu</span>
        <button
          onClick={toggleOpen}
          title="Collapse the sidebar"
          aria-label="Collapse the sidebar"
          className="flex items-center justify-center w-7 h-7 rounded-lg text-[#325099]/60 hover:text-[#062E63] hover:bg-[#F8FAFF] transition"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 2L4 6l4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto py-2">
        {sections.map(section => {
          const shut = collapsed[section.label] && !forcedOpen(section)
          return (
            <div key={section.label} className="px-2 pb-1">
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
                  <Link key={link.href} href={link.href}
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
      <div className="px-2 py-3 border-t border-[#F0F4FF] shrink-0">
        <a href="/tutor/admin/messages" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium transition">
          <span className="text-[15px] leading-none w-5 text-center shrink-0">💬</span>
          Messages
          <span className="ml-auto text-[10px] text-[#325099]/40">new tab ↗</span>
        </a>
      </div>
    </aside>
    </>
  )
}

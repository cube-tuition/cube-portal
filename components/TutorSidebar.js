'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

/*
 * TutorSidebar — collapsible left-hand navigation for the /tutor/hub section.
 *
 * Props:
 *   defaultOpen  — whether the sidebar starts expanded (default true on desktop)
 *
 * The sidebar renders as an icon rail when collapsed, full labels when expanded.
 * Faculty sub-items are grouped under an expandable parent.
 */

const NAV = [
  {
    slug: 'general-expectations',
    label: 'General Expectations',
    icon: '📋',
    href: '/tutor/hub/general-expectations',
  },
  {
    label: 'Faculty',
    icon: '👥',
    children: [
      { slug: 'faculty-maths',   label: 'Maths',   icon: '📐', href: '/tutor/hub/faculty-maths' },
      { slug: 'faculty-english', label: 'English', icon: '📚', href: '/tutor/hub/faculty-english' },
    ],
  },
  {
    slug: 'faq',
    label: 'FAQ',
    icon: '❓',
    href: '/tutor/hub/faq',
  },
  {
    slug: 'child-safety',
    label: 'Child Safety Policy',
    icon: '🛡️',
    href: '/tutor/hub/child-safety',
  },
]

export default function TutorSidebar({ defaultOpen = true }) {
  const pathname = usePathname()
  const [open, setOpen]           = useState(defaultOpen)
  const [facultyOpen, setFacultyOpen] = useState(true)

  const isActive = (href) => {
    if (!href) return false
    return pathname === href || pathname?.startsWith(href + '/')
  }

  return (
    <aside
      className={`shrink-0 transition-all duration-200 ${
        open ? 'w-56' : 'w-14'
      } flex flex-col`}
    >
      <div className="sticky top-[65px] h-[calc(100vh-65px)] flex flex-col bg-white border-r border-[#DEE7FF] overflow-y-auto overflow-x-hidden">

        {/* Collapse toggle */}
        <div className={`flex ${open ? 'justify-end' : 'justify-center'} px-2 pt-3 pb-2`}>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            title={open ? 'Collapse sidebar' : 'Expand sidebar'}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#325099] hover:bg-[#EEF4FF] transition text-sm"
          >
            {open ? '←' : '→'}
          </button>
        </div>

        {/* Section label */}
        {open && (
          <p className="px-4 mb-2 text-[9px] tracking-[0.3em] uppercase font-bold text-[#325099]/50">
            Info Centre
          </p>
        )}

        {/* Nav items */}
        <nav className="flex-1 px-2 space-y-0.5">
          {NAV.map((item) => {
            // Group with children (Faculty)
            if (item.children) {
              const anyChildActive = item.children.some(c => isActive(c.href))
              return (
                <div key={item.label}>
                  {/* Group header */}
                  <button
                    type="button"
                    onClick={() => setFacultyOpen(o => !o)}
                    className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl transition text-left ${
                      anyChildActive
                        ? 'text-[#062E63] font-semibold'
                        : 'text-[#2A2035]/60 hover:text-[#062E63] hover:bg-[#F8FAFF]'
                    }`}
                  >
                    <span className="text-base shrink-0 w-5 text-center">{item.icon}</span>
                    {open && (
                      <>
                        <span className="text-sm flex-1 truncate">{item.label}</span>
                        <span className={`text-xs transition-transform ${facultyOpen ? 'rotate-90' : ''}`}>›</span>
                      </>
                    )}
                  </button>

                  {/* Children */}
                  {(facultyOpen || !open) && (
                    <div className={open ? 'ml-3 mt-0.5 space-y-0.5' : 'space-y-0.5'}>
                      {item.children.map(child => {
                        const active = isActive(child.href)
                        return (
                          <Link
                            key={child.slug}
                            href={child.href}
                            className={`flex items-center gap-3 px-2 py-1.5 rounded-xl transition ${
                              active
                                ? 'bg-[#DEE7FF] text-[#062E63] font-semibold'
                                : 'text-[#2A2035]/60 hover:text-[#062E63] hover:bg-[#F8FAFF]'
                            }`}
                          >
                            <span className="text-sm shrink-0 w-5 text-center">{child.icon}</span>
                            {open && (
                              <span className="text-sm truncate">{child.label}</span>
                            )}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            }

            // Regular item
            const active = isActive(item.href)
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 px-2 py-2 rounded-xl transition ${
                  active
                    ? 'bg-[#DEE7FF] text-[#062E63] font-semibold'
                    : 'text-[#2A2035]/60 hover:text-[#062E63] hover:bg-[#F8FAFF]'
                }`}
              >
                <span className="text-base shrink-0 w-5 text-center">{item.icon}</span>
                {open && (
                  <span className="text-sm truncate">{item.label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer hint */}
        {open && (
          <p className="px-4 py-4 text-[10px] text-[#2A2035]/30 leading-snug">
            Admin-managed content. Contact your admin to update any page.
          </p>
        )}
      </div>
    </aside>
  )
}

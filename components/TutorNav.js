'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import GlobalUndo from './GlobalUndo'

/*
 * Nav for the tutor / admin portal.
 *
 * Admin layout (5 items):
 *   Home · Info · Classes · Operations ▾ · Admin ▾
 *
 * Operations dropdown: Drop-ins, Reports, Payroll
 * Admin dropdown:      Booklets, Database, Transition
 *
 * Tutor layout (4 items):
 *   Home · Info · Classes · My pay
 */

const BASE_LINKS = [
  { label: 'Home',    href: '/tutor' },
  { label: 'Info',    href: '/tutor/hub' },
  { label: 'Classes', href: '/tutor/classes' },
]
const SHARED_GROUPS = []
const TUTOR_LINKS = [
  { label: 'Curriculum',  href: '/tutor/booklets' },
  { label: 'My pay',      href: '/tutor/pay' },
  { label: 'Availability', href: '/tutor/availability' },
]
const ADMIN_FLAT_LINKS = [
  { label: 'Database', href: '/tutor/database' },
]
const ADMIN_GROUPS = [
  {
    label: 'Resources',
    links: [
      { label: 'Mathematics',     href: '/tutor/resources/maths',     icon: '📐' },
      { label: 'English',         href: '/tutor/resources/english',   icon: '📕' },
      { label: 'Chemistry',       href: '/tutor/resources/chemistry', icon: '⚗️' },
      { label: 'Questions',       href: '/tutor/qbank',            icon: '❓' },
      { label: 'Workbooks',       href: '/tutor/booklets/master',  icon: '📓' },
      { label: 'Exams',           href: '/tutor/resources/tests',  icon: '🧪' },
      { label: 'Syllabus',        href: '/tutor/resources/syllabus', icon: '📚' },
    ],
  },
  {
    label: 'Admin',
    links: [
      { label: 'Availabilities', href: '/tutor/admin/availabilities', icon: '📅' },
      { label: 'Drop-ins',      href: '/tutor/dropin',               icon: '☕' },
      { label: 'Emails',        href: '/tutor/emails',               icon: '✉️'  },
      { label: 'Reports',       href: '/tutor/reports',              icon: '📊' },
      { label: 'Timetable',     href: '/tutor/admin/timetable',      icon: '🗓️' },
      { label: 'Transition',    href: '/tutor/transition',           icon: '🔄' },
      { label: 'Trials',        href: '/tutor/trials',               icon: '🧪' },
    ],
  },
  {
    label: 'Accounting',
    links: [
      { label: 'Dashboard',  href: '/tutor/accounting',            icon: '🧮' },
      { label: 'Invoices',   href: '/tutor/accounting/invoices',   icon: '🧾' },
      { label: 'Forecast',   href: '/tutor/accounting/forecast',   icon: '📊' },
      { label: 'Payroll',    href: '/tutor/payroll',               icon: '💳' },
    ],
  },
]

// ── Dropdown component ────────────────────────────────────────────────────────
function NavDropdown({ group, pathname }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey  = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // Group is "active" if any child route matches
  const groupActive = group.links.some(l => pathname?.startsWith(l.href))

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 text-sm px-3.5 py-2 rounded-full transition select-none ${
          groupActive
            ? 'bg-[#DEE7FF] text-[#062E63] font-semibold'
            : 'text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium'
        }`}
      >
        {group.label}
        <svg
          className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white border border-[#DEE7FF] rounded-2xl shadow-xl py-1.5 min-w-[160px] z-50">
          {/* Arrow pointer */}
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-l border-t border-[#DEE7FF] rotate-45" />
          {group.links.map(link => {
            const active = pathname?.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition ${
                  active
                    ? 'text-[#062E63] font-semibold bg-[#F0F4FF]'
                    : 'text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium'
                }`}
              >
                <span className="text-base leading-none">{link.icon}</span>
                {link.label}
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#325099]" />}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Mobile group section (collapsible) ───────────────────────────────────────
function MobileGroup({ group, pathname, onClose }) {
  const [open, setOpen] = useState(false)
  const groupActive = group.links.some(l => pathname?.startsWith(l.href))

  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition ${
          groupActive ? 'text-[#062E63]' : 'text-[#2A2035]/70'
        }`}>
        {group.label}
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="bg-[#F8FAFF] border-t border-[#DEE7FF]">
          {group.links.map(link => {
            const active = pathname?.startsWith(link.href)
            return (
              <Link key={link.href} href={link.href} onClick={onClose}
                className={`flex items-center gap-3 px-7 py-3 text-sm transition ${
                  active ? 'text-[#062E63] font-semibold bg-[#EEF4FF]' : 'text-[#2A2035]/70'
                }`}>
                <span className="text-base leading-none">{link.icon}</span>
                {link.label}
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#325099]" />}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main nav ──────────────────────────────────────────────────────────────────
export default function TutorNav({ staffName, isAdmin = false }) {
  const router        = useRouter()
  const pathname      = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-[#DEE7FF]">
      {/* Portal-wide Ctrl/Cmd+Z undo + toast (TutorNav is on every tutor page) */}
      <GlobalUndo />
      <div className="max-w-7xl mx-auto px-5 md:px-10 py-4 flex items-center justify-between">

        {/* Logo */}
        <Link href="/tutor" className="flex items-center gap-2.5">
          <span className="text-2xl md:text-[1.65rem] font-bold tracking-tight text-[#062E63] font-display">
            CUBE
          </span>
          <span className="hidden sm:inline-block text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold pt-0.5">
            {isAdmin ? 'Director Portal' : 'Tutor Portal'}
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {BASE_LINKS.map(link => {
            const active = link.href === '/tutor' ? pathname === '/tutor' : pathname?.startsWith(link.href)
            return (
              <Link key={link.href} href={link.href}
                className={`text-sm px-3.5 py-2 rounded-full transition ${active ? 'bg-[#DEE7FF] text-[#062E63] font-semibold' : 'text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium'}`}>
                {link.label}
              </Link>
            )
          })}
          {SHARED_GROUPS.map(group => (
            <NavDropdown key={group.label} group={group} pathname={pathname} />
          ))}
          {isAdmin && ADMIN_GROUPS.map(group => (
            <NavDropdown key={group.label} group={group} pathname={pathname} />
          ))}
          {isAdmin && ADMIN_FLAT_LINKS.map(link => {
            const active = pathname?.startsWith(link.href)
            return (
              <Link key={link.href} href={link.href}
                className={`text-sm px-3.5 py-2 rounded-full transition ${active ? 'bg-[#DEE7FF] text-[#062E63] font-semibold' : 'text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium'}`}>
                {link.label}
              </Link>
            )
          })}
          {!isAdmin && TUTOR_LINKS.map(link => {
            const active = pathname?.startsWith(link.href)
            return (
              <Link key={link.href} href={link.href}
                className={`text-sm px-3.5 py-2 rounded-full transition ${active ? 'bg-[#DEE7FF] text-[#062E63] font-semibold' : 'text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium'}`}>
                {link.label}
              </Link>
            )
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {staffName && (
            <span className="hidden sm:inline-flex items-center gap-2 text-xs font-semibold text-[#062E63] bg-[#F8FAFF] border border-[#DEE7FF] px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
              {staffName.split(' ')[0]}{isAdmin ? ' (director)' : ''}
            </span>
          )}
          <button onClick={handleLogout}
            className="hidden md:block text-sm font-semibold text-[#062E63] hover:text-[#325099] px-3 py-2 rounded-full transition">
            Logout
          </button>
          {/* Hamburger — mobile only */}
          <button onClick={() => setMobileOpen(o => !o)}
            className="md:hidden flex flex-col justify-center items-center w-9 h-9 gap-1.5 rounded-xl hover:bg-[#F8FAFF] transition"
            aria-label="Menu">
            <span className={`block w-5 h-0.5 bg-[#062E63] rounded transition-all duration-200 ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#062E63] rounded transition-all duration-200 ${mobileOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#062E63] rounded transition-all duration-200 ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#DEE7FF] bg-white divide-y divide-[#DEE7FF]">
          {/* Base links */}
          {BASE_LINKS.map(link => {
            const active = link.href === '/tutor' ? pathname === '/tutor' : pathname?.startsWith(link.href)
            return (
              <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
                className={`flex items-center px-5 py-3.5 text-sm font-medium transition ${active ? 'text-[#062E63] font-semibold bg-[#EEF4FF]' : 'text-[#2A2035]/70'}`}>
                {link.label}
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#325099]" />}
              </Link>
            )
          })}
          {/* Shared groups (all users) */}
          {SHARED_GROUPS.map(group => (
            <MobileGroup key={group.label} group={group} pathname={pathname} onClose={() => setMobileOpen(false)} />
          ))}
          {/* Admin groups */}
          {isAdmin && ADMIN_GROUPS.map(group => (
            <MobileGroup key={group.label} group={group} pathname={pathname} onClose={() => setMobileOpen(false)} />
          ))}
          {/* Admin flat */}
          {isAdmin && ADMIN_FLAT_LINKS.map(link => {
            const active = pathname?.startsWith(link.href)
            return (
              <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
                className={`flex items-center px-5 py-3.5 text-sm font-medium transition ${active ? 'text-[#062E63] font-semibold bg-[#EEF4FF]' : 'text-[#2A2035]/70'}`}>
                {link.label}
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#325099]" />}
              </Link>
            )
          })}
          {/* Tutor links */}
          {!isAdmin && TUTOR_LINKS.map(link => {
            const active = pathname?.startsWith(link.href)
            return (
              <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
                className={`flex items-center px-5 py-3.5 text-sm font-medium transition ${active ? 'text-[#062E63] font-semibold bg-[#EEF4FF]' : 'text-[#2A2035]/70'}`}>
                {link.label}
              </Link>
            )
          })}
          {/* Footer row */}
          <div className="px-5 py-3.5 flex items-center justify-between">
            {staffName && (
              <span className="flex items-center gap-2 text-xs font-semibold text-[#062E63]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                {staffName}{isAdmin ? ' (director)' : ''}
              </span>
            )}
            <button onClick={handleLogout} className="text-sm font-semibold text-red-500 hover:text-red-700 transition ml-auto">
              Logout
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}

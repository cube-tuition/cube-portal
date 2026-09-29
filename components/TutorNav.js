'use client'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import GlobalUndo from './GlobalUndo'
import { recordPortalActivity, recordPageView } from '../lib/activity'
import { useIsNativeApp } from '../lib/nativeApp'
import { SUBJECTS } from '../lib/resourceSubjects'
import CubeLogo from './CubeLogo'

/*
 * Nav for the tutor / admin portal.
 *
 * Admin layout (5 items):
 *   Home · Info · Classes · Operations ▾ · Admin ▾
 *
 * Operations dropdown: Drop-ins, Reports, Payroll
 * Admin dropdown:      Booklets, Database, Transition
 *
 * Messages is not in a dropdown: it's the bubble button on the right of the
 * bar, and it opens in its own tab, because it is the one page you keep open
 * beside whatever else you are doing.
 *
 * Tutor layout (4 items):
 *   Home · Info · Classes · My pay
 */

const BASE_LINKS = [
  { label: 'Home',    href: '/tutor',         icon: '🏠' },
  { label: 'Info',    href: '/tutor/hub',     icon: '📌' },
  { label: 'Classes', href: '/tutor/classes', icon: '🏫' },
]
const SHARED_GROUPS = []
/*
 * One row per subject hub, built from the hub config rather than typed out
 * twice here: a subject added to lib/resourceSubjects reaches both dropdowns
 * (and its own pages) without a nav list to remember.
 */
const subjectLinks = (suffix = '') => Object.entries(SUBJECTS).map(([slug, s]) => ({
  label: s.label, href: `/tutor/resources/${slug}${suffix}`, icon: s.icon,
}))
// Tutors get Materials only — each subject goes straight to its Materials
// page (read-only there: no builder, view-only booklet info). The rest of
// Resources (tests, syllabus, question bank) is directors' territory.
const TUTOR_GROUPS = [
  { label: 'Materials', links: subjectLinks('/materials') },
]
const TUTOR_LINKS = [
  { label: 'Curriculum',  href: '/tutor/booklets',     icon: '📚' },
  { label: 'My pay',      href: '/tutor/pay',          icon: '💰' },
  { label: 'Availability', href: '/tutor/availability', icon: '📅' },
]
const ADMIN_FLAT_LINKS = [
  { label: 'Database', href: '/tutor/database', icon: '🗄️' },
]
const ADMIN_GROUPS = [
  { label: 'Resources', links: subjectLinks() },
  {
    label: 'Admin',
    links: [
      { label: 'Availabilities', href: '/tutor/admin/availabilities', icon: '📅' },
      { label: 'Drop-ins',      href: '/tutor/dropin',               icon: '☕' },
      { label: 'Emails',        href: '/tutor/emails',               icon: '✉️'  },
      { label: 'Forms',         href: '/tutor/admin/forms',         icon: '📝' },
      { label: 'Marketing',     href: '/tutor/admin/marketing',     icon: '📣' },
      // Portal analytics, Trials and Flags all live under Monitoring now — the
      // hub links to all three, so they are not repeated here.
      { label: 'Monitoring',    href: '/tutor/admin/monitoring',     icon: '📶' },
      { label: 'Reports',       href: '/tutor/reports',              icon: '📊' },
      { label: 'Timetable',     href: '/tutor/admin/timetable',      icon: '🗓️' },
      { label: 'Transition',    href: '/tutor/transition',           icon: '🔄' },
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
/*
 * The phone menu: a sheet that slides in from the right over a dimmed page.
 * Your name and role on top, the everyday pages as big tiles, then each nav
 * section as a labelled grid of icon buttons, and log out at the foot.
 *
 * Rendered through a portal to <body>: the nav bar has backdrop-blur, and a
 * backdrop-filter makes fixed-position children position against the nav
 * instead of the screen, which would clip the sheet to the bar.
 */
function MobileSheet({ open, onClose, pathname, staffName, isAdmin, onLogout }) {
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

  const isActive = (href) => (href === '/tutor' ? pathname === '/tutor' : pathname?.startsWith(href))
  const first = (staffName || '').split(' ')[0]
  // Messages isn't repeated here: the envelope in the top bar already opens it.
  const primary = BASE_LINKS
  const sections = [
    ...(!isAdmin ? TUTOR_GROUPS : []),
    ...(!isAdmin ? [{ label: 'My work', links: TUTOR_LINKS }] : []),
    ...(isAdmin ? ADMIN_GROUPS : []),
    ...(isAdmin ? [{ label: 'Data', links: ADMIN_FLAT_LINKS }] : []),
  ]

  const Tile = ({ link, big }) => {
    const active = isActive(link.href)
    return (
      <Link href={link.href} onClick={onClose}
        className={`flex ${big ? 'flex-col items-start gap-2 p-3.5' : 'items-center gap-2.5 px-3 py-2.5'} rounded-2xl border transition active:scale-[0.98] ${
          active ? 'bg-[#062E63] border-[#062E63] text-white' : 'bg-white border-[#E5ECFF] text-[#2A2035] active:bg-[#F0F4FF]'}`}>
        <span className={`${big ? 'text-xl' : 'text-base'} leading-none`}>{link.icon || '•'}</span>
        <span className={`text-[13px] font-semibold leading-tight ${active ? 'text-white' : ''}`}>{link.label}</span>
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
            <p className="text-[15px] font-bold text-[#062E63] truncate">{staffName || 'CUBE Tuition'}</p>
            <p className="text-[11px] font-semibold text-[#325099]/70">{isAdmin ? 'Director' : 'Tutor'} · CUBE Portal</p>
          </div>
          <button onClick={onClose} aria-label="Close menu"
            className="w-9 h-9 rounded-full bg-white border border-[#E5ECFF] text-[#062E63] text-lg flex items-center justify-center active:bg-[#F0F4FF]">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">
          {/* Everyday pages */}
          <div className="grid grid-cols-3 gap-2.5">
            {primary.map((l) => <Tile key={l.href} link={l} big />)}
          </div>
          {/* Each section */}
          {sections.map((g) => (
            <div key={g.label}>
              <p className="px-1 mb-2 text-[10px] font-bold tracking-[0.18em] uppercase text-[#325099]/60">{g.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {g.links.map((l) => <Tile key={l.href} link={l} />)}
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

// ── Main nav ──────────────────────────────────────────────────────────────────
export default function TutorNav({ staffName, isAdmin = false }) {
  const inApp = useIsNativeApp()
  // Usage heartbeat — same rule as the student nav: throttled, fire-and-forget.
  useEffect(() => { recordPortalActivity() }, [])

  const router        = useRouter()
  const pathname      = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Page-level tracking. Declared after `pathname` exists, unlike the
  // heartbeat above which needs nothing from the component.
  useEffect(() => { recordPageView(pathname) }, [pathname])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <nav className="sticky top-0 z-50 bg-white/95 app:bg-white backdrop-blur-md app:backdrop-blur-none border-b border-[#DEE7FF]">
      {/* Portal-wide Ctrl/Cmd+Z undo + toast (TutorNav is on every tutor page) */}
      <GlobalUndo />
      <div className="max-w-7xl mx-auto px-5 md:px-10 py-4 flex items-center justify-between">

        {/* Logo */}
        <Link href="/tutor" className="flex items-center gap-2.5">
          <CubeLogo className="h-7 md:h-8 w-auto text-[#062E63] shrink-0" />
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
          {!isAdmin && TUTOR_GROUPS.map(group => (
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
          {/* Messages — opens in its own tab, so replying never costs you the
              page you were on. Shown at every width, next to the hamburger. */}
          {/* In the iPhone app there are no tabs (a new tab is Safari), so it
              opens the phone-shaped inbox in place instead. */}
          {isAdmin && (
            <a href={inApp ? '/messages' : '/tutor/admin/messages'}
              {...(inApp ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              title={inApp ? 'Messages' : 'Messages — opens in a new tab'}
              aria-label={inApp ? 'Messages' : 'Messages (opens in a new tab)'}
              className="flex items-center justify-center w-9 h-9 rounded-xl text-[#062E63] hover:bg-[#F8FAFF] transition">
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4.5 3h11A2.5 2.5 0 0 1 18 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4 3v-3h-.5A2.5 2.5 0 0 1 2 11.5v-6A2.5 2.5 0 0 1 4.5 3Z" />
                <path d="M6 7h8M6 10h5" />
              </svg>
            </a>
          )}
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

      {/* Mobile menu — a full-height sheet (see MobileSheet) */}
      <MobileSheet open={mobileOpen} onClose={() => setMobileOpen(false)} pathname={pathname}
        staffName={staffName} isAdmin={isAdmin} onLogout={handleLogout} />
    </nav>
  )
}

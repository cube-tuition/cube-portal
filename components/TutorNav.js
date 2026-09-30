'use client'
import { useState, useRef, useEffect } from 'react'
import NavSheet from './NavSheet'
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
      // desktopOnly: the term-transition wizard is a sit-down job; the phone menu skips it.
      { label: 'Transition',    href: '/tutor/transition',           icon: '🔄', desktopOnly: true },
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
// ── Main nav ──────────────────────────────────────────────────────────────────
export default function TutorNav({ staffName, isAdmin = false }) {
  const inApp = useIsNativeApp()
  // Unread staff-chat messages for the badge: polled, and refreshed on focus.
  const [chatUnread, setChatUnread] = useState(0)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const { data } = await supabase.rpc('chat_unread_counts')
        if (alive) setChatUnread((data || []).reduce((n, r) => n + (Number(r.n) || 0), 0))
      } catch { /* badge is best-effort */ }
    }
    tick()
    const onWake = () => { if (document.visibilityState === 'visible') tick() }
    const t = setInterval(tick, 45000)
    document.addEventListener('visibilitychange', onWake); window.addEventListener('focus', onWake)
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onWake); window.removeEventListener('focus', onWake) }
  }, [pathname])
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
          {/* Staff chat — tutors get their own icon; directors reach it as the
              Staff tab of Messages, whose icon carries the badge instead. */}
          {!isAdmin && <Link href="/tutor/chat" title="Staff chat" aria-label="Staff chat"
            className={`relative flex items-center justify-center w-9 h-9 rounded-xl transition ${pathname?.startsWith('/tutor/chat') ? 'bg-[#DEE7FF] text-[#062E63]' : 'text-[#062E63] hover:bg-[#F8FAFF]'}`}>
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h6A2.5 2.5 0 0 1 14 5.5v3a2.5 2.5 0 0 1-2.5 2.5H8l-3 2.5V11A2.5 2.5 0 0 1 3 8.5v-3Z" />
              <path d="M14 8h.5A2.5 2.5 0 0 1 17 10.5v3a2.5 2.5 0 0 1-2.5 2.5H14v2.5L11 16H9" />
            </svg>
            {chatUnread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#B23A3A] text-white text-[10px] font-bold flex items-center justify-center">{chatUnread > 99 ? '99+' : chatUnread}</span>}
          </Link>}
          {/* Messages — opens in its own tab, so replying never costs you the
              page you were on. Shown at every width, next to the hamburger. */}
          {/* In the iPhone app there are no tabs (a new tab is Safari), so it
              opens the phone-shaped inbox in place instead. */}
          {isAdmin && (
            <a href={inApp ? '/messages' : '/tutor/admin/messages'}
              {...(inApp ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              title={inApp ? 'Messages' : 'Messages — opens in a new tab'}
              aria-label={inApp ? 'Messages' : 'Messages (opens in a new tab)'}
              className="relative flex items-center justify-center w-9 h-9 rounded-xl text-[#062E63] hover:bg-[#F8FAFF] transition">
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4.5 3h11A2.5 2.5 0 0 1 18 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4 3v-3h-.5A2.5 2.5 0 0 1 2 11.5v-6A2.5 2.5 0 0 1 4.5 3Z" />
                <path d="M6 7h8M6 10h5" />
              </svg>
              {chatUnread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#B23A3A] text-white text-[10px] font-bold flex items-center justify-center" title="Unread staff chat">{chatUnread > 99 ? '99+' : chatUnread}</span>}
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

      {/* Mobile menu — a full-height sheet (see components/NavSheet.js).
          Messages isn't repeated in it: the envelope in the top bar already opens it. */}
      <NavSheet open={mobileOpen} onClose={() => setMobileOpen(false)} onLogout={handleLogout}
        name={staffName} role={isAdmin ? 'Director' : 'Tutor'}
        isActive={(href) => (href === '/tutor' ? pathname === '/tutor' : pathname?.startsWith(href))}
        primary={BASE_LINKS}
        sections={[
          ...(!isAdmin ? TUTOR_GROUPS : []),
          ...(!isAdmin ? [{ label: 'My work', links: TUTOR_LINKS }] : []),
          ...(isAdmin ? ADMIN_GROUPS : []),
          ...(isAdmin ? [{ label: 'Data', links: ADMIN_FLAT_LINKS }] : []),
        ].map((g) => ({ ...g, links: g.links.filter((l) => !l.desktopOnly) }))} />
    </nav>
  )
}

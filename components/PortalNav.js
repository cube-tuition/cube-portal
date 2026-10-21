'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { signOutEverywhere, confirmLogOut } from '../lib/nativeApp'
import { recordPortalActivity, recordPageView } from '../lib/activity'
import { T_STUDENTS } from '../lib/tables'
import CubeLogo from './CubeLogo'
import NavSheet from './NavSheet'

// Icons show in the phone menu (see NavSheet), where `primary` links are the
// big tiles and the rest sit under "More"; the desktop bar is text only.
const LINKS = [
  { label: 'Home', href: '/dashboard', icon: '🏠', primary: true },
  { label: 'Classes', href: '/classes', icon: '🏫', primary: true },
  // `soon` tags a link whose page is still being finished — the page itself
  // shows the coming-soon panel; this just sets the expectation beforehand.
  { label: 'Resources', href: '/resources', icon: '📚' },
  // Seniors only — trials/HSC preparation. Filtered out for other years below.
  { label: 'Past Papers', href: '/pastpapers', icon: '📝', seniorOnly: true },
  { label: 'Drop-in Help', href: '/dropin', icon: '🙋', primary: true },
  { label: 'Past Terms', href: '/archive', icon: '🗂️' },
]
const YEAR_KEY = 'cube:student-year'

export default function PortalNav({ studentName }) {
  const router = useRouter()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)   // phone menu (NavSheet)

  // Usage heartbeat — the nav renders on every signed-in page, and the ping
  // throttles itself, so this is one write per visit, not per navigation.
  useEffect(() => { recordPortalActivity() }, [])
  // Page-level tracking, which DOES want one write per navigation.
  useEffect(() => { recordPageView(pathname) }, [pathname])

  // The Past Papers link only shows for Years 11–12. The year is fetched once
  // per tab session and cached, so this costs one query, not one per page.
  const [year, setYear] = useState(() => {
    try { return sessionStorage.getItem(YEAR_KEY) || '' } catch { return '' }
  })
  useEffect(() => {
    if (year) return
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) return
        const { data } = await supabase.from(T_STUDENTS)
          .select('year').eq('id', session.user.id).maybeSingle()
        const y = String(data?.year ?? '')
        if (y) { sessionStorage.setItem(YEAR_KEY, y); setYear(y) }
      } catch { /* nav link stays hidden — the page itself gates too */ }
    })()
  }, [year])
  const highSchool = ['7', '8', '9', '10', '11', '12'].includes(year)
  const links = LINKS.filter(l => (!l.seniorOnly || year === '11' || year === '12'))
  // Messages (Years 7–12): the same icon directors have, beside the menu at
  // every width, with the unread count — polled, and refreshed on focus.
  const [chatUnread, setChatUnread] = useState(0)
  useEffect(() => {
    if (!highSchool) return
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
  }, [highSchool, pathname])
  const isActive = (href) => (href === '/dashboard' ? pathname === '/dashboard' : pathname?.startsWith(href))

  const handleLogout = async () => {
    if (!confirmLogOut()) return
    await signOutEverywhere(supabase)
    router.push('/')
  }

  return (
    <nav className="sticky top-0 z-50 bg-white/85 app:bg-white backdrop-blur-md app:backdrop-blur-none border-b border-[#DEE7FF] app:pt-[env(safe-area-inset-top)]">
      <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 group"
        >
          <CubeLogo className="h-7 md:h-8 w-auto text-[#062E63] shrink-0" />
          <span
            className="text-2xl md:text-[1.65rem] font-bold tracking-tight text-[#062E63] font-display"
          >
            CUBE
          </span>
          <span className="hidden sm:inline-block text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold pt-0.5">
            Tuition Portal
          </span>
        </Link>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-1">
          {links.map((link) => {
            const active = isActive(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm px-3.5 py-2 rounded-full transition ${
                  active
                    ? 'bg-[#DEE7FF] text-[#062E63] font-semibold'
                    : 'text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F8FAFF] font-medium'
                }`}
              >
                {link.label}
                {link.soon && (
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-[#325099]/60 align-middle">Soon</span>
                )}
              </Link>
            )
          })}
        </div>

        {/* Right side: messages, student chip, logout */}
        <div className="flex items-center gap-2">
          {highSchool && (
            <Link href="/chat" title="Messages" aria-label="Messages"
              className={`relative flex items-center justify-center w-9 h-9 rounded-xl transition ${isActive('/chat') ? 'bg-[#DEE7FF] text-[#062E63]' : 'text-[#062E63] hover:bg-[#F8FAFF]'}`}>
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4.5 3h11A2.5 2.5 0 0 1 18 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4 3v-3h-.5A2.5 2.5 0 0 1 2 11.5v-6A2.5 2.5 0 0 1 4.5 3Z" />
                <path d="M6 7h8M6 10h5" />
              </svg>
              {chatUnread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#B23A3A] text-white text-[10px] font-bold flex items-center justify-center">{chatUnread > 99 ? '99+' : chatUnread}</span>}
            </Link>
          )}
          {studentName && (
            <span className="hidden sm:inline-flex items-center gap-2 text-xs font-semibold text-[#062E63] bg-[#F8FAFF] border border-[#DEE7FF] px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
              {studentName.split(' ')[0]}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="hidden md:block text-sm font-semibold text-[#062E63] hover:text-[#325099] px-3 py-2 rounded-full transition"
          >
            Logout
          </button>
          {/* Hamburger — mobile only (same as the staff nav) */}
          <button onClick={() => setMobileOpen(o => !o)}
            className="md:hidden flex flex-col justify-center items-center w-9 h-9 gap-1.5 rounded-xl hover:bg-[#F8FAFF] transition"
            aria-label="Menu">
            <span className={`block w-5 h-0.5 bg-[#062E63] rounded transition-all duration-200 ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#062E63] rounded transition-all duration-200 ${mobileOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#062E63] rounded transition-all duration-200 ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </div>

      {/* Phone menu — the same sheet the staff portal uses */}
      <NavSheet open={mobileOpen} onClose={() => setMobileOpen(false)} onLogout={handleLogout}
        name={studentName} role="Student" isActive={isActive}
        primary={links.filter(l => l.primary)} sections={[{ label: 'More', links: links.filter(l => !l.primary) }]} />
    </nav>
  )
}

'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

const LINKS = [
  { label: 'Home', href: '/dashboard' },
  { label: 'Results', href: '/results' },
  { label: 'Resources', href: '/resources' },
  { label: 'Drop-in Help', href: '/dropin' },
  { label: 'Past Terms', href: '/archive' },
]

export default function PortalNav({ studentName }) {
  const router = useRouter()
  const pathname = usePathname()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <nav className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-[#DEE7FF]">
      <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 group"
        >
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
          {LINKS.map((link) => {
            const active =
              link.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname?.startsWith(link.href)
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
              </Link>
            )
          })}
        </div>

        {/* Right side: student chip + logout */}
        <div className="flex items-center gap-2">
          {studentName && (
            <span className="hidden sm:inline-flex items-center gap-2 text-xs font-semibold text-[#062E63] bg-[#F8FAFF] border border-[#DEE7FF] px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
              {studentName.split(' ')[0]}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="text-xs md:text-sm font-semibold text-[#062E63] hover:text-[#325099] px-3 py-2 rounded-full transition"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  )
}

'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

/*
 * Nav for the tutor / admin portal. Visually identical to PortalNav but
 * points at /tutor routes and labels itself "Tutor Portal" so signed-in
 * staff never wonder which view they're in.
 */

const BASE_LINKS = [
  { label: 'Home',    href: '/tutor' },
  { label: 'Classes', href: '/tutor/classes' },
  { label: 'Info',    href: '/tutor/hub' },
]
const TUTOR_LINKS = [
  { label: 'My pay',   href: '/tutor/pay' },
]
const ADMIN_LINKS = [
  { label: 'Payroll',  href: '/tutor/payroll' },
  { label: 'Reports',  href: '/tutor/reports' },
  { label: 'Students', href: '/tutor/students' },
]

export default function TutorNav({ staffName, isAdmin = false }) {
  const router = useRouter()
  const pathname = usePathname()
  // Admins use the full admin payroll page; everyone else gets their own
  // "My pay" link instead.
  const LINKS = isAdmin
    ? [...BASE_LINKS, ...ADMIN_LINKS]
    : [...BASE_LINKS, ...TUTOR_LINKS]

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <nav className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-[#DEE7FF]">
      <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
        <Link href="/tutor" className="flex items-center gap-2.5">
          <span className="text-2xl md:text-[1.65rem] font-bold tracking-tight text-[#062E63] font-display">
            CUBE
          </span>
          <span className="hidden sm:inline-block text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold pt-0.5">
            Tutor Portal{isAdmin ? ' · Admin' : ''}
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {LINKS.map((link) => {
            const active = link.href === '/tutor'
              ? pathname === '/tutor'
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

        <div className="flex items-center gap-2">
          {staffName && (
            <span className="hidden sm:inline-flex items-center gap-2 text-xs font-semibold text-[#062E63] bg-[#F8FAFF] border border-[#DEE7FF] px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
              {staffName.split(' ')[0]}{isAdmin ? ' (admin)' : ''}
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

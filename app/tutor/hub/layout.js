'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import TutorSidebar from '../../../components/TutorSidebar'
import { HubContext } from './context'

/*
 * Layout for /tutor/hub/*
 * Renders: TutorNav (top) + TutorSidebar (left) + page content (right).
 * Fetches the staff profile once so child pages don't need to repeat auth.
 * Staff/isAdmin is passed down via a shared context (HubContext) defined in ./context.js
 * to prevent Next.js module-splitting from creating two copies of the context.
 */

export default function HubLayout({ children }) {
  const router = useRouter()
  const [staff, setStaff]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile || !['tutor', 'admin', 'director'].includes(profile.role)) {
        router.push('/dashboard'); return
      }
      setStaff(profile)
      setLoading(false)
    }
    load()
  }, [router])

  // Directors + admins are Info Centre editors; tutors are viewers.
  const canEdit = staff?.role === 'admin' || staff?.role === 'director'
  const isAdmin = canEdit

  return (
    <HubContext.Provider value={{ staff, isAdmin, canEdit, loading }}>
      <div className="min-h-screen bg-[#F8FAFF] flex flex-col">
        {/* Top nav — shown even while loading so the page doesn't flash bare */}
        <TutorNav staffName={staff?.full_name} isAdmin={isAdmin} />

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          <TutorSidebar defaultOpen={true} />

          {/* Page content */}
          <main className="flex-1 min-w-0 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#325099]">Loading…</p>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </HubContext.Provider>
  )
}

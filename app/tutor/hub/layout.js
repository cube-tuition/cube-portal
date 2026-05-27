'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: profile } = await supabase
        .from('students').select('*').eq('id', user.id).single()
      if (!profile || (profile.role !== 'tutor' && profile.role !== 'admin')) {
        router.push('/dashboard'); return
      }
      setStaff(profile)
      setLoading(false)
    }
    load()
  }, [router])

  const isAdmin = staff?.role === 'admin'

  return (
    <HubContext.Provider value={{ staff, isAdmin, loading }}>
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

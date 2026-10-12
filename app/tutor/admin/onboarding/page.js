'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'

/*
 * Onboarding — /tutor/admin/onboarding (directors only)
 *
 * A placeholder under Admin; its contents are still to be decided.
 */
export default function OnboardingPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })()
  }, [router])

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={true} />
      <div className="max-w-5xl mx-auto px-4 pt-5 pb-16 md:px-6 md:pt-10">
        <div className="rounded-2xl px-5 py-5 md:px-7 md:py-6 mb-5 md:mb-8 border bg-[#EEF3FF] border-[#DEE7FF]">
          <div className="flex items-center gap-3">
            <span className="text-3xl">👋</span>
            <div>
              <h1 className="text-2xl font-bold text-[#062E63]">Onboarding</h1>
              <p className="text-xs text-[#2A2035]/55 mt-0.5">Nothing here yet.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

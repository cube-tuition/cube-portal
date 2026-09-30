'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import StaffChat from '../../../components/chat/StaffChat'

/*
 * Staff chat — /tutor/chat. Every teacher; directors also reach the same chat
 * from the Staff tab of their Messages inbox.
 */
export default function ChatPage() { return <Suspense><ChatInner /></Suspense> }

function ChatInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [me, setMe] = useState(null)
  useEffect(() => {
    (async () => {
      const { user, profile, role } = await getAuthProfile()
      if (!user || !['admin', 'director', 'tutor'].includes(role)) { router.replace('/tutor'); return }
      setMe({ id: user.id, full_name: profile?.full_name || user.email, isAdmin: role !== 'tutor' })
    })()
  }, [router])
  if (!me) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  return (
    <div className="h-[100dvh] flex flex-col bg-[#F8FAFF]">
      <TutorNav staffName={me.full_name} isAdmin={me.isAdmin} />
      <StaffChat me={me} initialChannel={params.get('c') || ''} className="flex-1 min-h-0" />
    </div>
  )
}

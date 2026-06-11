'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import QuestionEditor from '../../../../components/qbank/QuestionEditor'

export default function NewQuestionPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-3xl mx-auto px-6 pt-8 pb-16">
        <Link href="/tutor/qbank" className="text-xs text-[#325099] hover:underline">← Question bank</Link>
        <h1 className="text-2xl font-bold text-[#062E63] mt-1 mb-6">New question</h1>
        <QuestionEditor staffName={profile?.full_name} />
      </div>
    </div>
  )
}

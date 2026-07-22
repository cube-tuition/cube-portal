'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import QuestionEditor from '../../../../components/qbank/QuestionEditor'
import { SUBJECT_FAMILIES, SCOPE_LABEL } from '../../../../lib/qbank'

export default function NewQuestionPage() {
  return <Suspense><NewQuestionInner /></Suspense>
}

function NewQuestionInner() {
  const router = useRouter()
  // Subject-hub scope (?subject=Maths|English|Chemistry): pre-selects the
  // subject in the editor. Absent → unchanged behaviour.
  const searchParams = useSearchParams()
  const scopeParam = searchParams.get('subject')
  const scope = SUBJECT_FAMILIES[scopeParam] ? scopeParam : null
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
        <Link href={`/tutor/qbank${scope ? `?subject=${scope}` : ''}`} className="text-xs text-[#325099] hover:underline">← Question bank</Link>
        <h1 className="text-2xl font-bold text-[#062E63] mt-1 mb-6">New question{scope ? ` — ${SCOPE_LABEL[scope]}` : ''}</h1>
        <QuestionEditor staffName={profile?.full_name} defaults={scope ? { subjectName: scope } : null} />
      </div>
    </div>
  )
}

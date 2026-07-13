'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'

/*
 * Generate — /tutor/qbank/generate
 * Thin chooser only. The worksheet builder used to be duplicated here as an
 * ad-hoc (unsaved) copy of /tutor/qbank/worksheets; the two are now one —
 * "Additional questions" creates a saved worksheet and opens the builder, so
 * every worksheet is autosaved and re-exportable by default.
 */

export default function GeneratePage() {
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
      <div className="max-w-[1480px] mx-auto px-6 pt-8 pb-16">
        <Link href="/tutor/qbank" className="text-xs text-[#325099] hover:underline">← Question bank</Link>
        <h1 className="text-2xl font-bold text-[#062E63] mt-1 mb-5">Generate</h1>

        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          <button onClick={() => router.push('/tutor/qbank/worksheets?new=1')}
            className="text-left bg-white rounded-2xl border border-[#DEE7FF] p-5 hover:border-[#325099] hover:shadow-sm transition">
            <div className="text-2xl mb-2">📝</div>
            <div className="text-base font-bold text-[#062E63]">Additional questions</div>
            <p className="text-xs text-[#2A2035]/60 mt-1">Pick questions from the bank and export a practice worksheet with a matching answer key. Saves automatically so you can edit and re-export any time.</p>
            <span className="inline-block mt-3 text-[11px] font-semibold text-[#325099]">Start →</span>
          </button>
          <button onClick={() => router.push('/tutor/qbank/exams')}
            className="text-left bg-white rounded-2xl border border-[#DEE7FF] p-5 hover:border-[#325099] hover:shadow-sm transition">
            <div className="text-2xl mb-2">🧪</div>
            <div className="text-base font-bold text-[#062E63]">Exam</div>
            <p className="text-xs text-[#2A2035]/60 mt-1">Plan a formatted exam — topic scope, sections, marks — then fill each question slot from the bank and export the paper + solutions.</p>
            <span className="inline-block mt-3 text-[11px] font-semibold text-[#325099]">Go to exams →</span>
          </button>
        </div>
      </div>
    </div>
  )
}

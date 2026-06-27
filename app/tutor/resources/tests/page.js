'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import ExamsPanel from '../../../../components/resources/ExamsPanel'
import LevelTestsPanel from '../../../../components/resources/LevelTestsPanel'
import PreTestsPanel from '../../../../components/resources/PreTestsPanel'

/*
 * Tests — a single Resources page that holds Exams and Level Tests, each under
 * its own main tab. The list/builder logic lives in the shared panels so the
 * old standalone routes can simply redirect here.
 */
function TestsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const tabParam = searchParams.get('tab')
  const initialTab = ['level-tests', 'pre-tests'].includes(tabParam) ? tabParam : 'exams'
  const [tab, setTab] = useState(initialTab)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const TABS = [['exams', 'Term Tests'], ['level-tests', 'Level Tests'], ['pre-tests', 'Pre-tests']]

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-4xl mx-auto px-6 pt-8 pb-16">
        <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-1">Resources</p>
        <h1 className="text-2xl font-bold text-[#062E63] mb-5">Exams</h1>

        {/* Main tabs */}
        <div className="flex items-center gap-2 mb-6">
          {TABS.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`px-5 py-2 rounded-full text-sm font-semibold border transition ${
                tab === v
                  ? 'bg-[#062E63] text-white border-[#062E63]'
                  : 'bg-white text-[#062E63] border-[#DEE7FF] hover:bg-[#F8FAFF]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'exams' && <ExamsPanel profile={profile} />}
        {tab === 'level-tests' && <LevelTestsPanel profile={profile} />}
        {tab === 'pre-tests' && <PreTestsPanel profile={profile} />}
      </div>
    </div>
  )
}

export default function TestsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F8FAFF]" />}>
      <TestsInner />
    </Suspense>
  )
}

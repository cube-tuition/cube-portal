'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import EnrolmentTrend from '../../../../components/EnrolmentTrend'

/*
 * Monitoring — /tutor/admin/monitoring (admin only)
 *
 * A hub, not a screen of its own: the places you go to see how the
 * portal and the people in it are tracking. Each of these existed already and
 * still lives at its own URL — this page gathers them under one heading so the
 * Admin menu is not a flat list of ten unrelated items.
 */
// Alphabetical, like the Admin menu these came out of — with four unrelated
// areas there is no meaningful running order, so the one that is easiest to
// scan wins.
const AREAS = [
  { label: 'Attendance', href: '/tutor/admin/monitoring/attendance', icon: '📋',
    desc: 'Attendance across every class for a term, the students slipping below the line, and the absences inbox for following each absence up.' },
  { label: 'Flags',      href: '/tutor/flags', icon: '🚩',
    desc: 'Students tutors have flagged for attention, and what has been done about each one.' },
  { label: 'Level tests', href: '/tutor/admin/monitoring/level-tests', icon: '📝',
    desc: 'Book a student in for a level test, mark the paper per question and send the report with its topical analysis.' },
  { label: 'Portal',     href: '/tutor/admin/monitoring/portal', icon: '📶',
    desc: 'Student engagement across the portal — logins, page views, quiz and homework results, and any client crashes from the last fortnight.' },
  { label: 'Trials',     href: '/tutor/trials', icon: '🧪',
    desc: 'Trial enquiries and trial students, from first contact through to enrolled or declined.' },
]

export default function MonitoringHub() {
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
            <span className="text-3xl">📶</span>
            <div>
              <h1 className="text-2xl font-bold text-[#062E63]">Monitoring</h1>
              <p className="text-xs text-[#2A2035]/55 mt-0.5">How the portal is being used, and which students need a closer look.</p>
            </div>
          </div>
        </div>

        <EnrolmentTrend />

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AREAS.map((a) => (
            <Link key={a.label} href={a.href}
              className="group bg-white rounded-2xl border border-[#F0F4FF] p-4 md:p-5 hover:shadow-md transition hover:-translate-y-0.5">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-[#EEF3FF]">{a.icon}</span>
                <span className="text-sm font-bold text-[#062E63] group-hover:underline">{a.label}</span>
              </div>
              <p className="text-xs text-[#2A2035]/55 leading-relaxed">{a.desc}</p>
              <p className="text-[11px] font-semibold mt-3 text-[#325099]">Open →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAuthProfile } from '../../../../../../lib/getProfile'
import TutorNav from '../../../../../../components/TutorNav'
import AbsencesInbox from '../../../../../../components/attendance/AbsencesInbox'

/*
 * Absences — /tutor/admin/monitoring/attendance/absences (admin only)
 *
 * A subpage of Attendance: every absence as a case, worked from "needs
 * action" through contact, makeup or credit to closed. The inbox itself is
 * components/attendance/AbsencesInbox.js; the Action Centre's absence alerts
 * link here.
 */
export default function AbsencesPage() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setStaff(profile)
    })()
  }, [router])

  if (!staff) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff?.full_name} isAdmin={true} />
      <div className="max-w-6xl mx-auto px-4 pt-5 pb-16 md:px-6 md:pt-8">
        <Link href="/tutor/admin/monitoring/attendance" className="text-xs font-semibold text-[#325099]/60 hover:text-[#325099] transition">← Attendance</Link>
        <div className="mt-1 mb-4">
          <h1 className="text-2xl font-bold text-[#062E63]">Absences</h1>
          <p className="text-xs text-[#2A2035]/55 mt-0.5">
            Every student marked absent, until it is made up, credited or closed.
          </p>
        </div>
        <AbsencesInbox staff={staff} />
      </div>
    </div>
  )
}

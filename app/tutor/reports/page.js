'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { REPORT_KINDS } from '../../../lib/reportKind'

/*
 * Reports — /tutor/reports
 *
 * Two kinds of report bundle live under here, each with its own class picker
 * and its own teacher comments: mid-term (weeks 1–5) and end-of-term (the whole
 * term). This page just sends you to one of them.
 */
export default function ReportsHomePage() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)

  useEffect(() => {
    (async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile || profile.role !== 'admin') { router.push('/tutor'); return }
      setStaff(profile)
    })()
  }, [router])

  if (!staff) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">Loading…</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 md:py-12">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display mb-2">
            Reports · Admin
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#2A2035] font-display">
            Student reports
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 mt-2 max-w-2xl">
            Each kind keeps its own teacher comments and criteria grades, so writing one never overwrites the other.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
          {REPORT_KINDS.map(k => (
            <Link
              key={k.slug}
              href={`/tutor/reports/${k.slug}`}
              className="group block rounded-2xl border border-[#DEE7FF] bg-white p-6 hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition"
            >
              <div className="text-3xl mb-3">{k.icon}</div>
              <p className="text-lg font-bold text-[#2A2035] font-display mb-1">{k.label} reports</p>
              <p className="text-xs text-[#2A2035]/60 leading-relaxed">{k.blurb}</p>
              <p className="text-[#325099] text-sm font-semibold mt-4 transition-transform group-hover:translate-x-0.5">
                Open →
              </p>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">
            © CUBE Tuition · Chatswood
          </p>
        </div>
      </footer>
    </div>
  )
}

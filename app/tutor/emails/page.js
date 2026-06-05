'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'

const CAMPAIGNS = [
  {
    href:        '/tutor/emails/term-start',
    icon:        '🎉',
    title:       'Term Start',
    description: 'Send re-enrolment confirmation emails to families at the start of a new term. Includes class details, term dates, and invoice notice.',
    badge:       null,
  },
  {
    href:        '/tutor/emails/end-of-term',
    icon:        '📋',
    title:       'End-of-Term Reports',
    description: 'Upload individual student reports and send a thank-you email with PDFs attached to each family. Siblings are grouped into one email.',
    badge:       null,
  },
]

export default function EmailsHub() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) {
        router.replace('/tutor')
      } else {
        setProfile(profile)
      }
    })
  }, [router])

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      <div className="max-w-4xl mx-auto px-6 pt-10 pb-24">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#062E63]">Emails</h1>
          <p className="text-sm text-[#325099]/60 mt-1">Send bulk emails to families using portal data.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {CAMPAIGNS.map(c => (
            <Link
              key={c.href}
              href={c.href}
              className="group bg-white border border-[#DEE7FF] rounded-2xl p-6 hover:border-[#325099]/40 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-3xl">{c.icon}</span>
                {c.badge && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-[#DEE7FF] text-[#325099] px-2 py-0.5 rounded-full">
                    {c.badge}
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-[#062E63] mb-1 group-hover:text-[#325099] transition">
                {c.title}
              </h2>
              <p className="text-sm text-[#325099]/60 leading-relaxed">{c.description}</p>
              <div className="mt-4 text-xs font-semibold text-[#325099] group-hover:text-[#062E63] transition">
                Open →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

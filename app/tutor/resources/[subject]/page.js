'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { SUBJECTS, AREAS, subjectConfig } from '../../../../lib/resourceSubjects'

/*
 * Subject resource hubs — /tutor/resources/maths | english | chemistry
 *
 * One landing page per subject, linking to the existing resource pages with a
 * ?subject= scope. The target pages keep working exactly as before (they can
 * ignore the param until they learn to pre-filter by it), so these hubs are
 * purely additive.
 */

export default function SubjectHubPage() {
  const router = useRouter()
  const { subject } = useParams()
  const slug = String(subject || '').toLowerCase()
  const cfg = subjectConfig(slug)
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      // Tutors only get Materials — the hub's other areas are director tools.
      if (role === 'tutor') { router.replace(`/tutor/resources/${slug}/materials`); return }
      setProfile(profile); setReady(true)
    })
  }, [router, slug])

  if (!cfg) {
    return (
      <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center">
        <p className="text-sm text-[#2A2035]/50">Unknown subject. <Link href="/tutor" className="text-[#325099] underline">Back to home</Link></p>
      </div>
    )
  }
  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-5xl mx-auto px-6 pt-10 pb-16">
        {/* Header band */}
        <div className="rounded-2xl px-7 py-6 mb-8 border" style={{ background: cfg.tint, borderColor: cfg.border }}>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{cfg.icon}</span>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: cfg.accent }}>{cfg.label}</h1>
              <p className="text-xs text-[#2A2035]/55 mt-0.5">{cfg.blurb}</p>
            </div>
          </div>
          {/* Quick subject switcher */}
          <div className="flex items-center gap-1.5 mt-4">
            {Object.entries(SUBJECTS).map(([s2slug, s]) => (
              <Link key={s2slug} href={`/tutor/resources/${s2slug}`}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition ${s2slug === slug
                  ? 'text-white' : 'bg-white text-[#2A2035]/60 hover:text-[#2A2035]'}`}
                style={s2slug === slug
                  ? { background: cfg.accent, borderColor: cfg.accent }
                  : { borderColor: cfg.border }}>
                {s.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Area cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AREAS(cfg.value, slug).map((a) => (
            <Link key={a.label} href={a.href}
              className="group bg-white rounded-2xl border border-[#F0F4FF] p-5 hover:shadow-md transition hover:-translate-y-0.5"
              style={{ borderColor: undefined }}>
              <div className="flex items-center gap-2.5 mb-2">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: cfg.tint }}>{a.icon}</span>
                <span className="text-sm font-bold text-[#062E63] group-hover:underline">{a.label}</span>
              </div>
              <p className="text-xs text-[#2A2035]/55 leading-relaxed">{a.desc}</p>
              <p className="text-[11px] font-semibold mt-3" style={{ color: cfg.accent }}>Open →</p>
            </Link>
          ))}
        </div>

        <p className="text-[11px] text-[#2A2035]/40 mt-8">
          These open the shared resource pages scoped to {cfg.label}. The original unscoped pages keep working as before.
        </p>
      </div>
    </div>
  )
}

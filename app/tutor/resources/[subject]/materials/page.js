'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import { MATERIAL_AREAS, subjectConfig } from '../../../../../lib/resourceSubjects'

/*
 * Materials — /tutor/resources/maths|english|chemistry/materials
 *
 * A sub-hub of the subject page holding what a class is actually handed:
 * the workbooks and the additional question sets. Same shape and palette as
 * the parent hub, one level down, so the top level stays about the course
 * (curriculum, questions, exams, syllabus) rather than the handouts.
 */
export default function SubjectMaterialsPage() {
  const router = useRouter()
  const { subject } = useParams()
  const slug = String(subject || '').toLowerCase()
  const cfg = subjectConfig(slug)
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

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
        {/* Breadcrumb back to the subject hub */}
        <nav className="text-[11px] text-[#2A2035]/45 mb-3">
          <Link href="/tutor/resources" className="hover:text-[#325099]">Resources</Link>
          <span className="mx-1.5">›</span>
          <Link href={`/tutor/resources/${slug}`} className="hover:text-[#325099]">{cfg.label}</Link>
          <span className="mx-1.5">›</span>
          <span className="text-[#2A2035]/70 font-semibold">Materials</span>
        </nav>

        {/* Header band */}
        <div className="rounded-2xl px-7 py-6 mb-8 border" style={{ background: cfg.tint, borderColor: cfg.border }}>
          <div className="flex items-center gap-3">
            <span className="text-3xl">🗂️</span>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: cfg.accent }}>{cfg.label} · Materials</h1>
              <p className="text-xs text-[#2A2035]/55 mt-0.5">
                Workbooks and additional questions — what a {cfg.label} class is handed.
              </p>
            </div>
          </div>
        </div>

        {/* Area cards */}
        <div className="grid sm:grid-cols-2 gap-4">
          {MATERIAL_AREAS(cfg.value).map((a) => (
            <Link key={a.label} href={a.href}
              className="group bg-white rounded-2xl border border-[#F0F4FF] p-5 hover:shadow-md transition hover:-translate-y-0.5">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: cfg.tint }}>{a.icon}</span>
                <span className="text-sm font-bold text-[#062E63] group-hover:underline">{a.label}</span>
              </div>
              <p className="text-xs text-[#2A2035]/55 leading-relaxed">{a.desc}</p>
              <p className="text-[11px] font-semibold mt-3" style={{ color: cfg.accent }}>Open →</p>
            </Link>
          ))}
        </div>

        <Link href={`/tutor/resources/${slug}`}
          className="inline-block text-[11px] font-semibold mt-8 hover:underline" style={{ color: cfg.accent }}>
          ← Back to {cfg.label}
        </Link>
      </div>
    </div>
  )
}

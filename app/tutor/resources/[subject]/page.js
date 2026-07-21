'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'

/*
 * Subject resource hubs — /tutor/resources/maths | english | chemistry
 *
 * One landing page per subject, linking to the existing resource pages with a
 * ?subject= scope. The target pages keep working exactly as before (they can
 * ignore the param until they learn to pre-filter by it), so these hubs are
 * purely additive.
 */

const SUBJECTS = {
  maths: {
    label: 'Mathematics',
    value: 'Maths',
    icon: '📐',
    blurb: 'Everything for Maths classes — curriculum, questions, workbooks, exams and the syllabus.',
    accent: '#325099',
    tint: '#EEF4FF',
    border: '#DEE7FF',
  },
  english: {
    label: 'English',
    value: 'English',
    icon: '📕',
    blurb: 'Everything for English classes — curriculum, questions, workbooks, exams and reading materials.',
    accent: '#6D4FA3',
    tint: '#F4EFFC',
    border: '#E2D8F3',
  },
  chemistry: {
    label: 'Chemistry',
    value: 'Chemistry',
    icon: '⚗️',
    blurb: 'Everything for Chemistry classes — curriculum, questions, workbooks, exams and the syllabus.',
    accent: '#0E7A5F',
    tint: '#ECF9F4',
    border: '#CBEBDF',
  },
}

// The five resource areas (plus the worksheet builder), linked with the
// subject scope attached.
const AREAS = (subjectValue) => [
  { label: 'Curriculum', icon: '📖', href: `/tutor/booklets?subject=${subjectValue}`,
    desc: 'Weekly curriculum grid — what each class covers, week by week.' },
  { label: 'Questions', icon: '❓', href: `/tutor/qbank?subject=${subjectValue}`,
    desc: 'The question bank — browse, add and organise questions.' },
  { label: 'Workbooks', icon: '📓', href: `/tutor/booklets/master?subject=${subjectValue}`,
    desc: 'The master workbook database and the workbook builder.' },
  { label: 'Exams', icon: '🧪', href: `/tutor/resources/tests?subject=${subjectValue}`,
    desc: 'Pre-tests and level tests — build, publish and mark.' },
  { label: 'Syllabus', icon: '📚', href: `/tutor/resources/syllabus?subject=${subjectValue}`,
    desc: 'Textbook chapters and dotpoints, with booklet coverage.' },
  { label: 'Additional Questions', icon: '📝', href: `/tutor/qbank/worksheets?subject=${subjectValue}`,
    desc: 'Saved worksheets assembled from the question bank.' },
]

export default function SubjectHubPage() {
  const router = useRouter()
  const { subject } = useParams()
  const cfg = SUBJECTS[String(subject || '').toLowerCase()]
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
            {Object.entries(SUBJECTS).map(([slug, s]) => (
              <Link key={slug} href={`/tutor/resources/${slug}`}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition ${slug === String(subject).toLowerCase()
                  ? 'text-white' : 'bg-white text-[#2A2035]/60 hover:text-[#2A2035]'}`}
                style={slug === String(subject).toLowerCase()
                  ? { background: cfg.accent, borderColor: cfg.accent }
                  : { borderColor: cfg.border }}>
                {s.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Area cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AREAS(cfg.value).map((a) => (
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

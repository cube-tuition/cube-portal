'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../../lib/getProfile'
import TutorNav from '../../../../../../components/TutorNav'
import { MATERIAL_AREAS, courseTabs, subjectConfig } from '../../../../../../lib/resourceSubjects'

/*
 * A year/course page under Materials —
 *   /tutor/resources/maths/materials/8
 *   /tutor/resources/maths/materials/11-ext1
 *
 * Lists the topics assigned to that year, and links on to Workbooks and
 * Additional Questions already scoped to it. Topics come from the `topics`
 * table, which is keyed by (year, subject) — the senior streams are separate
 * subjects at the same year, which is why a course key rather than a bare year
 * identifies the page.
 */
export default function MaterialsCoursePage() {
  const router = useRouter()
  const { subject, course } = useParams()
  const slug = String(subject || '').toLowerCase()
  const cfg = subjectConfig(slug)
  const tabs = courseTabs(slug)
  const tab = tabs.find((t) => t.key === String(course)) || null

  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [topics, setTopics] = useState(null)   // null = still loading

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

  useEffect(() => {
    if (!tab) return
    let cancelled = false
    supabase.from('topics').select('id, name')
      .eq('year', tab.year).eq('subject', tab.subject).order('name')
      .then(({ data }) => { if (!cancelled) setTopics(data || []) })
    return () => { cancelled = true }
  }, [tab])

  if (!cfg || !tab) {
    return (
      <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center">
        <p className="text-sm text-[#2A2035]/50">
          Unknown course.{' '}
          <Link href={cfg ? `/tutor/resources/${slug}/materials` : '/tutor'} className="text-[#325099] underline">
            Back to Materials
          </Link>
        </p>
      </div>
    )
  }
  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-5xl mx-auto px-6 pt-10 pb-16">
        <nav className="text-[11px] text-[#2A2035]/45 mb-3">
          <Link href="/tutor/resources" className="hover:text-[#325099]">Resources</Link>
          <span className="mx-1.5">›</span>
          <Link href={`/tutor/resources/${slug}`} className="hover:text-[#325099]">{cfg.label}</Link>
          <span className="mx-1.5">›</span>
          <Link href={`/tutor/resources/${slug}/materials`} className="hover:text-[#325099]">Materials</Link>
          <span className="mx-1.5">›</span>
          <span className="text-[#2A2035]/70 font-semibold">{tab.label}</span>
        </nav>

        <div className="rounded-2xl px-7 py-6 mb-6 border" style={{ background: cfg.tint, borderColor: cfg.border }}>
          <h1 className="text-2xl font-bold" style={{ color: cfg.accent }}>{tab.label}</h1>
          <p className="text-xs text-[#2A2035]/55 mt-0.5">
            Topics assigned to {tab.label}
            {tab.subject !== cfg.value && <> · <span className="font-semibold">{tab.subject}</span></>}
          </p>
        </div>

        {/* Sibling years */}
        <div className="flex flex-wrap gap-1.5 mb-7">
          {tabs.map((t) => (
            <Link key={t.key} href={`/tutor/resources/${slug}/materials/${t.key}`}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition ${t.key === tab.key ? 'text-white' : 'bg-white text-[#2A2035]/60 hover:text-[#2A2035]'}`}
              style={t.key === tab.key ? { background: cfg.accent, borderColor: cfg.accent } : { borderColor: cfg.border }}>
              {t.label}
            </Link>
          ))}
        </div>

        {/* Topics */}
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-[#325099]/60 mb-2.5">Topics</h2>
        {topics === null ? (
          <p className="text-xs text-[#2A2035]/40 animate-pulse">Loading topics…</p>
        ) : topics.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] px-6 py-8 text-center">
            <p className="text-sm font-semibold text-[#2A2035]/60">No topics defined yet</p>
            <p className="text-xs text-[#2A2035]/45 mt-1">
              Nothing has been assigned to {tab.label} in the topic list. Topics are managed from the
              workbook database, where they can be added against a year and subject.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {topics.map((t) => (
              <div key={t.id}
                className="bg-white rounded-xl border border-[#F0F4FF] px-4 py-3 flex items-center gap-2.5">
                <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: cfg.accent }} />
                <span className="text-sm font-semibold text-[#2A2035] leading-snug">{t.name}</span>
              </div>
            ))}
          </div>
        )}
        {topics?.length > 0 && (
          <p className="text-[11px] text-[#2A2035]/40 mt-2.5">
            {topics.length} topic{topics.length === 1 ? '' : 's'} assigned to {tab.label}.
          </p>
        )}

        {/* The two Materials areas, scoped to this year/course */}
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-[#325099]/60 mt-9 mb-2.5">Open</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {MATERIAL_AREAS(cfg.value, tab).map((a) => (
            <Link key={a.label} href={a.href}
              className="group bg-white rounded-2xl border border-[#F0F4FF] p-5 hover:shadow-md transition hover:-translate-y-0.5">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: cfg.tint }}>{a.icon}</span>
                <span className="text-sm font-bold text-[#062E63] group-hover:underline">{a.label}</span>
              </div>
              <p className="text-xs text-[#2A2035]/55 leading-relaxed">{a.desc}</p>
              <p className="text-[11px] font-semibold mt-3" style={{ color: cfg.accent }}>
                Open for {tab.label} →
              </p>
            </Link>
          ))}
        </div>

        <Link href={`/tutor/resources/${slug}/materials`}
          className="inline-block text-[11px] font-semibold mt-8 hover:underline" style={{ color: cfg.accent }}>
          ← Back to Materials
        </Link>
      </div>
    </div>
  )
}

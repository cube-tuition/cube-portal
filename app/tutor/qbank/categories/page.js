'use client'
import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SUBJECTS } from '../../../../lib/resourceSubjects'
import TopicsManager from '../../../../components/qbank/TopicsManager'

/*
 * Old address of the Topics page (it was "Categories" in the question bank).
 * Scoped links forward to the subject's Topics page in Resources; an unscoped
 * visit still gets every subject.
 */
export default function CategoriesRedirect() {
  return <Suspense><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const subject = useSearchParams().get('subject')
  const slug = Object.entries(SUBJECTS).find(([, s]) => s.value === subject)?.[0] || null
  useEffect(() => { if (slug) router.replace(`/tutor/resources/${slug}/topics`) }, [slug, router])
  if (slug) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  return <TopicsManager />
}

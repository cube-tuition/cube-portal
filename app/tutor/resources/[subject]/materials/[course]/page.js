'use client'
import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

/*
 * The year/course view moved onto the Materials page as a tab — this route
 * only survives so old links and bookmarks land on the right one. The nested
 * topic pages (/materials/<course>/<topic>) are still real routes.
 */
export default function MaterialsCourseRedirect() {
  const { subject, course } = useParams()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/tutor/resources/${subject}/materials?course=${course}`)
  }, [router, subject, course])
  return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
}

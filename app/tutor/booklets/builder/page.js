'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/*
 * The standalone workbook list has moved into the Master Database
 * (/tutor/booklets/master), which now hosts "Create workbook", in-progress
 * drafts, and "Open in builder" on published rows. This route just redirects
 * there so old links/bookmarks still land in the right place.
 */
export default function BookletBuilderListRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/tutor/booklets/master') }, [router])
  return (
    <div className="min-h-screen bg-[#F7F9FF] flex items-center justify-center">
      <p className="text-sm text-[#325099]/60 font-semibold tracking-widest uppercase">Redirecting to Master Database…</p>
    </div>
  )
}

'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// The student study tool now lives on the Resources tab. Redirect any old links.
export default function StudyRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/resources') }, [router])
  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-sm text-[#2A2035]/40">
      Redirecting…
    </div>
  )
}

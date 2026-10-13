'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/*
 * Trial reminders moved into the trial pipeline (/tutor/trials), where each
 * card sends its own invitation and reminder and records both — one place
 * for everything about a trial. This page only forwards old links there.
 */
export default function TrialsEmailPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/tutor/trials') }, [router])
  return <div className="min-h-screen flex items-center justify-center text-sm text-[#2A2035]/40">Trial reminders now live in the trial pipeline — taking you there…</div>
}

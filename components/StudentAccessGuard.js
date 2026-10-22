'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { signOutEverywhere } from '../lib/nativeApp'

/*
 * Inactive students cannot use the portal
 * (migrations/20261022_inactive_students_locked_out.sql).
 *
 * The database suspends the account itself — it can no longer sign in or
 * renew a session — but a sign-in token already issued stays valid until it
 * expires (up to an hour). So on every page, a signed-in student whose status
 * is no longer active or trial is signed out at once and sent to the sign-in
 * page, which explains why. Staff are never checked; a failed lookup (offline,
 * a blip) leaves the page alone rather than locking anyone out by mistake.
 */
export const PORTAL_OPEN_STATUSES = ['active', 'trial']

export default function StudentAccessGuard() {
  const pathname = usePathname()
  const router = useRouter()
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || !alive) return
      const role = session.user.app_metadata?.role ?? 'student'
      if (role !== 'student') return
      const { data, error } = await supabase.from('students').select('status').eq('id', session.user.id).maybeSingle()
      if (!alive || error || !data) return
      if (PORTAL_OPEN_STATUSES.includes(data.status)) return
      await signOutEverywhere(supabase)
      router.replace('/?paused=1')
    })()
    return () => { alive = false }
  }, [pathname, router])
  return null
}

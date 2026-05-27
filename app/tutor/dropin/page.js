'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/*
 * /tutor/dropin — deprecated.
 * Drop-in workflow was removed from the teacher portal. Any stale links or
 * bookmarks land here and get bounced to the tutor home. Safe to `git rm`
 * this whole folder when convenient.
 */
export default function DeprecatedDropinPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/tutor') }, [router])
  return null
}

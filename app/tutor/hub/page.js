'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// /tutor/hub → redirect to the first info page
export default function HubRoot() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/tutor/hub/general-expectations')
  }, [router])
  return null
}

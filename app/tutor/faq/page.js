'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// /tutor/faq has moved into the hub sidebar layout.
export default function FAQRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/tutor/hub/faq') }, [router])
  return null
}

'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { listNavPages } from '../../../lib/infohub/data'

// /tutor/hub → land on the first available page (pinned first), falling back to
// the legacy pages, then the manage dashboard.
export default function HubRoot() {
  const router = useRouter()
  useEffect(() => {
    let active = true
    ;(async () => {
      const pages = await listNavPages()
      if (!active) return
      if (pages.length) {
        const first = pages.slice().sort((a, b) => (b.pinned - a.pinned) || (a.sort_order - b.sort_order))[0]
        router.replace(`/tutor/hub/${first.slug}`)
        return
      }
      const { data } = await supabase.from('info_pages').select('slug').order('sort_order').limit(1)
      if (!active) return
      router.replace(data?.[0]?.slug ? `/tutor/hub/${data[0].slug}` : '/tutor/hub/manage')
    })()
    return () => { active = false }
  }, [router])
  return <div className="p-10 text-sm text-[#2A2035]/45">Loading…</div>
}

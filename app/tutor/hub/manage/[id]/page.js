'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useHub } from '../../context'
import { loadPageById } from '../../../../../lib/infohub/data'

// Lazy-load the heavy editor — it never ships to viewers' bundles.
const PageEditor = dynamic(() => import('../../../../../components/infohub/PageEditor'), {
  ssr: false,
  loading: () => <div className="p-10 text-sm text-[#2A2035]/50">Loading editor…</div>,
})

export default function InfoEditPage() {
  const { id } = useParams()
  const { staff, canEdit, loading: hubLoading } = useHub()
  const [page, setPage] = useState(undefined) // undefined = loading, null = not found

  useEffect(() => {
    if (!canEdit) return
    loadPageById(id).then(setPage)
  }, [id, canEdit])

  if (hubLoading) return <div className="p-10 text-sm text-[#2A2035]/50">Loading…</div>
  if (!canEdit) return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      <p className="text-sm font-semibold text-[#062E63]">Editing the Info Centre is limited to directors and admins.</p>
      <Link href="/tutor/hub" className="text-xs text-[#325099] underline mt-1 inline-block">Back to Info Centre</Link>
    </div>
  )
  if (page === undefined) return <div className="p-10 text-sm text-[#2A2035]/50">Loading page…</div>
  if (page === null) return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      <p className="text-sm font-semibold text-[#062E63]">Page not found.</p>
      <Link href="/tutor/hub/manage" className="text-xs text-[#325099] underline mt-1 inline-block">Back to pages</Link>
    </div>
  )
  return <PageEditor page={page} staff={staff} />
}

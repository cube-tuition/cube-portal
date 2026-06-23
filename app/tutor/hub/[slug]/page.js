'use client'
/*
 * Info Centre — public page viewer. Renders a published page's blocks with the
 * lightweight InfoBlocks renderer (no editor code loaded). Editors get an "Edit"
 * shortcut; mandatory pages show a read-acknowledgement banner for viewers.
 * Falls back to legacy `info_pages` markdown if a slug hasn't been migrated yet,
 * so the old pages keep working until an admin runs the one-time import.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { useHub } from '../context'
import InfoBlocks from '../../../../components/infohub/InfoBlocks'
import { loadPageBySlug, getAck, acknowledgePage } from '../../../../lib/infohub/data'
import { mdToBlocks } from '../../../../lib/infohub/convert'

function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return '' }
}

export default function InfoViewPage() {
  const { slug } = useParams()
  const { staff, canEdit } = useHub()
  const [page, setPage] = useState(undefined)   // undefined=loading, null=not found
  const [legacy, setLegacy] = useState(null)    // { title, blocks } fallback
  const [ack, setAck] = useState(null)
  const [acking, setAcking] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const p = await loadPageBySlug(slug)
      if (!active) return
      if (p) {
        setPage(p)
        if (p.mandatory && staff?.id) { const a = await getAck(p.id, staff.id); if (active) setAck(a) }
        return
      }
      // Fallback: legacy markdown page (pre-migration)
      const { data: lp } = await supabase.from('info_pages').select('title, content, updated_at').eq('slug', slug).maybeSingle()
      if (!active) return
      if (lp) setLegacy({ title: lp.title || slug, blocks: mdToBlocks(lp.content || ''), updated_at: lp.updated_at })
      setPage(lp ? 'legacy' : null)
    })()
    return () => { active = false }
  }, [slug, staff?.id])

  if (page === undefined) return <div className="max-w-3xl mx-auto px-6 py-12 text-sm text-[#2A2035]/45">Loading…</div>
  if (page === null) return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-center">
      <div className="text-3xl mb-2">🔍</div>
      <p className="text-sm font-semibold text-[#062E63]">This page isn’t available.</p>
      <p className="text-xs text-[#2A2035]/55 mt-1">It may be unpublished or restricted. <Link href="/tutor/hub" className="text-[#325099] underline">Back to Info Centre</Link></p>
    </div>
  )

  if (page === 'legacy') return (
    <div className="max-w-3xl mx-auto px-6 md:px-8 py-10">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl md:text-3xl font-bold text-[#062E63] font-display">{legacy.title}</h1>
        {canEdit && <Link href="/tutor/hub/manage" className="shrink-0 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3.5 py-1.5 hover:bg-[#F0F4FF]">Manage pages</Link>}
      </div>
      {canEdit && <p className="text-[11px] text-[#92400E] font-semibold mb-6">Legacy page — import it in “Manage pages” to use the new editor.</p>}
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 md:p-8"><InfoBlocks blocks={legacy.blocks} /></div>
    </div>
  )

  const blocks = (page.published && page.published.length ? page.published : page.draft) || []
  const isDraftOnly = page.status !== 'published'
  const doAck = async () => {
    setAcking(true)
    try { await acknowledgePage(page.id, staff.id); setAck(new Date().toISOString()) }
    catch (e) { alert(e.message || e) } finally { setAcking(false) }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-8 py-10">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          {page.icon && <span className="text-2xl" aria-hidden="true">{page.icon}</span>}
          <h1 className="text-2xl md:text-3xl font-bold text-[#062E63] font-display">{page.title}</h1>
        </div>
        {canEdit && <Link href={`/tutor/hub/manage/${page.id}`} className="shrink-0 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3.5 py-1.5 hover:bg-[#F0F4FF]">✎ Edit page</Link>}
      </div>
      <p className="text-[11px] text-[#2A2035]/45 mb-6">
        Updated {fmtDate(page.published_at || page.updated_at)}
        {isDraftOnly && canEdit && <span className="ml-2 text-[#92400E] font-semibold">· Draft (not yet published)</span>}
      </p>

      {page.mandatory && staff?.role === 'tutor' && (
        <div className={`mb-6 rounded-xl border px-4 py-3 flex items-center gap-3 ${ack ? 'bg-[#F0FDF4] border-[#A7F3D0]' : 'bg-[#FFF7ED] border-[#FDE2B8]'}`}>
          <span aria-hidden="true">{ack ? '✅' : '📌'}</span>
          <div className="flex-1 text-sm">
            {ack ? <span className="text-[#166534] font-semibold">You acknowledged this on {fmtDate(ack)}.</span>
              : <span className="text-[#92400E] font-semibold">Mandatory reading — please confirm you’ve read this page.</span>}
          </div>
          {!ack && <button onClick={doAck} disabled={acking} className="text-xs font-semibold text-white bg-[#062E63] rounded-full px-4 py-1.5 hover:bg-[#325099] disabled:opacity-50">{acking ? 'Saving…' : 'I’ve read this'}</button>}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 md:p-8">
        {blocks.length ? <InfoBlocks blocks={blocks} /> : <p className="text-sm text-[#2A2035]/40 text-center py-6">This page is empty.</p>}
      </div>
    </div>
  )
}

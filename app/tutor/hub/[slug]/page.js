'use client'
/*
 * Info Centre — public page viewer. Renders a published page's blocks with the
 * lightweight InfoBlocks renderer (no editor code loaded). Editors get an "Edit"
 * shortcut; mandatory pages show a read-acknowledgement banner for viewers.
 * Falls back to legacy `info_pages` markdown if a slug hasn't been migrated yet,
 * so the old pages keep working until an admin runs the one-time import.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { supabase } from '../../../../lib/supabase'
import { useHub } from '../context'
import InfoBlocks from '../../../../components/infohub/InfoBlocks'
import { loadPageBySlug, getAck, acknowledgePage, listSubpages, loadPageCrumb, saveInline } from '../../../../lib/infohub/data'

// Only pulled in when an editor turns editing on, so a reader still loads the
// light read-only renderer and nothing else.
const InlineBlocks = dynamic(() => import('../../../../components/infohub/InlineBlocks'), { ssr: false })
import { mdToBlocks } from '../../../../lib/infohub/convert'

function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return '' }
}

export default function InfoViewPage() {
  const { slug } = useParams()
  const { staff, canEdit } = useHub()
  // Only admins and directors get the eye on a hidden column; a teacher sees
  // the dots and has no way to reveal them. (Directors sign in as 'admin' —
  // see lib/infohub/visibility.js — so both roles are listed.)
  const canReveal = ['admin', 'director'].includes(staff?.role)
  const [page, setPage] = useState(undefined)   // undefined=loading, null=not found
  const [legacy, setLegacy] = useState(null)    // { title, blocks } fallback
  const [ack, setAck] = useState(null)
  const [acking, setAcking] = useState(false)
  const [subpages, setSubpages] = useState([])
  const [parent, setParent] = useState(null)
  // Inline editing: `edit` is the toggle, `draft` the working blocks, `saveState`
  // what the status line says. Saves are debounced so typing does not write on
  // every keystroke, and flushed when editing is turned off.
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saveState, setSaveState] = useState('idle')   // idle | saving | saved | error
  const saveTimer = useRef(null)
  const pending = useRef(null)
  const flushRef = useRef(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const p = await loadPageBySlug(slug)
      if (!active) return
      if (p) {
        setPage(p)
        // Editors see unpublished subpages listed (greyed); everyone else sees
        // only what is live. The read policy filters restricted ones regardless.
        const kids = await listSubpages(p.id, { publishedOnly: !canEdit })
        if (active) setSubpages(kids)
        const up = p.parent_id ? await loadPageCrumb(p.parent_id) : null
        if (active) setParent(up)
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
  }, [slug, staff?.id, canEdit])

  // Write whatever is queued, now. Called on a debounce, when editing is turned
  // off, and when the tab goes away — an edit must not be lost to a closed tab.
  // Held in a ref the way the shared class page holds its save, so the listeners
  // below always reach the current closure without re-subscribing.
  const doFlush = async () => {
    const blocks = pending.current
    if (!blocks || !page?.id) return
    pending.current = null
    setSaveState('saving')
    try {
      const patch = await saveInline(page, blocks, { editorName: staff?.full_name || '' })
      setPage((p) => (p && p.id ? { ...p, ...patch } : p))
      setSaveState('saved')
    } catch {
      // Keep the text so the next attempt still has it; the status line says so.
      pending.current = blocks
      setSaveState('error')
    }
  }
  useEffect(() => { flushRef.current = doFlush })

  const onInlineChange = (blocks) => {
    setDraft(blocks)
    pending.current = blocks
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flushRef.current?.(), 900)
  }

  useEffect(() => {
    const warn = (e) => { if (pending.current) { e.preventDefault(); e.returnValue = '' } }
    const onHide = () => { if (document.visibilityState === 'hidden') flushRef.current?.() }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('visibilitychange', onHide)
      clearTimeout(saveTimer.current)
    }
  }, [])

  if (page === undefined) return <div className="max-w-[min(64rem,100%)] mx-auto px-6 py-12 text-sm text-[#2A2035]/45">Loading…</div>
  if (page === null) return (
    <div className="max-w-[min(64rem,100%)] mx-auto px-6 py-16 text-center">
      <div className="text-3xl mb-2">🔍</div>
      <p className="text-sm font-semibold text-[#062E63]">This page isn’t available.</p>
      <p className="text-xs text-[#2A2035]/55 mt-1">It may be unpublished or restricted. <Link href="/tutor/hub" className="text-[#325099] underline">Back to Info Centre</Link></p>
    </div>
  )

  if (page === 'legacy') return (
    <div className="max-w-[min(64rem,100%)] mx-auto px-6 md:px-8 py-10">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl md:text-3xl font-bold text-[#062E63] font-display">{legacy.title}</h1>
        {canEdit && <Link href="/tutor/hub/manage" className="shrink-0 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3.5 py-1.5 hover:bg-[#F0F4FF]">Manage pages</Link>}
      </div>
      {canEdit && <p className="text-[11px] text-[#92400E] font-semibold mb-6">Legacy page — import it in “Manage pages” to use the new editor.</p>}
      <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 md:p-8"><InfoBlocks blocks={legacy.blocks} canReveal={canReveal} /></div>
    </div>
  )

  const liveBlocks = (page.published && page.published.length ? page.published : page.draft) || []
  const blocks = edit && draft ? draft : liveBlocks
  const isDraftOnly = page.status !== 'published'
  const doAck = async () => {
    setAcking(true)
    try { await acknowledgePage(page.id, staff.id); setAck(new Date().toISOString()) }
    catch (e) { alert(e.message || e) } finally { setAcking(false) }
  }

  return (
    <div className="max-w-[min(64rem,100%)] mx-auto px-6 md:px-8 py-10">
      {parent && (
        <Link href={`/tutor/hub/${parent.slug}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#325099] hover:underline mb-2">
          <span aria-hidden="true">↖</span>{parent.icon ? `${parent.icon} ` : ''}{parent.title}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          {page.icon && <span className="text-2xl" aria-hidden="true">{page.icon}</span>}
          <h1 className="text-2xl md:text-3xl font-bold text-[#062E63] font-display">{page.title}</h1>
        </div>
        {canEdit && (
          <div className="shrink-0 flex items-center gap-2">
            {edit && (
              <span className={`text-[11px] font-semibold ${
                saveState === 'error' ? 'text-[#B91C1C]' : saveState === 'saving' ? 'text-[#92400E]' : 'text-[#166534]'}`}>
                {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved — retrying' : saveState === 'saved' ? 'Saved ✓' : ''}
              </span>
            )}
            <button
              onClick={async () => {
                if (edit) { clearTimeout(saveTimer.current); await flushRef.current?.(); setEdit(false); setDraft(null) }
                else { setDraft(liveBlocks); setSaveState('idle'); setEdit(true) }
              }}
              className={`text-xs font-semibold rounded-full px-3.5 py-1.5 border transition ${
                edit ? 'bg-[#062E63] text-white border-[#062E63] hover:bg-[#325099]'
                     : 'text-[#325099] border-[#DEE7FF] hover:bg-[#F0F4FF]'}`}>
              {edit ? 'Done' : '✎ Edit here'}
            </button>
            <Link href={`/tutor/hub/manage/${page.id}`}
              title="Add, reorder or remove blocks, and change the page’s settings"
              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3.5 py-1.5 hover:bg-[#F0F4FF]">
              Full editor
            </Link>
          </div>
        )}
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

      <div className={`bg-white rounded-2xl border p-6 md:p-8 ${edit ? 'border-[#325099]/40 ring-2 ring-[#325099]/10' : 'border-[#DEE7FF]'}`}>
        {!blocks.length ? <p className="text-sm text-[#2A2035]/40 text-center py-6">This page is empty.</p>
          : edit ? <InlineBlocks blocks={blocks} onChange={onInlineChange} />
          : <InfoBlocks blocks={blocks} canReveal={canReveal} />}
      </div>
      {edit && (
        <p className="text-[11px] text-[#2A2035]/50 mt-2">
          Editing on the page — changes save as you type{page.status === 'published' ? ' and are live straight away' : ' to the draft'}.
          Adding or reordering blocks is in the <Link href={`/tutor/hub/manage/${page.id}`} className="text-[#325099] underline">full editor</Link>.
        </p>
      )}

      {subpages.length > 0 && (
        <section className="mt-6">
          <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#325099]/60 mb-2">In this section</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {subpages.map(sp => (
              <Link key={sp.id} href={`/tutor/hub/${sp.slug}`}
                className="bg-white rounded-xl border border-[#DEE7FF] px-4 py-3 hover:border-[#325099] transition flex items-start gap-3">
                <span className="text-base shrink-0" aria-hidden="true">{sp.icon || '📄'}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[#062E63] truncate">
                    {sp.title}
                    {sp.mandatory && <span className="ml-1.5 align-middle w-1.5 h-1.5 inline-block rounded-full bg-[#B91C1C]" title="Mandatory reading" />}
                    {sp.status !== 'published' && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-[#92400E]">Draft</span>}
                  </span>
                  {sp.summary && <span className="block text-[11px] text-[#2A2035]/50 truncate mt-0.5">{sp.summary}</span>}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

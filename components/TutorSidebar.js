'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useHub } from '../app/tutor/hub/context'
import { listNavPages, listCategories } from '../lib/infohub/data'
import { isDirectorOnly } from '../lib/infohub/visibility'

/*
 * TutorSidebar — collapsible left navigation for /tutor/hub. Now data-driven:
 * lists published Info Centre pages grouped by category (pinned first), with a
 * quick filter so teachers can find pages fast. Falls back to the legacy
 * info_pages list until an admin runs the one-time import.
 */
export default function TutorSidebar({ defaultOpen = true }) {
  const pathname = usePathname()
  const { canEdit } = useHub()
  const [open, setOpen] = useState(defaultOpen)
  const [pages, setPages] = useState(null)
  const [cats, setCats] = useState([])
  const [legacy, setLegacy] = useState([])
  const [filter, setFilter] = useState('')
  const [sheet, setSheet] = useState(false)   // phone page picker

  useEffect(() => {
    let active = true
    ;(async () => {
      const [p, c] = await Promise.all([listNavPages(), listCategories()])
      if (!active) return
      setPages(p); setCats(c)
      if (!p.length) {
        const { data } = await supabase.from('info_pages').select('slug, title').order('sort_order')
        if (active) setLegacy(data || [])
      }
    })()
    return () => { active = false }
  }, [pathname])  // re-read after navigating (e.g. just published a page)

  const isActive = (slug) => pathname === `/tutor/hub/${slug}` || pathname?.startsWith(`/tutor/hub/${slug}/`)

  const groups = useMemo(() => {
    const list = (pages || []).filter(p => !filter || (p.title || '').toLowerCase().includes(filter.toLowerCase()))
    // Director-only pages are gathered under their own label rather than left
    // among the categories. Teachers never receive them — the read policy on
    // infohub_pages filters them out before they reach the browser — so this
    // group simply does not appear for them.
    // Subpages hang off their parent, so they are taken out of the flat lists.
    // A filter is the exception: while searching, matches show on their own —
    // hiding a hit because its parent did not match would be unhelpful.
    const kids = new Map()
    if (!filter) {
      for (const p of list) {
        if (!p.parent_id) continue
        if (!kids.has(p.parent_id)) kids.set(p.parent_id, [])
        kids.get(p.parent_id).push(p)
      }
      for (const arr of kids.values()) arr.sort((a, b) => a.sort_order - b.sort_order)
    }
    const tops = filter ? list : list.filter(p => !p.parent_id)
    const director = tops.filter(p => isDirectorOnly(p)).sort((a, b) => a.sort_order - b.sort_order)
    const open = tops.filter(p => !isDirectorOnly(p))
    const pinned = open.filter(p => p.pinned)
    const rest = open.filter(p => !p.pinned)
    const byCat = []
    for (const c of cats) {
      const items = rest.filter(p => p.category_id === c.id).sort((a, b) => a.sort_order - b.sort_order)
      if (items.length) byCat.push({ name: c.name, items })
    }
    const uncat = rest.filter(p => !p.category_id || !cats.some(c => c.id === p.category_id))
    if (uncat.length) byCat.push({ name: cats.length ? 'Other' : null, items: uncat })
    return { pinned, byCat, director, kids }
  }, [pages, cats, filter])

  // `open` is the desktop rail's expanded state; the phone sheet is always
  // expanded and a touch roomier, so the pieces below take it as a parameter.
  const item = ({ key, slug, icon, title, mandatory, sub = false, open = true, phone = false, onPick }) => {
    const active = isActive(slug)
    return (
      <Link key={key} href={`/tutor/hub/${slug}`} title={title} onClick={onPick}
        className={`flex items-center gap-2.5 ${phone ? 'py-2.5' : 'py-1.5'} rounded-xl transition ${sub && open ? 'pl-6 pr-2' : 'px-2'} ${active ? 'bg-[#DEE7FF] text-[#062E63] font-semibold' : 'text-[#2A2035]/65 hover:text-[#062E63] hover:bg-[#F8FAFF]'}`}>
        <span className={`shrink-0 text-center ${sub && open ? 'text-xs w-4' : 'text-sm w-5'}`} aria-hidden="true">{icon || (sub ? '·' : '📄')}</span>
        {open && <span className={`truncate flex-1 ${sub ? 'text-[13px]' : phone ? 'text-[15px]' : 'text-sm'}`}>{title}</span>}
        {open && mandatory && <span className="w-1.5 h-1.5 rounded-full bg-[#B91C1C] shrink-0" title="Mandatory reading" />}
      </Link>
    )
  }
  // A page plus whatever hangs off it.
  const branch = ({ p, open, phone, onPick }) => (
    <div key={p.id}>
      {item({ slug: p.slug, icon: p.icon, title: p.title, mandatory: p.mandatory, open, phone, onPick })}
      {(groups.kids.get(p.id) || []).map(k => (
        item({ key: k.id, slug: k.slug, icon: k.icon, title: k.title, mandatory: k.mandatory, sub: true, open, phone, onPick })
      ))}
    </div>
  )

  // The grouped page list, shared by the desktop rail and the phone sheet.
  const navList = ({ open, phone = false, onPick }) => (
    <nav className={`flex-1 px-2 ${phone ? 'space-y-1' : 'space-y-0.5'}`}>
      {pages === null ? (
        open && <p className="px-2 py-2 text-xs text-[#2A2035]/40">Loading…</p>
      ) : pages.length === 0 ? (
        // Legacy fallback list
        legacy.length ? legacy.map(l => item({ key: l.slug, slug: l.slug, title: l.title || l.slug, icon: '📄', open, phone, onPick }))
          : (open && <p className="px-2 py-3 text-xs text-[#2A2035]/40">{canEdit ? 'No pages yet — create one in Manage pages.' : 'No pages yet.'}</p>)
      ) : (
        <>
          {groups.pinned.length > 0 && (
            <div className="mb-1">
              {open && <p className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-[#2A2035]/35">Pinned</p>}
              {groups.pinned.map(p => branch({ p, open, phone, onPick }))}
            </div>
          )}
          {groups.byCat.map((g, gi) => (
            <div key={gi} className="mb-1">
              {open && g.name && <p className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-[#2A2035]/35">{g.name}</p>}
              {g.items.map(p => branch({ p, open, phone, onPick }))}
            </div>
          ))}
          {groups.director.length > 0 && (
            <div className="mb-1 mt-1 pt-1 border-t border-[#EEF2FF]">
              {open && (
                <p className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-[#5B21B6]/70 flex items-center gap-1">
                  <span aria-hidden="true">🔒</span> Director
                </p>
              )}
              {groups.director.map(p => branch({ p, open, phone, onPick }))}
            </div>
          )}
        </>
      )}
    </nav>
  )

  // Phones: no rail. A bar under the top nav names the current page and opens
  // the same list as a bottom sheet.
  const currentTitle = (() => {
    const all = pages?.length ? pages : legacy
    const hit = all.find(p => isActive(p.slug))
    if (hit) return `${hit.icon ? hit.icon + ' ' : ''}${hit.title || hit.slug}`
    if (pathname?.startsWith('/tutor/hub/manage')) return '⚙ Manage pages'
    return 'Info Centre'
  })()

  return (<>
    <div className="md:hidden sticky top-[65px] z-30 w-full bg-white/95 backdrop-blur border-b border-[#DEE7FF] px-4 py-2">
      <button type="button" onClick={() => setSheet(true)}
        className="w-full flex items-center gap-2.5 rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] px-3 py-2.5 text-left active:bg-[#EEF4FF]">
        <span className="text-[9px] tracking-[0.25em] uppercase font-bold text-[#325099]/60 shrink-0">Pages</span>
        <span className="flex-1 min-w-0 truncate text-sm font-semibold text-[#062E63]">{currentTitle}</span>
        <span className="text-[#325099] text-xs" aria-hidden="true">▾</span>
      </button>
    </div>
    {sheet && (
      <div className="md:hidden fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Info Centre pages">
        <div className="absolute inset-0 bg-[#062E63]/40 nav-sheet-fade" onClick={() => setSheet(false)} />
        <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] flex flex-col bg-white rounded-t-2xl shadow-2xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <span className="text-[10px] tracking-[0.3em] uppercase font-bold text-[#325099]/60">Info Centre</span>
            <button type="button" onClick={() => setSheet(false)} aria-label="Close"
              className="w-10 h-10 -mr-2 rounded-full flex items-center justify-center text-[#325099] active:bg-[#EEF4FF] text-lg">✕</button>
          </div>
          {(pages?.length > 6) && (
            <div className="px-4 pb-2">
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a page…"
                className="w-full border border-[#DEE7FF] rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-[#325099]" aria-label="Filter pages" />
            </div>
          )}
          <div className="overflow-y-auto px-2 pb-3">
            {navList({ open: true, phone: true, onPick: () => setSheet(false) })}
            {canEdit && (
              <div className="px-2 pt-2 mt-1 border-t border-[#EEF2FF]">
                <Link href="/tutor/hub/manage" onClick={() => setSheet(false)}
                  className={`flex items-center gap-2.5 px-2 py-2.5 rounded-xl text-[#325099] text-[15px] ${pathname?.startsWith('/tutor/hub/manage') ? 'bg-[#EEF4FF] font-semibold' : ''}`}>
                  <span className="w-5 text-center" aria-hidden="true">⚙</span>Manage pages
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    <aside className={`hidden md:flex shrink-0 transition-all duration-200 ${open ? 'w-56' : 'w-14'} flex-col`}>
      <div className="sticky top-[65px] h-[calc(100vh-65px)] flex flex-col bg-white border-r border-[#DEE7FF] overflow-y-auto overflow-x-hidden">
        <div className={`flex ${open ? 'justify-between items-center' : 'justify-center'} px-2 pt-3 pb-2`}>
          {open && <span className="pl-2 text-[9px] tracking-[0.3em] uppercase font-bold text-[#325099]/50">Info Centre</span>}
          <button type="button" onClick={() => setOpen(o => !o)} title={open ? 'Collapse' : 'Expand'}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#325099] hover:bg-[#EEF4FF] transition text-sm">{open ? '←' : '→'}</button>
        </div>

        {open && (pages?.length > 6) && (
          <div className="px-2 pb-2">
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a page…"
              className="w-full text-xs border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#325099]" aria-label="Filter pages" />
          </div>
        )}

        {navList({ open })}

        {canEdit && (
          <div className="px-2 py-3 border-t border-[#EEF2FF]">
            <Link href="/tutor/hub/manage" className={`flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-[#325099] hover:bg-[#F0F4FF] ${pathname?.startsWith('/tutor/hub/manage') ? 'bg-[#EEF4FF] font-semibold' : ''}`}>
              <span className="w-5 text-center" aria-hidden="true">⚙</span>{open && <span className="text-sm">Manage pages</span>}
            </Link>
          </div>
        )}
      </div>
    </aside>
  </>)
}

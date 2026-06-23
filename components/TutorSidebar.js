'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useHub } from '../app/tutor/hub/context'
import { listNavPages, listCategories } from '../lib/infohub/data'

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
    const pinned = list.filter(p => p.pinned)
    const rest = list.filter(p => !p.pinned)
    const byCat = []
    for (const c of cats) {
      const items = rest.filter(p => p.category_id === c.id).sort((a, b) => a.sort_order - b.sort_order)
      if (items.length) byCat.push({ name: c.name, items })
    }
    const uncat = rest.filter(p => !p.category_id || !cats.some(c => c.id === p.category_id))
    if (uncat.length) byCat.push({ name: cats.length ? 'Other' : null, items: uncat })
    return { pinned, byCat }
  }, [pages, cats, filter])

  const Item = ({ slug, icon, title, mandatory }) => {
    const active = isActive(slug)
    return (
      <Link href={`/tutor/hub/${slug}`} title={title}
        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-xl transition ${active ? 'bg-[#DEE7FF] text-[#062E63] font-semibold' : 'text-[#2A2035]/65 hover:text-[#062E63] hover:bg-[#F8FAFF]'}`}>
        <span className="text-sm shrink-0 w-5 text-center" aria-hidden="true">{icon || '📄'}</span>
        {open && <span className="text-sm truncate flex-1">{title}</span>}
        {open && mandatory && <span className="w-1.5 h-1.5 rounded-full bg-[#B91C1C] shrink-0" title="Mandatory reading" />}
      </Link>
    )
  }

  return (
    <aside className={`shrink-0 transition-all duration-200 ${open ? 'w-56' : 'w-14'} flex flex-col`}>
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

        <nav className="flex-1 px-2 space-y-0.5">
          {pages === null ? (
            open && <p className="px-2 py-2 text-xs text-[#2A2035]/40">Loading…</p>
          ) : pages.length === 0 ? (
            // Legacy fallback list
            legacy.length ? legacy.map(l => <Item key={l.slug} slug={l.slug} title={l.title || l.slug} icon="📄" />)
              : (open && <p className="px-2 py-3 text-xs text-[#2A2035]/40">{canEdit ? 'No pages yet — create one in Manage pages.' : 'No pages yet.'}</p>)
          ) : (
            <>
              {groups.pinned.length > 0 && (
                <div className="mb-1">
                  {open && <p className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-[#2A2035]/35">Pinned</p>}
                  {groups.pinned.map(p => <Item key={p.id} slug={p.slug} icon={p.icon} title={p.title} mandatory={p.mandatory} />)}
                </div>
              )}
              {groups.byCat.map((g, gi) => (
                <div key={gi} className="mb-1">
                  {open && g.name && <p className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-[#2A2035]/35">{g.name}</p>}
                  {g.items.map(p => <Item key={p.id} slug={p.slug} icon={p.icon} title={p.title} mandatory={p.mandatory} />)}
                </div>
              ))}
            </>
          )}
        </nav>

        {canEdit && (
          <div className="px-2 py-3 border-t border-[#EEF2FF]">
            <Link href="/tutor/hub/manage" className={`flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-[#325099] hover:bg-[#F0F4FF] ${pathname?.startsWith('/tutor/hub/manage') ? 'bg-[#EEF4FF] font-semibold' : ''}`}>
              <span className="w-5 text-center" aria-hidden="true">⚙</span>{open && <span className="text-sm">Manage pages</span>}
            </Link>
          </div>
        )}
      </div>
    </aside>
  )
}

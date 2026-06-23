'use client'
/*
 * Info Centre management dashboard (editors only — admin/director).
 * Create from templates, search/filter, publish/unpublish, pin, mandatory,
 * categorise, tag, role-visibility, schedule, archive/restore, duplicate, delete.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useHub } from '../context'
import { supabase } from '../../../../lib/supabase'
import {
  listAllPages, listCategories, createPage, duplicatePage, deletePage, setStatus,
  unpublishPage, publishPage, updatePageMeta, createCategory, updateCategory,
  hasUnpublishedChanges,
} from '../../../../lib/infohub/data'
import { TEMPLATES } from '../../../../lib/infohub/templates'
import { mdToBlocks } from '../../../../lib/infohub/convert'

const ROLES = [
  { id: 'admin', label: 'Admin' }, { id: 'director', label: 'Director' }, { id: 'tutor', label: 'Teacher' },
]
const STATUS_STYLE = {
  draft:     'text-[#92400E] bg-[#FFF7ED] border-[#FDE2B8]',
  published: 'text-[#166534] bg-[#F0FDF4] border-[#A7F3D0]',
  scheduled: 'text-[#5B21B6] bg-[#F5F3FF] border-[#DDD6FE]',
  archived:  'text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]',
}

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return '—' }
}

export default function InfoManagePage() {
  const router = useRouter()
  const { staff, canEdit, loading: hubLoading } = useHub()
  const [pages, setPages] = useState(null)
  const [cats, setCats] = useState([])
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [catFilter, setCatFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [settingsPage, setSettingsPage] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [catOpen, setCatOpen] = useState(false)
  const [importing, setImporting] = useState(false)

  const reload = async () => {
    const [p, c] = await Promise.all([listAllPages(), listCategories({ includeArchived: true })])
    setPages(p); setCats(c)
  }
  useEffect(() => {
    if (!canEdit) return
    let active = true
    ;(async () => {
      const [p, c] = await Promise.all([listAllPages(), listCategories({ includeArchived: true })])
      if (active) { setPages(p); setCats(c) }
    })()
    return () => { active = false }
  }, [canEdit])

  const catName = (id) => cats.find(c => c.id === id)?.name || null

  const filtered = useMemo(() => {
    let list = pages || []
    if (statusFilter !== 'all') list = list.filter(p => p.status === statusFilter)
    if (catFilter !== 'all') list = list.filter(p => (catFilter === 'none' ? !p.category_id : p.category_id === catFilter))
    const s = q.trim().toLowerCase()
    if (s) list = list.filter(p => (p.title || '').toLowerCase().includes(s) || (p.tags || []).join(' ').toLowerCase().includes(s))
    return list
  }, [pages, statusFilter, catFilter, q])

  if (hubLoading) return <div className="p-10 text-sm text-[#2A2035]/50">Loading…</div>
  if (!canEdit) return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      <p className="text-sm font-semibold text-[#062E63]">This area is for Info Centre editors.</p>
      <p className="text-xs text-[#2A2035]/50 mt-1">Directors and admins can manage pages. <Link href="/tutor/hub" className="text-[#325099] underline">Back to Info Centre</Link></p>
    </div>
  )

  const createFromTemplate = async (tpl) => {
    setBusy(true)
    try {
      const page = await createPage({ title: tpl.title, blocks: tpl.blocks(), icon: tpl.icon })
      router.push(`/tutor/hub/manage/${page.id}`)
    } catch (e) { alert('Could not create page: ' + (e.message || e)); setBusy(false) }
  }

  const act = async (fn) => { setBusy(true); try { await fn(); await reload() } catch (e) { alert(e.message || e) } finally { setBusy(false) } }

  // One-time import of the legacy markdown pages + FAQ into the new system.
  const importLegacy = async () => {
    if (!confirm('Import the existing Info pages and FAQ into the new Info Centre? This creates new pages; the old ones are left untouched.')) return
    setImporting(true)
    try {
      let category = cats.find(c => /information/i.test(c.name))
      if (!category) category = await createCategory('Information')
      const { data: legacy } = await supabase.from('info_pages').select('slug, title, content').order('sort_order')
      for (const lp of legacy || []) {
        const exists = (pages || []).some(p => p.slug === lp.slug)
        if (exists) continue
        const blocks = mdToBlocks(lp.content || '')
        await supabase.from('infohub_pages').insert({
          slug: lp.slug, title: lp.title || lp.slug, draft: blocks, published: blocks,
          status: 'published', published_at: new Date().toISOString(), category_id: category.id,
          updated_by_name: staff?.full_name || 'Import',
        })
      }
      // FAQ → one page with an faq block
      const { data: faqCats } = await supabase.from('faq_categories').select('id, title, sort_order').order('sort_order')
      const { data: faqItems } = await supabase.from('faq_items').select('category_id, question, answer, sort_order').order('sort_order')
      if ((faqItems || []).length && !(pages || []).some(p => p.slug === 'faqs')) {
        const blocks = []
        for (const fc of faqCats || []) {
          const items = (faqItems || []).filter(f => f.category_id === fc.id).map(f => ({ q: f.question, a: f.answer || '' }))
          if (!items.length) continue
          blocks.push({ id: `h_${Math.random().toString(36).slice(2)}`, type: 'heading', level: 2, text: fc.title })
          blocks.push({ id: `f_${Math.random().toString(36).slice(2)}`, type: 'faq', items })
        }
        if (blocks.length) {
          await supabase.from('infohub_pages').insert({
            slug: 'faqs', title: 'Frequently Asked Questions', icon: '❓', draft: blocks, published: blocks,
            status: 'published', published_at: new Date().toISOString(), category_id: category.id,
            updated_by_name: staff?.full_name || 'Import',
          })
        }
      }
      await reload()
    } catch (e) { alert('Import failed: ' + (e.message || e)) }
    finally { setImporting(false) }
  }

  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
        <div>
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">Info Centre</p>
          <h1 className="text-2xl font-bold text-[#062E63] font-display">Manage pages</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCatOpen(true)} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3.5 py-2 hover:bg-[#F0F4FF]">Categories</button>
          <button onClick={() => setNewOpen(true)} className="text-xs font-semibold text-white bg-[#062E63] rounded-full px-4 py-2 hover:bg-[#325099]">＋ New page</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title or tags…"
          className="text-sm border border-[#DEE7FF] rounded-full px-4 py-2 w-60 focus:outline-none focus:border-[#325099]" />
        <div className="flex items-center rounded-full border border-[#DEE7FF] overflow-hidden text-xs">
          {['all', 'draft', 'published', 'scheduled', 'archived'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 font-semibold capitalize ${statusFilter === s ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>{s}</button>
          ))}
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1.5 focus:outline-none">
          <option value="all">All categories</option>
          <option value="none">Uncategorised</option>
          {cats.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* List */}
      {pages === null ? (
        <div className="py-16 text-center text-sm text-[#2A2035]/50">Loading pages…</div>
      ) : pages.length === 0 ? (
        <div className="bg-white border border-dashed border-[#DEE7FF] rounded-2xl py-14 text-center">
          <div className="text-3xl mb-2">📚</div>
          <p className="text-sm font-semibold text-[#062E63]">No pages yet.</p>
          <p className="text-xs text-[#2A2035]/55 mt-1 mb-4">Create your first page, or import your existing Info pages.</p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => setNewOpen(true)} className="text-xs font-semibold text-white bg-[#062E63] rounded-full px-4 py-2 hover:bg-[#325099]">＋ New page</button>
            <button onClick={importLegacy} disabled={importing} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-4 py-2 hover:bg-[#F0F4FF] disabled:opacity-50">{importing ? 'Importing…' : '⬇ Import existing pages'}</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-14 text-center text-sm text-[#2A2035]/45">No pages match your filters.</div>
      ) : (
        <div className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden divide-y divide-[#EEF2FF]">
          {filtered.map(p => {
            const unpub = hasUnpublishedChanges(p)
            return (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#FAFBFF]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {p.pinned && <span title="Pinned" aria-label="Pinned">📌</span>}
                    {p.icon && <span aria-hidden="true">{p.icon}</span>}
                    <Link href={`/tutor/hub/manage/${p.id}`} className="text-sm font-semibold text-[#062E63] truncate hover:underline">{p.title}</Link>
                    {p.mandatory && <span className="text-[9px] font-bold uppercase tracking-wider text-[#991B1B] bg-[#FEE2E2] border border-[#FCA5A5] rounded-full px-1.5 py-0.5">Mandatory</span>}
                    {unpub && p.status === 'published' && <span className="text-[9px] font-bold uppercase tracking-wider text-[#92400E] bg-[#FFF7ED] border border-[#FDE2B8] rounded-full px-1.5 py-0.5">Unpublished changes</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#2A2035]/50">
                    {catName(p.category_id) && <span className="text-[#325099]/70">{catName(p.category_id)}</span>}
                    <span>Updated {fmtDate(p.updated_at)}{p.updated_by_name ? ` · ${p.updated_by_name}` : ''}</span>
                    {(p.tags || []).slice(0, 3).map(t => <span key={t} className="text-[#5b7bc4]">#{t}</span>)}
                  </div>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_STYLE[p.status] || STATUS_STYLE.draft}`}>{p.status}</span>
                {/* quick actions */}
                <div className="flex items-center gap-1 text-[#2A2035]/40">
                  <button title={p.pinned ? 'Unpin' : 'Pin'} onClick={() => act(() => updatePageMeta(p.id, { pinned: !p.pinned }))} className="hover:text-[#325099] px-1">📌</button>
                  {p.status === 'published'
                    ? <button title="Unpublish" onClick={() => act(() => unpublishPage(p.id))} className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63] px-1">Unpublish</button>
                    : p.status !== 'archived' && <button title="Publish" onClick={() => act(() => publishPage(p.id, { editorId: staff?.id, editorName: staff?.full_name }))} className="text-[11px] font-semibold text-[#15803D] hover:underline px-1">Publish</button>}
                  <Link href={`/tutor/hub/manage/${p.id}`} className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63] px-1">Edit</Link>
                  <button title="Settings" onClick={() => setSettingsPage(p)} className="hover:text-[#325099] px-1">⚙</button>
                  <button title="Duplicate" onClick={() => act(() => duplicatePage(p.id))} className="hover:text-[#325099] px-1">⧉</button>
                  {p.status === 'archived'
                    ? <button title="Restore" onClick={() => act(() => setStatus(p.id, 'draft'))} className="text-[11px] text-[#325099] hover:underline px-1">Restore</button>
                    : <button title="Archive" onClick={() => act(() => setStatus(p.id, 'archived'))} className="hover:text-[#325099] px-1">🗄</button>}
                  <button title="Delete" onClick={() => setConfirmDel(p)} className="text-rose-400 hover:text-rose-600 px-1">🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {pages?.length > 0 && (
        <div className="mt-4 text-center">
          <button onClick={importLegacy} disabled={importing} className="text-[11px] font-semibold text-[#325099]/60 hover:text-[#325099] disabled:opacity-50">{importing ? 'Importing…' : 'Import any remaining legacy Info pages / FAQ'}</button>
        </div>
      )}

      {/* New page (template picker) */}
      {newOpen && (
        <Modal title="Create a page" onClose={() => setNewOpen(false)}>
          <p className="text-xs text-[#2A2035]/55 mb-3">Pick a starting template — every part stays fully editable.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {TEMPLATES.map(t => (
              <button key={t.id} disabled={busy} onClick={() => createFromTemplate(t)}
                className="text-left rounded-xl border border-[#DEE7FF] p-3 hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition disabled:opacity-50">
                <div className="text-xl mb-1">{t.icon}</div>
                <div className="text-sm font-semibold text-[#062E63]">{t.name}</div>
                <div className="text-[11px] text-[#2A2035]/50">{t.desc}</div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Per-page settings */}
      {settingsPage && (
        <SettingsModal page={settingsPage} cats={cats.filter(c => !c.archived)} onClose={() => setSettingsPage(null)}
          onSaved={async () => { setSettingsPage(null); await reload() }} />
      )}

      {/* Category manager */}
      {catOpen && (
        <CategoryModal cats={cats} onClose={() => setCatOpen(false)} onChanged={reload} />
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <Modal title="Delete page" onClose={() => setConfirmDel(null)}>
          <p className="text-sm text-[#2A2035]">Permanently delete <strong>{confirmDel.title}</strong>? This cannot be undone.</p>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setConfirmDel(null)} className="text-xs font-semibold text-[#325099]/60 px-4 py-2">Cancel</button>
            <button onClick={() => act(async () => { await deletePage(confirmDel.id); setConfirmDel(null) })} className="text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-full px-4 py-2">Delete permanently</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-10 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-[#062E63]">{title}</h2>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SettingsModal({ page, cats, onClose, onSaved }) {
  const [categoryId, setCategoryId] = useState(page.category_id || '')
  const [tags, setTags] = useState((page.tags || []).join(', '))
  const [roles, setRoles] = useState(page.visible_roles || ['admin', 'director', 'tutor'])
  const [mandatory, setMandatory] = useState(!!page.mandatory)
  const [icon, setIcon] = useState(page.icon || '')
  const [scheduledAt, setScheduledAt] = useState(page.scheduled_at ? page.scheduled_at.slice(0, 16) : '')
  const [saving, setSaving] = useState(false)
  const toggleRole = (r) => setRoles(rs => rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r])
  const save = async () => {
    setSaving(true)
    try {
      const patch = {
        category_id: categoryId || null,
        tags: tags.split(',').map(s => s.trim()).filter(Boolean),
        visible_roles: roles.length ? roles : ['admin', 'director', 'tutor'],
        mandatory, icon: icon || null,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }
      if (scheduledAt && page.status !== 'published') patch.status = 'scheduled'
      await updatePageMeta(page.id, patch)
      onSaved()
    } catch (e) { alert(e.message || e); setSaving(false) }
  }
  return (
    <Modal title={`Settings — ${page.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="w-20"><label className="block text-[11px] font-semibold text-[#325099]/70 mb-1">Icon</label><input value={icon} onChange={e => setIcon(e.target.value)} placeholder="📄" className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm" /></div>
          <div className="flex-1"><label className="block text-[11px] font-semibold text-[#325099]/70 mb-1">Category</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm">
              <option value="">Uncategorised</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div><label className="block text-[11px] font-semibold text-[#325099]/70 mb-1">Tags (comma-separated)</label><input value={tags} onChange={e => setTags(e.target.value)} placeholder="onboarding, policy" className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm" /></div>
        <div>
          <label className="block text-[11px] font-semibold text-[#325099]/70 mb-1">Who can view this page</label>
          <div className="flex gap-1.5">
            {ROLES.map(r => (
              <button key={r.id} onClick={() => toggleRole(r.id)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${roles.includes(r.id) ? 'bg-[#325099] text-white border-[#325099]' : 'text-[#325099] border-[#DEE7FF]'}`}>{r.label}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[#2A2035]"><input type="checkbox" checked={mandatory} onChange={e => setMandatory(e.target.checked)} className="accent-[#991B1B]" /> Mandatory reading</label>
        </div>
        <div><label className="block text-[11px] font-semibold text-[#325099]/70 mb-1">Schedule publish (optional)</label><input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm" /></div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-xs font-semibold text-[#325099]/60 px-4 py-2">Cancel</button>
          <button onClick={save} disabled={saving} className="text-xs font-semibold text-white bg-[#062E63] rounded-full px-5 py-2 hover:bg-[#325099] disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      </div>
    </Modal>
  )
}

function CategoryModal({ cats, onClose, onChanged }) {
  const [name, setName] = useState('')
  const add = async () => { if (!name.trim()) return; await createCategory(name.trim()); setName(''); onChanged() }
  return (
    <Modal title="Categories" onClose={onClose}>
      <div className="space-y-2 mb-3">
        {cats.length === 0 && <p className="text-xs text-[#2A2035]/45">No categories yet.</p>}
        {cats.map(c => (
          <div key={c.id} className="flex items-center gap-2">
            <input defaultValue={c.name} onBlur={e => e.target.value !== c.name && updateCategory(c.id, { name: e.target.value }).then(onChanged)}
              className={`flex-1 border border-[#DEE7FF] rounded-lg px-3 py-1.5 text-sm ${c.archived ? 'opacity-50' : ''}`} />
            <button onClick={() => updateCategory(c.id, { archived: !c.archived }).then(onChanged)} className="text-[11px] font-semibold text-[#325099]/60 hover:text-[#325099]">{c.archived ? 'Restore' : 'Archive'}</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New category name" className="flex-1 border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm" onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add} className="text-xs font-semibold text-white bg-[#325099] rounded-full px-4 py-2 hover:bg-[#062E63]">Add</button>
      </div>
    </Modal>
  )
}

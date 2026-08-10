'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'

/*
 * Online — /tutor/resources/online (English hub)
 *
 * A library of online resources: websites, videos, articles and interactive
 * tools worth reusing in class or setting for home study. Each entry is a
 * link with a type, an optional year level, and internal notes on how to use
 * it. Mirrors the Texts / Stimuli library's shape and behaviours.
 */

const RESOURCE_TYPES = ['Website', 'Video', 'Article', 'Interactive', 'Past papers', 'Other']
const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]

const TYPE_CLS = {
  'Website':     'bg-[#EEF4FF] text-[#325099] border-[#DEE7FF]',
  'Video':       'bg-[#FDF2F8] text-[#BE185D] border-[#FBCFE8]',
  'Article':     'bg-[#ECF9F4] text-[#0E7A5F] border-[#CBEBDF]',
  'Interactive': 'bg-[#F4EFFC] text-[#6D4FA3] border-[#E2D8F3]',
  'Past papers': 'bg-[#FFF7E8] text-[#B45309] border-[#F5E3BF]',
  'Other':       'bg-[#F4F4F5] text-[#52525B] border-[#E4E4E7]',
}

// Display form of a URL: strip the scheme and trailing slash so cards read
// "site.com/page", not "https://site.com/page/".
const prettyUrl = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '')

function ResourceEditorModal({ resource, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: resource?.title || '',
    url: resource?.url || '',
    resource_type: resource?.resource_type || 'Website',
    year: resource?.year ?? '',
    notes: resource?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (!form.title.trim()) { alert('Give the resource a title.'); return }
    let url = form.url.trim()
    if (!url) { alert('Add the link.'); return }
    // Bare "site.com/…" is what people paste — make it a real link.
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    try { new URL(url) } catch { alert('That link doesn’t look like a valid URL.'); return }
    setSaving(true)
    const payload = {
      title: form.title.trim(),
      url,
      resource_type: form.resource_type,
      year: form.year === '' ? null : Number(form.year),
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = resource?.id
      ? await supabase.from('online_resources').update(payload).eq('id', resource.id)
      : await supabase.from('online_resources').insert(payload)
    setSaving(false)
    if (error) { alert('Could not save: ' + error.message); return }
    onSaved()
  }

  const INP = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]'
  const LBL = 'block text-[11px] font-semibold text-[#325099] mb-1'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[#062E63]">{resource?.id ? 'Edit resource' : 'New resource'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] text-lg">×</button>
        </div>
        <div className="space-y-3">
          <div><label className={LBL}>Title</label><input className={INP} value={form.title} onChange={set('title')} placeholder="e.g. NAPLAN persuasive writing guide" /></div>
          <div><label className={LBL}>Link</label><input className={INP} value={form.url} onChange={set('url')} placeholder="e.g. https://…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LBL}>Type</label>
              <select className={INP} value={form.resource_type} onChange={set('resource_type')}>
                {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={LBL}>Year level (optional)</label>
              <select className={INP} value={form.year} onChange={set('year')}>
                <option value="">Any</option>
                {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
          </div>
          <div><label className={LBL}>Notes (internal — what it’s good for, which classes)</label>
            <textarea className={INP + ' resize-y'} rows={3} value={form.notes} onChange={set('notes')} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[#DEE7FF] text-sm font-semibold text-[#2A2035]/60 hover:bg-[#F8FAFF]">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Saving…' : 'Save resource'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OnlineResourcesPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [editing, setEditing] = useState(null)   // null | {} (new) | row

  const reload = useCallback(async () => {
    const { data } = await supabase.from('online_resources').select('*').order('updated_at', { ascending: false })
    setResources(data || []); setLoading(false)
  }, [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true); reload()
    })
  }, [router, reload])

  const shown = useMemo(() => resources.filter((r) => {
    if (typeFilter && r.resource_type !== typeFilter) return false
    if (yearFilter && String(r.year ?? '') !== yearFilter) return false
    if (search.trim()) {
      const hay = `${r.title} ${r.url} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(search.trim().toLowerCase())) return false
    }
    return true
  }), [resources, search, typeFilter, yearFilter])

  const remove = async (r) => {
    if (!confirm(`Delete "${r.title}"? This can't be undone.`)) return
    const { error } = await supabase.from('online_resources').delete().eq('id', r.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    setResources((xs) => xs.filter((x) => x.id !== r.id))
  }

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-4xl mx-auto px-6 pt-8 pb-16">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Online — English</h1>
            <p className="text-sm text-[#325099]/60 mt-1">
              Online resources worth reusing — websites, videos, articles and interactive tools.
              {' · '}<Link href="/tutor/resources/english" className="text-[#325099] hover:underline">back to hub</Link>
            </p>
          </div>
          <button onClick={() => setEditing({})}
            className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition">+ New resource</button>
        </div>

        {/* Filters */}
        <div className="mt-5 bg-white rounded-2xl border border-[#F0F4FF] p-3 flex flex-wrap items-center gap-2">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]">
            <option value="">All types</option>
            {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}
            className="border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]">
            <option value="">All years</option>
            {YEARS.map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, link or notes…"
            className="flex-1 min-w-[160px] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
          <span className="text-xs text-[#2A2035]/40">{shown.length} resource{shown.length === 1 ? '' : 's'}</span>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-center text-sm text-[#2A2035]/40 py-12 animate-pulse">Loading resources…</p>
        ) : shown.length === 0 ? (
          <div className="mt-5 text-center py-16 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
            <div className="text-4xl mb-2">🌐</div>
            <p className="text-sm text-[#2A2035]/50">{resources.length === 0 ? 'No online resources yet.' : 'No resources match your filters.'}</p>
            {resources.length === 0 && <button onClick={() => setEditing({})} className="mt-3 px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold">Add your first resource</button>}
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {shown.map((r) => (
              <div key={r.id} className="bg-white rounded-2xl border border-[#F0F4FF] p-4 hover:border-[#BACBFF] transition">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TYPE_CLS[r.resource_type] || TYPE_CLS.Other}`}>{r.resource_type}</span>
                  {r.year && <span className="text-[10px] text-[#2A2035]/40 font-semibold">Year {r.year}</span>}
                  <span className="text-sm font-bold text-[#062E63]">{r.title}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[#325099] hover:underline">Open ↗</a>
                    <button onClick={() => setEditing(r)} className="text-[11px] font-semibold text-[#325099] hover:underline">Edit</button>
                    <button onClick={() => remove(r)} className="text-[11px] text-[#DC2626]/70 hover:text-[#DC2626]">Delete</button>
                  </div>
                </div>
                <a href={r.url} target="_blank" rel="noopener noreferrer"
                  className="mt-1 block text-[12px] text-[#325099]/70 hover:underline truncate">{prettyUrl(r.url)}</a>
                {r.notes && <p className="mt-1.5 text-[12px] text-[#2A2035]/55">{r.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing !== null && (
        <ResourceEditorModal resource={editing?.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }} />
      )}
    </div>
  )
}

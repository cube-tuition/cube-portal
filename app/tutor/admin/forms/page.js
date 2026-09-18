'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { T_FORMS, T_FORM_SUBMISSIONS } from '../../../../lib/tables'
import { FIELD_TYPES, OPTION_TYPES, WEBSITE_FORMS, slugify, keyify, publicFormUrl, blankField, formatValue } from '../../../../lib/forms'

/*
 * Forms — /tutor/admin/forms
 *
 * Every form families fill in, in one place, each with a public URL to copy
 * into an email or the website. Portal-hosted forms are edited here (fields,
 * wording, where submissions are emailed) and served at /forms/<slug>; their
 * submissions are listed here too. Website forms that live elsewhere are
 * listed alongside so nothing is forgotten.
 */

const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''

export default function FormsAdminPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [forms, setForms] = useState([])
  const [counts, setCounts] = useState({})          // form_id → { total, new }
  const [currentId, setCurrentId] = useState('')
  const [mode, setMode] = useState('edit')          // edit | submissions
  const [draft, setDraft] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [subs, setSubs] = useState([])
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState('')

  const current = forms.find(f => f.id === currentId) || null

  const loadCounts = async () => {
    const { data } = await supabase.from(T_FORM_SUBMISSIONS).select('form_id, status')
    const c = {}
    for (const r of data || []) { (c[r.form_id] ||= { total: 0, new: 0 }); c[r.form_id].total++; if (r.status === 'new') c[r.form_id].new++ }
    setCounts(c)
  }
  const openForm = (f, m = 'edit') => {
    setCurrentId(f.id); setMode(m); setDirty(false); setError(null)
    setDraft({ ...f, fields: Array.isArray(f.fields) ? f.fields.map(x => ({ ...blankField(), ...x, options: x.options || [] })) : [] })
  }

  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)
      const { data } = await supabase.from(T_FORMS).select('*').order('created_at')
      setForms(data || [])
      await loadCounts()
      if (data?.length) openForm(data[0])
      setLoading(false)
    })()
  }, [router])

  useEffect(() => {
    if (mode !== 'submissions' || !currentId) return
    supabase.from(T_FORM_SUBMISSIONS).select('*').eq('form_id', currentId).order('submitted_at', { ascending: false })
      .then(({ data }) => setSubs(data || []))
  }, [mode, currentId])

  // ── Form CRUD ────────────────────────────────────────────────────────────────
  const setField = (k, v) => { setDraft(d => ({ ...d, [k]: v })); setDirty(true) }
  const setF = (i, patch) => setField('fields', draft.fields.map((f, j) => j === i ? { ...f, ...patch } : f))
  const moveF = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= draft.fields.length) return
    const next = draft.fields.slice(); [next[i], next[j]] = [next[j], next[i]]; setField('fields', next)
  }
  const newForm = async () => {
    const title = 'New form'
    const slug = `${slugify(title)}-${Date.now().toString(36).slice(-4)}`
    const { data, error: err } = await supabase.from(T_FORMS).insert({ title, slug, fields: [blankField()], created_by: profile?.full_name }).select('*').single()
    if (err) { setError(err.message); return }
    setForms(prev => [...prev, data]); openForm(data)
  }
  const saveForm = async () => {
    if (!draft) return
    const slug = slugify(draft.slug || draft.title)
    if (!slug) { setError('The form needs a link name.'); return }
    const fields = draft.fields.map(f => ({
      ...f, key: keyify(f.key || f.label), label: (f.label || '').trim(),
      options: OPTION_TYPES.includes(f.type) ? (f.options || []).map(o => String(o).trim()).filter(Boolean) : [],
    })).filter(f => f.key && f.label)
    const keys = fields.map(f => f.key)
    if (new Set(keys).size !== keys.length) { setError('Two fields have the same name — make the labels distinct.'); return }
    setSaving(true); setError(null)
    const patch = { title: draft.title.trim() || 'Untitled form', slug, description: draft.description || '', confirmation: draft.confirmation || '',
      notify_email: (draft.notify_email || '').trim() || null, active: !!draft.active, fields, updated_at: new Date().toISOString() }
    const { error: err } = await supabase.from(T_FORMS).update(patch).eq('id', draft.id)
    setSaving(false)
    if (err) { setError(err.code === '23505' ? 'That link name is already used by another form.' : err.message); return }
    const updated = { ...draft, ...patch }
    setForms(prev => prev.map(f => f.id === draft.id ? updated : f)); setDraft({ ...updated, fields: fields.map(f => ({ ...blankField(), ...f })) }); setDirty(false)
  }
  const deleteForm = async () => {
    if (!current || !confirm(`Delete "${current.title}" and all its submissions?`)) return
    const { error: err } = await supabase.from(T_FORMS).delete().eq('id', current.id)
    if (err) { setError(err.message); return }
    const rest = forms.filter(f => f.id !== current.id); setForms(rest)
    if (rest.length) openForm(rest[0]); else { setCurrentId(''); setDraft(null) }
  }
  const toggleActive = async (f) => {
    const { error: err } = await supabase.from(T_FORMS).update({ active: !f.active, updated_at: new Date().toISOString() }).eq('id', f.id)
    if (err) { setError(err.message); return }
    setForms(prev => prev.map(x => x.id === f.id ? { ...x, active: !f.active } : x))
    if (draft?.id === f.id) setDraft(d => ({ ...d, active: !f.active }))
  }
  const copyUrl = async (slug) => {
    try { await navigator.clipboard.writeText(publicFormUrl(slug)); setCopied(slug); setTimeout(() => setCopied(''), 1500) } catch { /* clipboard blocked */ }
  }

  // ── Submissions ──────────────────────────────────────────────────────────────
  const setStatus = async (s, status) => {
    await supabase.from(T_FORM_SUBMISSIONS).update({ status }).eq('id', s.id)
    setSubs(prev => prev.map(x => x.id === s.id ? { ...x, status } : x)); loadCounts()
  }
  const deleteSub = async (s) => {
    if (!confirm('Delete this submission?')) return
    await supabase.from(T_FORM_SUBMISSIONS).delete().eq('id', s.id)
    setSubs(prev => prev.filter(x => x.id !== s.id)); loadCounts()
  }
  const exportCsv = () => {
    const cols = (current?.fields || [])
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [['Submitted', 'Status', ...cols.map(c => c.label)].map(esc).join(',')]
    for (const s of subs) rows.push([fmtWhen(s.submitted_at), s.status, ...cols.map(c => formatValue(s.data?.[c.key]))].map(esc).join(','))
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${current.slug}-submissions.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const subCols = useMemo(() => (current?.fields || []), [current])
  const input = 'w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#325099] bg-white'
  const label = 'block text-[11px] font-semibold text-[#325099] mb-1'
  const small = 'text-xs font-semibold rounded-lg px-2.5 py-1.5 border'

  return (
    <div className="min-h-screen bg-[#F7F9FF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-[#062E63]">Forms</h1>
        <p className="text-sm text-[#325099]/60 mt-1 mb-6">Every form families fill in, with a link to copy into an email or the website. Portal forms are edited here and served at <code className="font-mono">/forms/…</code>; their submissions land below and in the admin inbox.</p>
        {error && <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-2">{error}</div>}

        {loading ? <p className="text-sm text-[#2A2035]/40 py-12 text-center animate-pulse">Loading…</p> : (
          <div className="grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-5">
            {/* Left: every form */}
            <div className="space-y-4">
              <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
                <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3 flex items-center justify-between">
                  <p className="text-xs font-bold text-[#062E63]">Portal forms</p>
                  <button onClick={newForm} className="text-[11px] font-semibold text-[#325099] hover:underline">+ New form</button>
                </div>
                <div className="divide-y divide-[#F0F4FF]">
                  {forms.length === 0 && <p className="text-center text-xs text-[#2A2035]/40 py-8">No forms yet.</p>}
                  {forms.map(f => {
                    const c = counts[f.id] || { total: 0, new: 0 }
                    return (
                      <div key={f.id} className={`px-4 py-3 ${f.id === currentId ? 'bg-[#F3F6FF]' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <button onClick={() => openForm(f, mode)} className="text-left min-w-0">
                            <span className="block text-sm font-semibold text-[#062E63] truncate">{f.title}</span>
                            <span className="block text-[11px] text-[#2A2035]/45 truncate">{publicFormUrl(f.slug)}</span>
                          </button>
                          <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${f.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{f.active ? 'live' : 'closed'}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <button onClick={() => copyUrl(f.slug)} className={`${small} bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]`}>{copied === f.slug ? 'Copied ✓' : '🔗 Copy link'}</button>
                          <a href={`/forms/${f.slug}`} target="_blank" rel="noreferrer" className={`${small} bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]`}>Open ↗</a>
                          <button onClick={() => openForm(f, 'submissions')} className={`${small} bg-white text-[#062E63] border-[#DEE7FF] hover:border-[#325099]`}>
                            {c.total} submission{c.total === 1 ? '' : 's'}{c.new ? <span className="ml-1 text-[#B23A3A]">· {c.new} new</span> : null}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
                <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3"><p className="text-xs font-bold text-[#062E63]">Website forms</p></div>
                <div className="divide-y divide-[#F0F4FF]">
                  {WEBSITE_FORMS.map(w => (
                    <div key={w.url} className="px-4 py-3">
                      <span className="block text-sm font-semibold text-[#062E63]">{w.title}</span>
                      <a href={w.url} target="_blank" rel="noreferrer" className="block text-[11px] text-[#325099] hover:underline truncate">{w.url}</a>
                      <p className="text-[11px] text-[#2A2035]/45 mt-1">{w.note} {w.href && <Link href={w.href} className="text-[#325099] hover:underline">Open Trials →</Link>}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Right: editor or submissions */}
            {!draft ? (
              <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center text-sm text-[#325099]/50">Create a form to get started.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex rounded-xl border border-[#DEE7FF] overflow-hidden bg-white">
                    {['edit', 'submissions'].map(m => (
                      <button key={m} onClick={() => setMode(m)} className={`text-xs font-semibold px-4 py-2 ${mode === m ? 'bg-[#062E63] text-white' : 'text-[#325099] hover:bg-[#F3F6FF]'}`}>{m === 'edit' ? 'Edit form' : 'Submissions'}</button>
                    ))}
                  </div>
                  <span className="text-sm font-bold text-[#062E63] ml-2 truncate">{current?.title}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => toggleActive(current)} className={`${small} bg-white border-[#DEE7FF] hover:border-[#325099] ${current?.active ? 'text-[#B23A3A]' : 'text-emerald-700'}`}>{current?.active ? 'Close form' : 'Open form'}</button>
                    <button onClick={deleteForm} className={`${small} bg-white text-[#B23A3A] border-[#F3C0C0] hover:bg-[#FFF5F5]`}>Delete</button>
                  </div>
                </div>

                {mode === 'edit' ? (
                  <>
                    <section className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className={label}>Title</label>
                          <input value={draft.title} onChange={e => setField('title', e.target.value)} className={input} />
                        </div>
                        <div>
                          <label className={label}>Link name <span className="font-normal text-[#325099]/50">· /forms/…</span></label>
                          <input value={draft.slug} onChange={e => setField('slug', slugify(e.target.value))} className={`${input} font-mono`} />
                        </div>
                      </div>
                      <label className={label}>Description <span className="font-normal text-[#325099]/50">· shown under the title</span></label>
                      <textarea value={draft.description} onChange={e => setField('description', e.target.value)} rows={2} className={`${input} resize-y mb-4`} />
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label className={label}>Thank-you message</label>
                          <textarea value={draft.confirmation} onChange={e => setField('confirmation', e.target.value)} rows={2} className={`${input} resize-y`} />
                        </div>
                        <div>
                          <label className={label}>Email new submissions to <span className="font-normal text-[#325099]/50">· blank = admin inbox</span></label>
                          <input value={draft.notify_email || ''} onChange={e => setField('notify_email', e.target.value)} placeholder="admin@cubetuition.com.au" className={input} />
                        </div>
                      </div>
                    </section>

                    <section className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-bold text-[#062E63]">Fields</p>
                        <button onClick={() => setField('fields', [...draft.fields, blankField()])} className="text-[11px] font-semibold text-[#325099] hover:underline">+ Add field</button>
                      </div>
                      <div className="space-y-3">
                        {draft.fields.map((f, i) => (
                          <div key={i} className="border border-[#EEF2FB] rounded-xl p-3 bg-[#FBFCFF]">
                            <div className="grid sm:grid-cols-[minmax(0,1fr)_150px_auto] gap-2 items-end">
                              <div>
                                <label className={label}>Label</label>
                                <input value={f.label} onChange={e => setF(i, { label: e.target.value, key: f.key || keyify(e.target.value) })} className={input} placeholder="e.g. Parent email" />
                              </div>
                              <div>
                                <label className={label}>Type</label>
                                <select value={f.type} onChange={e => setF(i, { type: e.target.value })} className={input}>
                                  {FIELD_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                                </select>
                              </div>
                              <div className="flex items-center gap-2 pb-2">
                                <label className="flex items-center gap-1 text-[11px] font-semibold text-[#325099] cursor-pointer"><input type="checkbox" checked={!!f.required} onChange={e => setF(i, { required: e.target.checked })} className="accent-[#325099]" />Required</label>
                                <button onClick={() => moveF(i, -1)} disabled={i === 0} className="text-[10px] text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20">▲</button>
                                <button onClick={() => moveF(i, 1)} disabled={i === draft.fields.length - 1} className="text-[10px] text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20">▼</button>
                                <button onClick={() => setField('fields', draft.fields.filter((_, j) => j !== i))} className="text-[12px] text-[#2A2035]/30 hover:text-[#DC2626]">✕</button>
                              </div>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-2 mt-2">
                              {OPTION_TYPES.includes(f.type) ? (
                                <div className="sm:col-span-2">
                                  <label className={label}>Options <span className="font-normal text-[#325099]/50">· one per line</span></label>
                                  <textarea value={(f.options || []).join('\n')} onChange={e => setF(i, { options: e.target.value.split('\n') })} rows={3} className={`${input} resize-y`} />
                                </div>
                              ) : (
                                <div>
                                  <label className={label}>Placeholder <span className="font-normal text-[#325099]/50">· optional</span></label>
                                  <input value={f.placeholder || ''} onChange={e => setF(i, { placeholder: e.target.value })} className={input} />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <div className="flex items-center gap-3">
                      <button onClick={saveForm} disabled={saving || !dirty}
                        className="text-sm font-semibold rounded-xl px-5 py-2.5 bg-[#325099] text-white hover:bg-[#062E63] disabled:opacity-50">
                        {saving ? 'Saving…' : dirty ? 'Save form' : 'Saved ✓'}
                      </button>
                      <a href={`/forms/${current?.slug}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[#325099] hover:underline">Preview the live form ↗</a>
                      {dirty && <span className="text-[11px] text-amber-700">Unsaved changes.</span>}
                    </div>
                  </>
                ) : (
                  <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
                    <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3 flex items-center justify-between">
                      <p className="text-xs font-bold text-[#062E63]">{subs.length} submission{subs.length === 1 ? '' : 's'}</p>
                      <button onClick={exportCsv} disabled={!subs.length} className="text-[11px] font-semibold text-[#325099] hover:underline disabled:opacity-40">⬇ Export CSV</button>
                    </div>
                    {subs.length === 0 ? <p className="text-center text-xs text-[#2A2035]/40 py-10">Nothing submitted yet.</p> : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-[#FBFCFF] text-[10px] uppercase tracking-wider text-[#325099]/70">
                            <tr>
                              <th className="text-left px-3 py-2 whitespace-nowrap">Submitted</th>
                              {subCols.map(c => <th key={c.key} className="text-left px-3 py-2 whitespace-nowrap">{c.label}</th>)}
                              <th className="px-3 py-2"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F0F4FF]">
                            {subs.map(s => (
                              <tr key={s.id} className={s.status === 'new' ? 'bg-[#FFFBEB]/60' : ''}>
                                <td className="px-3 py-2 whitespace-nowrap text-[#2A2035]/70">{fmtWhen(s.submitted_at)}{s.status === 'new' && <span className="ml-1.5 text-[9px] font-bold uppercase text-[#B23A3A]">new</span>}</td>
                                {subCols.map(c => <td key={c.key} className="px-3 py-2 text-[#2A2035] max-w-[220px] truncate" title={formatValue(s.data?.[c.key])}>{formatValue(s.data?.[c.key])}</td>)}
                                <td className="px-3 py-2 whitespace-nowrap text-right">
                                  <button onClick={() => setStatus(s, s.status === 'new' ? 'handled' : 'new')} className="text-[11px] font-semibold text-[#325099] hover:underline mr-3">{s.status === 'new' ? 'Mark handled' : 'Mark new'}</button>
                                  <button onClick={() => deleteSub(s)} className="text-[11px] text-[#2A2035]/40 hover:text-[#DC2626]">Delete</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

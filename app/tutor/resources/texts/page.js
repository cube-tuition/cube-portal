'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'

/*
 * Texts / Stimuli — /tutor/resources/texts (English hub)
 *
 * A library of reusable reading passages (poems, extracts, articles…) with
 * their attribution. Line breaks are stored exactly as typed so verse keeps
 * its shape — the same convention as the workbook builder's Stimulus block,
 * so a library text can be pasted straight into one.
 */

const TEXT_TYPES = ['Poem', 'Prose extract', 'Article', 'Speech', 'Visual description', 'Other']
const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]

const TYPE_CLS = {
  'Poem':               'bg-[#F4EFFC] text-[#6D4FA3] border-[#E2D8F3]',
  'Prose extract':      'bg-[#EEF4FF] text-[#325099] border-[#DEE7FF]',
  'Article':            'bg-[#ECF9F4] text-[#0E7A5F] border-[#CBEBDF]',
  'Speech':             'bg-[#FFF7E8] text-[#B45309] border-[#F5E3BF]',
  'Visual description': 'bg-[#FDF2F8] text-[#BE185D] border-[#FBCFE8]',
  'Other':              'bg-[#F4F4F5] text-[#52525B] border-[#E4E4E7]',
}

function TextEditorModal({ text, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: text?.title || '',
    source: text?.source || '',
    text_type: text?.text_type || 'Poem',
    year: text?.year ?? '',
    body: text?.body || '',
    notes: text?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (!form.title.trim()) { alert('Give the text a title.'); return }
    setSaving(true)
    const payload = {
      title: form.title.trim(),
      source: form.source.trim() || null,
      text_type: form.text_type,
      year: form.year === '' ? null : Number(form.year),
      body: form.body,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = text?.id
      ? await supabase.from('stimulus_texts').update(payload).eq('id', text.id)
      : await supabase.from('stimulus_texts').insert(payload)
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
          <h2 className="text-lg font-bold text-[#062E63]">{text?.id ? 'Edit text' : 'New text'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] text-lg">×</button>
        </div>
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={LBL}>Title</label><input className={INP} value={form.title} onChange={set('title')} placeholder="e.g. Mother to Son" /></div>
            <div><label className={LBL}>Source / author (optional)</label><input className={INP} value={form.source} onChange={set('source')} placeholder="e.g. Langston Hughes, 1922" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LBL}>Type</label>
              <select className={INP} value={form.text_type} onChange={set('text_type')}>
                {TEXT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={LBL}>Year level (optional)</label>
              <select className={INP} value={form.year} onChange={set('year')}>
                <option value="">Any</option>
                {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={LBL}>Text — line breaks are kept exactly (paste verse as-is; a blank line makes a stanza gap)</label>
            <textarea className={INP + ' font-mono text-[13px] resize-y'} rows={12} value={form.body} onChange={set('body')} />
          </div>
          <div><label className={LBL}>Notes (internal — e.g. which classes it suits, question angles)</label>
            <textarea className={INP + ' resize-y'} rows={2} value={form.notes} onChange={set('notes')} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[#DEE7FF] text-sm font-semibold text-[#2A2035]/60 hover:bg-[#F8FAFF]">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Saving…' : 'Save text'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TextsStimuliPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [texts, setTexts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [editing, setEditing] = useState(null)   // null | {} (new) | row
  const [expanded, setExpanded] = useState(null) // id of the full-text preview

  const reload = useCallback(async () => {
    const { data } = await supabase.from('stimulus_texts').select('*').order('updated_at', { ascending: false })
    setTexts(data || []); setLoading(false)
  }, [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true); reload()
    })
  }, [router, reload])

  const shown = useMemo(() => texts.filter((t) => {
    if (typeFilter && t.text_type !== typeFilter) return false
    if (yearFilter && String(t.year ?? '') !== yearFilter) return false
    if (search.trim()) {
      const hay = `${t.title} ${t.source || ''} ${t.body}`.toLowerCase()
      if (!hay.includes(search.trim().toLowerCase())) return false
    }
    return true
  }), [texts, search, typeFilter, yearFilter])

  const remove = async (t) => {
    if (!confirm(`Delete "${t.title}"? This can't be undone.`)) return
    const { error } = await supabase.from('stimulus_texts').delete().eq('id', t.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    setTexts((xs) => xs.filter((x) => x.id !== t.id))
  }

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-4xl mx-auto px-6 pt-8 pb-16">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Texts / Stimuli — English</h1>
            <p className="text-sm text-[#325099]/60 mt-1">
              Reusable passages for reading comprehension — paste one into a workbook’s Stimulus block.
              {' · '}<Link href="/tutor/resources/english" className="text-[#325099] hover:underline">back to hub</Link>
            </p>
          </div>
          <button onClick={() => setEditing({})}
            className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition">+ New text</button>
        </div>

        {/* Filters */}
        <div className="mt-5 bg-white rounded-2xl border border-[#F0F4FF] p-3 flex flex-wrap items-center gap-2">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]">
            <option value="">All types</option>
            {TEXT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}
            className="border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]">
            <option value="">All years</option>
            {YEARS.map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, author or text…"
            className="flex-1 min-w-[160px] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
          <span className="text-xs text-[#2A2035]/40">{shown.length} text{shown.length === 1 ? '' : 's'}</span>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-center text-sm text-[#2A2035]/40 py-12 animate-pulse">Loading texts…</p>
        ) : shown.length === 0 ? (
          <div className="mt-5 text-center py-16 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
            <div className="text-4xl mb-2">❝</div>
            <p className="text-sm text-[#2A2035]/50">{texts.length === 0 ? 'No texts in the library yet.' : 'No texts match your filters.'}</p>
            {texts.length === 0 && <button onClick={() => setEditing({})} className="mt-3 px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold">Add your first text</button>}
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {shown.map((t) => (
              <div key={t.id} className="bg-white rounded-2xl border border-[#F0F4FF] p-4 hover:border-[#BACBFF] transition">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TYPE_CLS[t.text_type] || TYPE_CLS.Other}`}>{t.text_type}</span>
                  {t.year && <span className="text-[10px] text-[#2A2035]/40 font-semibold">Year {t.year}</span>}
                  <span className="text-sm font-bold text-[#062E63]">{t.title}</span>
                  {t.source && <span className="text-xs italic text-[#2A2035]/45">— {t.source}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => setExpanded(expanded === t.id ? null : t.id)} className="text-[11px] font-semibold text-[#325099] hover:underline">{expanded === t.id ? 'Hide' : 'View'}</button>
                    <button onClick={() => setEditing(t)} className="text-[11px] font-semibold text-[#325099] hover:underline">Edit</button>
                    <button onClick={() => remove(t)} className="text-[11px] text-[#DC2626]/70 hover:text-[#DC2626]">Delete</button>
                  </div>
                </div>
                <pre className={`mt-2 text-[13px] leading-relaxed text-[#2A2035] whitespace-pre-wrap font-[inherit] ${expanded === t.id ? '' : 'line-clamp-3'}`}
                  style={{ fontFamily: 'inherit' }}>{t.body}</pre>
                {t.notes && expanded === t.id && (
                  <p className="mt-2 text-[11px] text-[#2A2035]/50 border-t border-[#F0F4FF] pt-2">📝 {t.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing !== null && (
        <TextEditorModal text={editing?.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }} />
      )}
    </div>
  )
}

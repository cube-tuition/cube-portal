'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { T_BOOKLET_BUILDS } from '../../../../lib/tables'
import { newBlock } from '../../../../lib/bookletRender'

/*
 * Level Tests — a list of level tests plus a builder, mirroring the booklet
 * workflow. Level tests are stored as booklet_builds rows with doc_type
 * 'level_test' and are edited in the shared booklet builder (which renders the
 * exam-style cover + footer for this doc type).
 */

const SUBJECTS = ['Mathematics', 'English', 'Chemistry', 'Science']
const YEARS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

// Standard cover defaults for a new level test (editable later via the DB).
const DEFAULT_COVER = {
  instructions: [
    'Working time – 60 minutes',
    'Write using black pen',
    'Calculators are **not** allowed',
    'For questions show relevant mathematical reasoning and/or calculations',
  ],
  totals: [
    '60 marks',
    'Attempt all questions',
    'Allow about 1 minute per mark',
  ],
}

export default function LevelTestsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [tests, setTests] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ title: '', year: 6, subject: 'Mathematics' })
  const [deletingId, setDeletingId] = useState(null)
  const [subjectTab, setSubjectTab] = useState('Mathematics')   // 'Mathematics' | 'English'

  // Tests for the active subject tab. Maths covers Mathematics/Maths; English
  // covers English/EALD. Anything else is grouped under its closest tab match.
  const isMaths = (s) => /math/i.test(s || '')
  const isEnglish = (s) => /english|eald/i.test(s || '')
  const visibleTests = tests.filter(t => subjectTab === 'Mathematics' ? isMaths(t.subject) : isEnglish(t.subject))

  const reload = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from(T_BOOKLET_BUILDS)
      .select('id, title, year, subject, updated_at')
      .eq('doc_type', 'level_test')
      .order('updated_at', { ascending: false })
    setTests(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    getAuthProfile().then(async ({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
      reload()
    })
  }, [router, reload])

  const createTest = async () => {
    setCreating(true)
    try {
      const title = form.title.trim() || `Year ${form.year} ${form.subject} Level Test`
      const blocks = [{ ...newBlock('subtopic'), title: 'Section I' }]
      const { data, error } = await supabase
        .from(T_BOOKLET_BUILDS)
        .insert({
          title,
          year: Number(form.year) || null,
          subject: form.subject,
          topic: 'Level Test',
          doc_type: 'level_test',
          cover: DEFAULT_COVER,
          blocks,
          created_by: profile?.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      router.push(`/tutor/booklets/builder/${data.id}`)
    } catch (e) {
      alert('Could not create the level test: ' + (e.message || String(e)))
      setCreating(false)
    }
  }

  const deleteTest = async (id) => {
    if (deletingId !== id) { setDeletingId(id); setTimeout(() => setDeletingId(null), 3500); return }
    await supabase.from(T_BOOKLET_BUILDS).delete().eq('id', id)
    setTests(prev => prev.filter(t => t.id !== id))
    setDeletingId(null)
  }

  const fmtDate = (s) => s ? new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role === 'admin'} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-5xl mx-auto px-6 md:px-10 py-10">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-2">Resources · Admin</p>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#2A2035]">Level Tests</h1>
              <p className="text-sm text-[#2A2035]/60 mt-1">Build and manage placement/level tests. Each one opens in the workbook builder with the exam-style cover.</p>
            </div>
            <button onClick={() => { setForm(f => ({ ...f, subject: subjectTab })); setShowNew(true) }}
              className="text-sm font-semibold text-white bg-[#062E63] hover:bg-[#325099] px-5 py-2.5 rounded-full transition">
              + New level test
            </button>
          </div>

          {/* Subject tabs */}
          <div className="flex items-center gap-2 mt-6">
            {[{ id: 'Mathematics', label: 'Maths' }, { id: 'English', label: 'English' }].map(tab => (
              <button
                key={tab.id}
                onClick={() => setSubjectTab(tab.id)}
                className={`px-5 py-2 rounded-full text-sm font-semibold border transition ${
                  subjectTab === tab.id
                    ? 'bg-[#062E63] text-white border-[#062E63]'
                    : 'bg-white text-[#062E63] border-[#DEE7FF] hover:bg-[#F8FAFF]'
                }`}
              >
                {tab.label}
                <span className={`ml-2 text-[11px] font-bold ${subjectTab === tab.id ? 'text-white/70' : 'text-[#2A2035]/40'}`}>
                  {tests.filter(t => tab.id === 'Mathematics' ? isMaths(t.subject) : isEnglish(t.subject)).length}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 md:px-10 py-10">
        {loading ? (
          <p className="text-sm text-[#2A2035]/60">Loading level tests…</p>
        ) : visibleTests.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] p-12 text-center">
            <div className="text-4xl mb-2">📝</div>
            <p className="text-sm font-semibold text-[#2A2035]">No {subjectTab === 'Mathematics' ? 'Maths' : 'English'} level tests yet.</p>
            <p className="text-xs text-[#2A2035]/55 mt-1">Click “New level test” to build your first one.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden divide-y divide-[#F0F4FF]">
            {visibleTests.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-5 md:px-6 py-4">
                <span className="w-10 h-10 rounded-xl bg-[#EEF4FF] text-[#062E63] flex items-center justify-center text-base shrink-0">📝</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#2A2035] truncate">{t.title || 'Untitled level test'}</p>
                  <p className="text-[11px] text-[#2A2035]/50 truncate">
                    {t.year ? `Year ${t.year} · ` : ''}{t.subject || 'Mathematics'}{t.updated_at ? ` · Updated ${fmtDate(t.updated_at)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => router.push(`/tutor/booklets/builder/${t.id}`)}
                    className="text-xs font-semibold bg-[#325099] text-white px-5 py-2 rounded-full hover:bg-[#062E63] transition">
                    Open →
                  </button>
                  <button onClick={() => deleteTest(t.id)}
                    className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition ${deletingId === t.id ? 'bg-[#FEE2E2] text-[#991B1B]' : 'text-[#991B1B]/60 hover:bg-[#FEE2E2]'}`}>
                    {deletingId === t.id ? 'Confirm?' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={() => !creating && setShowNew(false)}>
          <div className="bg-white rounded-2xl border border-[#DEE7FF] shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1">New level test</p>
            <h2 className="text-lg font-bold text-[#062E63] mb-4">Create a level test</h2>

            <label className="block text-[11px] font-semibold text-[#325099] mb-1">Title</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder={`Year ${form.year} ${form.subject} Level Test`}
              className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] mb-4 focus:outline-none focus:border-[#325099]" />

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="block text-[11px] font-semibold text-[#325099] mb-1">Year</label>
                <select value={form.year} onChange={e => setForm(f => ({ ...f, year: Number(e.target.value) }))}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
                  {YEARS.map(y => <option key={y} value={y}>Year {y}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#325099] mb-1">Subject</label>
                <select value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
                  {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNew(false)} disabled={creating}
                className="text-sm font-semibold text-[#2A2035]/60 px-4 py-2 rounded-full hover:bg-[#F0F0F4] transition disabled:opacity-50">Cancel</button>
              <button onClick={createTest} disabled={creating}
                className="text-sm font-semibold text-white bg-[#062E63] hover:bg-[#325099] px-5 py-2 rounded-full transition disabled:opacity-50">
                {creating ? 'Creating…' : 'Create & open builder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

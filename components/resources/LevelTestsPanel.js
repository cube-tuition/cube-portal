'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { T_BOOKLET_BUILDS } from '../../lib/tables'
import { newBlock } from '../../lib/bookletRender'

/*
 * Level Tests list + builder launcher — the body of the old
 * /tutor/resources/level-test page, with no page chrome so it can sit inside
 * the unified "Tests" page (Level Tests tab).
 */

const SUBJECTS = ['Mathematics', 'English', 'Chemistry', 'Science']
const YEARS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

// The booklet builder's canonical subject value is 'Maths' (labelled
// "Mathematics"); store that so its subject dropdown doesn't duplicate.
const SUBJECT_VALUE = { Mathematics: 'Maths' }
const SUBJECT_LABEL = { Maths: 'Mathematics' }

// Subject → short code for the "X.C. Level Test" display name (mirrors the
// booklet builder's SUBJECT_CODE map). Level tests are always titled
// "Level Test"; the card shows it prefixed with year + subject code.
const SUBJECT_CODE = { Maths: 'M', English: 'ET', Chemistry: 'C', Science: 'S' }
const subjectCode = (s) => SUBJECT_CODE[s] || (s || '')[0]?.toUpperCase() || ''
const levelTestDisplayName = (t) => {
  const code = subjectCode(t.subject)
  return (t.year && code) ? `${t.year}.${code}. Level Test` : (t.title || 'Untitled level test')
}

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

export default function LevelTestsPanel({ profile }) {
  const router = useRouter()
  const [tests, setTests] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ title: '', year: 6, subject: 'Mathematics' })
  const [deletingId, setDeletingId] = useState(null)
  const [subjectTab, setSubjectTab] = useState('Mathematics')   // 'Mathematics' | 'English'

  const isMaths = (s) => /math/i.test(s || '')
  const isEnglish = (s) => /english|eald/i.test(s || '')
  const visibleTests = tests.filter(t => subjectTab === 'Mathematics' ? isMaths(t.subject) : isEnglish(t.subject))

  const reload = useCallback(() => {
    supabase
      .from(T_BOOKLET_BUILDS)
      .select('id, title, year, subject, updated_at')
      .eq('doc_type', 'level_test')
      .order('updated_at', { ascending: false })
      .then(({ data }) => { setTests(data || []); setLoading(false) })
  }, [])
  useEffect(() => { reload() }, [reload])

  const createTest = async () => {
    setCreating(true)
    try {
      const title = form.title.trim() || `Year ${form.year} ${form.subject} Level Test`
      const subjectValue = SUBJECT_VALUE[form.subject] || form.subject
      const coverLabel = SUBJECT_LABEL[subjectValue] || subjectValue
      const blocks = [{ ...newBlock('subtopic'), title: 'Section I' }]
      const { data, error } = await supabase
        .from(T_BOOKLET_BUILDS)
        .insert({
          title,
          year: Number(form.year) || null,
          subject: subjectValue,
          topic: 'Level Test',
          doc_type: 'level_test',
          cover: { ...DEFAULT_COVER, title: `${form.year ? `Year ${form.year} ` : ''}${coverLabel}` },
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

  return (
    <div>
      {/* New button */}
      <div className="flex items-center justify-end mb-4">
        <button onClick={() => { setForm(f => ({ ...f, subject: subjectTab })); setShowNew(true) }}
          className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition">
          + New level test
        </button>
      </div>

      {/* Maths / English folders */}
      <div className="flex gap-1 mb-5 border-b border-[#DEE7FF]">
        {[{ id: 'Mathematics', label: 'Maths' }, { id: 'English', label: 'English' }].map(tab => (
          <button
            key={tab.id}
            onClick={() => setSubjectTab(tab.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
              subjectTab === tab.id ? 'border-[#325099] text-[#062E63]' : 'border-transparent text-[#2A2035]/40 hover:text-[#2A2035]/70'
            }`}
          >
            {tab.label} <span className="text-[11px] font-normal text-[#2A2035]/40">
              {tests.filter(t => tab.id === 'Mathematics' ? isMaths(t.subject) : isEnglish(t.subject)).length}
            </span>
          </button>
        ))}
      </div>

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
                <p className="text-sm font-semibold text-[#2A2035] truncate">{levelTestDisplayName(t)}</p>
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

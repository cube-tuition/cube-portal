'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../lib/terms'
import { T_CLASSES, T_PREPOST_TESTS, T_BOOKLET_BUILDS } from '../../lib/tables'

/*
 * Pre-tests overview — a roll-up of every group class's pre/post test for a
 * term (topics + expected scores, edited on the class page) plus a per-class
 * pre-test PAPER builder (a booklet_builds doc of type 'pre_test', opened in
 * the shared booklet builder with the exam-style cover).
 */

const DEFAULT_COVER = {
  subtitle: 'Pre-Test',
  instructions: [
    'Working time – 60 minutes',
    'Write using black pen',
    'Calculators are **not** allowed',
    'For questions show relevant mathematical reasoning and/or calculations',
  ],
  totals: ['60 marks', 'Attempt all questions', 'Allow about 1 minute per mark'],
}

// Canonical subject values the booklet builder uses (value → friendly label).
const SUBJECT_LABEL = { Maths: 'Mathematics', English: 'English', Chemistry: 'Chemistry' }
function detectSubject(name) {
  if (/chem/i.test(name)) return 'Chemistry'
  if (/eng|eald/i.test(name)) return 'English'
  return 'Maths'
}
function detectYear(name) {
  const m = (name || '').match(/Y(?:ear)?\s*(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

export default function PreTestsPanel({ profile }) {
  const router = useRouter()
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState('')
  const [classes, setClasses] = useState([])
  const [testsByClass, setTestsByClass] = useState({})
  const [buildsByClass, setBuildsByClass] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyClass, setBusyClass] = useState(null)

  useEffect(() => {
    fetchAllTerms().then((all) => {
      setTerms(all)
      const cur = getCurrentTerm(all)
      setTermId(cur?.id || all[0]?.id || '')
    })
  }, [])

  const reload = useCallback((tid) => {
    if (!tid) return
    Promise.all([
      supabase.from(T_CLASSES).select('id, class_name, teacher, courses(delivery_mode)').eq('term_id', tid),
      supabase.from(T_PREPOST_TESTS).select('class_id, topics, expected_pre, expected_post').eq('term_id', tid),
      supabase.from(T_BOOKLET_BUILDS).select('id, class_id, updated_at').eq('doc_type', 'pre_test').eq('term_id', tid),
    ]).then(([{ data: cls }, { data: tests }, { data: builds }]) => {
      const groupClasses = (cls || []).filter(c => (c.courses?.delivery_mode || '') !== '1:1' && !/1:1/.test(c.class_name || ''))
      setClasses(groupClasses.sort((a, b) => (a.class_name || '').localeCompare(b.class_name || '', undefined, { numeric: true })))
      const tMap = {}; for (const t of tests || []) tMap[t.class_id] = t
      setTestsByClass(tMap)
      const bMap = {}; for (const b of builds || []) bMap[b.class_id] = b
      setBuildsByClass(bMap)
      setLoading(false)
    })
  }, [])

  useEffect(() => { reload(termId) }, [termId, reload])

  // Open the class's pre-test paper in the builder, creating it if needed.
  const openBuilder = async (cls) => {
    const existing = buildsByClass[cls.id]
    if (existing) { router.push(`/tutor/booklets/builder/${existing.id}`); return }
    setBusyClass(cls.id)
    const subject = detectSubject(cls.class_name)
    const year = detectYear(cls.class_name)
    const label = SUBJECT_LABEL[subject] || subject
    // Auto name: "{YY}T{term} Pre-test" → renders as e.g. "5.M. 26T2 Pre-test".
    const term = terms.find(t => t.id === termId)
    const yy = term?.year != null ? String(term.year).slice(-2) : ''
    const title = (yy && term?.term_number != null)
      ? `${yy}T${term.term_number} Pre-test`
      : `${cls.class_name || 'Class'} — Pre-Test`
    const { data, error } = await supabase.from(T_BOOKLET_BUILDS).insert({
      title,
      year,
      subject,
      topic: 'Pre-Test',
      doc_type: 'pre_test',
      cover: { ...DEFAULT_COVER, title: `${year ? `Year ${year} ` : ''}${label}` },
      blocks: [],
      class_id: cls.id,
      term_id: termId,
      created_by: profile?.id ?? null,
    }).select('id').single()
    if (error) { alert('Could not create the pre-test: ' + (error.message || error)); setBusyClass(null); return }
    router.push(`/tutor/booklets/builder/${data.id}`)
  }

  const rows = useMemo(() => classes.map((c) => {
    const t = testsByClass[c.id]
    const topics = Array.isArray(t?.topics) ? t.topics : []
    const totalMarks = topics.reduce((s, x) => s + (Number(x.marks) || 0), 0)
    return {
      ...c,
      hasTest: topics.length > 0,
      topics,
      totalMarks,
      expected_pre: t?.expected_pre ?? null,
      expected_post: t?.expected_post ?? null,
      hasPaper: !!buildsByClass[c.id],
    }
  }), [classes, testsByClass, buildsByClass])

  const setUp = rows.filter((r) => r.hasTest).length
  const withPaper = rows.filter((r) => r.hasPaper).length

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <p className="text-sm text-[#2A2035]/60">
          {loading ? 'Loading…' : `${setUp}/${rows.length} topics set up · ${withPaper}/${rows.length} papers built`}
        </p>
        <select
          value={termId}
          onChange={(e) => setTermId(e.target.value)}
          className="border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm font-semibold text-[#062E63] bg-white focus:outline-none focus:border-[#325099]"
        >
          {terms.map((t) => <option key={t.id} value={t.id}>{formatTermLabel(t)}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-center text-sm text-[#2A2035]/40 py-12 animate-pulse">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
          <p className="text-sm text-[#2A2035]/50">No classes in this term.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="bg-[#F8FAFF] text-left text-[10px] uppercase tracking-wider text-[#325099]/60">
                <th className="px-4 py-3 font-semibold">Class</th>
                <th className="px-4 py-3 font-semibold">Topics</th>
                <th className="px-4 py-3 font-semibold text-center">Pre</th>
                <th className="px-4 py-3 font-semibold text-center">Post</th>
                <th className="px-4 py-3 font-semibold text-center">Topics</th>
                <th className="px-4 py-3 font-semibold text-right">Pre-test paper</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F4FF]">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-[#FAFBFF]">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#062E63]">{r.class_name || `Class #${r.id}`}</div>
                    {r.teacher && <div className="text-[11px] text-[#2A2035]/40">{r.teacher}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#2A2035]/80">
                    {r.hasTest ? (
                      <span title={r.topics.map((x) => x.name).filter(Boolean).join(', ')}>
                        {r.topics.length} topic{r.topics.length === 1 ? '' : 's'}{r.totalMarks > 0 ? ` · ${r.totalMarks} marks` : ''}
                      </span>
                    ) : <Link href={`/tutor/classes/${r.id}`} className="text-[#325099] hover:underline">Set up →</Link>}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {r.expected_pre != null ? <span className="font-semibold text-[#EF4444]">{r.expected_pre}{r.totalMarks > 0 ? `/${r.totalMarks}` : ''}</span> : <span className="text-[#2A2035]/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {r.expected_post != null ? <span className="font-semibold text-[#16A34A]">{r.expected_post}{r.totalMarks > 0 ? `/${r.totalMarks}` : ''}</span> : <span className="text-[#2A2035]/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.hasTest ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                      {r.hasTest ? 'Set up' : 'Not set up'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openBuilder(r)}
                      disabled={busyClass === r.id}
                      className={`text-xs font-semibold px-4 py-1.5 rounded-full transition disabled:opacity-50 ${
                        r.hasPaper
                          ? 'bg-[#325099] text-white hover:bg-[#062E63]'
                          : 'border border-[#DEE7FF] text-[#062E63] hover:border-[#325099]'
                      }`}
                    >
                      {busyClass === r.id ? 'Creating…' : r.hasPaper ? 'Open builder →' : '+ Build pre-test'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

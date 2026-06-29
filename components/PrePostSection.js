'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts'
import { T_PREPOST_SCORES, T_PREPOST_TESTS } from '../lib/tables'

/*
 * PrePostSection — Pre/Post test management for a class+term.
 *
 * Props:
 *   classId  — integer
 *   termId   — uuid
 *   roster   — [{id, full_name, ...}]
 *   canEdit  — boolean (admin or assigned tutor)
 *
 * Features:
 *   1. Topic setup panel — define test topics and mark allocations (canEdit only)
 *   2. Score entry table — toggle Pre / Post, enter per-student per-topic scores
 *   3. Per-student analytics — 4 charts (expand per student)
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pct(score, max) {
  if (!max || score == null || score === '') return null
  return Math.round((Number(score) / max) * 100)
}
function safePct(score, max) {
  const p = pct(score, max)
  return p == null ? 0 : p
}
// Short display name (first name only)
function firstName(fullName) {
  return (fullName || '—').split(' ')[0]
}

// ─── Colour tokens ────────────────────────────────────────────────────────────
const PRE_COLOR  = '#EF4444'   // red
const POST_COLOR = '#325099'   // blue
const AVG_COLOR  = '#F59E0B'   // amber
const EXP_COLOR  = '#9CA3AF'   // grey — expected/target mark
const SCORE_GREEN = '#10B981'  // green — student's own total score (vs-average chart)

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#DEE7FF] rounded-xl shadow px-3 py-2 text-xs">
      <p className="font-semibold text-[#062E63] mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{p.value}{p.unit || ''}</strong>
        </p>
      ))}
    </div>
  )
}

// Fixed-order legend — recharts' default (and even an explicit `payload`) can
// reorder Pre/Post; rendering the items ourselves guarantees the order we pass.
function FixedLegend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 20, justifyContent: 'center', fontSize: 11, paddingTop: 6 }}>
      {items.map(it => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: it.color, fontWeight: 600 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: it.color, display: 'inline-block' }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PrePostSection({ classId, termId, roster, canEdit }) {
  const [test, setTest]         = useState(null)     // prepost_tests row (or null)
  const [scoresMap, setScoresMap] = useState({})     // { [studentId]: { pre: [...], post: [...] } }
  const [loading, setLoading]   = useState(true)
  const [scoreMode, setScoreMode] = useState('pre')  // 'pre' | 'post'
  const [expandedStudent, setExpandedStudent] = useState(null)

  // ── Setup editor state ───────────────────────────────────────────────────
  const [editingSetup, setEditingSetup]   = useState(false)
  const [topicDrafts, setTopicDrafts]     = useState([])  // [{name, marks}]
  const [expectedDraft, setExpectedDraft] = useState({ pre: '', post: '' })  // expected total marks
  const [savingSetup, setSavingSetup]     = useState(false)

  // ── Score saving ─────────────────────────────────────────────────────────
  const [savingScores, setSavingScores]   = useState(false)
  const [savedMsg, setSavedMsg]           = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!classId || !termId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)

      // Fetch test config
      const { data: testRow } = await supabase
        .from(T_PREPOST_TESTS)
        .select('id, topics, expected_pre, expected_post, updated_at')
        .eq('class_id', classId)
        .eq('term_id', termId)
        .maybeSingle()
      if (cancelled) return
      setTest(testRow || null)

      // Fetch scores if a test exists
      if (testRow) {
        const { data: scoreRows } = await supabase
          .from(T_PREPOST_SCORES)
          .select('student_id, test_type, scores')
          .eq('test_id', testRow.id)
        if (cancelled) return
        const map = {}
        for (const r of scoreRows || []) {
          if (!map[r.student_id]) map[r.student_id] = { pre: [], post: [] }
          map[r.student_id][r.test_type] = r.scores || []
        }
        setScoresMap(map)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [classId, termId])

  // ── Topic helpers ─────────────────────────────────────────────────────────
  const topics = test?.topics || []
  const totalMarks = topics.reduce((s, t) => s + (Number(t.marks) || 0), 0)

  const startEditSetup = () => {
    setTopicDrafts(topics.length > 0 ? topics.map(t => ({ ...t })) : [{ name: '', marks: '' }])
    setExpectedDraft({
      pre:  test?.expected_pre  != null ? String(test.expected_pre)  : '',
      post: test?.expected_post != null ? String(test.expected_post) : '',
    })
    setEditingSetup(true)
  }

  const handleTopicChange = (idx, field, val) => {
    setTopicDrafts(prev => prev.map((t, i) => i === idx ? { ...t, [field]: val } : t))
  }
  const handleAddTopic    = () => setTopicDrafts(prev => [...prev, { name: '', marks: '' }])
  const handleRemoveTopic = (idx) => setTopicDrafts(prev => prev.filter((_, i) => i !== idx))

  const handleSaveSetup = async () => {
    const cleaned = topicDrafts
      .filter(t => t.name.trim())
      .map(t => ({ name: t.name.trim(), marks: Number(t.marks) || 0, ...(t.questions?.trim() ? { questions: t.questions.trim() } : {}) }))
    if (cleaned.length === 0) return
    const expPre  = expectedDraft.pre  === '' ? null : Number(expectedDraft.pre)
    const expPost = expectedDraft.post === '' ? null : Number(expectedDraft.post)
    setSavingSetup(true)
    if (test) {
      await supabase.from(T_PREPOST_TESTS)
        .update({ topics: cleaned, expected_pre: expPre, expected_post: expPost, updated_at: new Date().toISOString() })
        .eq('id', test.id)
      setTest(prev => ({ ...prev, topics: cleaned, expected_pre: expPre, expected_post: expPost }))
    } else {
      const { data } = await supabase.from(T_PREPOST_TESTS)
        .insert({ class_id: classId, term_id: termId, topics: cleaned, expected_pre: expPre, expected_post: expPost })
        .select().single()
      setTest(data)
    }
    setSavingSetup(false)
    setEditingSetup(false)
  }

  // ── Score helpers ─────────────────────────────────────────────────────────
  const getScore = (studentId, mode, topicIdx) => {
    return scoresMap[studentId]?.[mode]?.[topicIdx] ?? ''
  }
  const setScore = (studentId, mode, topicIdx, val) => {
    setScoresMap(prev => {
      const sMap = { ...(prev[studentId] || { pre: [], post: [] }) }
      const arr = [...(sMap[mode] || [])]
      arr[topicIdx] = val === '' ? null : Number(val)
      sMap[mode] = arr
      return { ...prev, [studentId]: sMap }
    })
  }
  const studentTotal = (studentId, mode) => {
    const scores = scoresMap[studentId]?.[mode] || []
    const filled = scores.filter(s => s != null && s !== '')
    if (filled.length === 0) return null
    return filled.reduce((a, b) => a + Number(b), 0)
  }

  const handleSaveScores = async () => {
    if (!test) return
    setSavingScores(true)
    for (const student of roster) {
      for (const mode of ['pre', 'post']) {
        const scores = scoresMap[student.id]?.[mode] || []
        const hasAny = scores.some(s => s != null && s !== '')
        if (!hasAny) continue
        const { data: existing } = await supabase
          .from(T_PREPOST_SCORES)
          .select('id')
          .eq('test_id', test.id)
          .eq('student_id', student.id)
          .eq('test_type', mode)
          .maybeSingle()
        const payload = {
          test_id: test.id,
          student_id: student.id,
          test_type: mode,
          scores,
          updated_at: new Date().toISOString(),
        }
        if (existing) {
          await supabase.from(T_PREPOST_SCORES).update(payload).eq('id', existing.id)
        } else {
          await supabase.from(T_PREPOST_SCORES).insert(payload)
        }
      }
    }
    setSavingScores(false)
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 3000)
  }

  // ── Class averages (for charts) ───────────────────────────────────────────
  const classAvg = useMemo(() => {
    if (topics.length === 0 || roster.length === 0) return { pre: null, post: null, byTopic: { pre: [], post: [] } }
    // Privacy: with ≤2 students a "class average" reveals the only other child's
    // score, so suppress it entirely (matches the exam analysis convention).
    if (roster.length <= 2) return { pre: null, post: null, byTopic: { pre: topics.map(() => null), post: topics.map(() => null) } }
    const avg = (mode) => {
      const totals = roster.map(s => studentTotal(s.id, mode)).filter(v => v != null)
      return totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null
    }
    const topicAvg = (mode, idx) => {
      const vals = roster.map(s => {
        const v = scoresMap[s.id]?.[mode]?.[idx]
        return v != null && v !== '' ? Number(v) : null
      }).filter(v => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    return {
      pre:  avg('pre'),
      post: avg('post'),
      byTopic: {
        pre:  topics.map((_, i) => topicAvg('pre',  i)),
        post: topics.map((_, i) => topicAvg('post', i)),
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoresMap, topics, roster])

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="text-center py-10">
      <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#325099]">Loading pre/post test…</p>
    </div>
  )

  return (
    <div className="space-y-8">

      {/* ── 1. TOPIC SETUP ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
        <div className="px-5 md:px-6 py-4 border-b border-[#DEE7FF] flex items-center justify-between gap-3 bg-[#F8FAFF]">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">
              Test Structure
            </p>
            <h3 className="text-base font-bold text-[#062E63] font-display mt-0.5">
              Topics &amp; Mark Allocations
              {totalMarks > 0 && (
                <span className="ml-2 text-sm font-normal text-[#2A2035]/50">
                  Total: {totalMarks} marks
                </span>
              )}
            </h3>
            {(test?.expected_pre != null || test?.expected_post != null) && (
              <p className="text-xs text-[#2A2035]/55 mt-1">
                Expected mark:
                {test?.expected_pre != null && <span className="ml-1"><span className="font-semibold text-[#EF4444]">Pre</span> {test.expected_pre}{totalMarks > 0 ? `/${totalMarks}` : ''}</span>}
                {test?.expected_pre != null && test?.expected_post != null && <span className="text-[#2A2035]/30"> · </span>}
                {test?.expected_post != null && <span><span className="font-semibold text-[#325099]">Post</span> {test.expected_post}{totalMarks > 0 ? `/${totalMarks}` : ''}</span>}
              </p>
            )}
          </div>
          {canEdit && !editingSetup && (
            <button onClick={startEditSetup}
              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white px-4 py-2 rounded-full hover:bg-[#F8FAFF] hover:border-[#325099] transition">
              {topics.length > 0 ? '✎ Edit topics' : '+ Set up topics'}
            </button>
          )}
        </div>

        {editingSetup ? (
          <div className="px-5 md:px-6 py-5 space-y-4">
            {/* Column labels */}
            <div className="hidden md:flex items-center gap-3 mb-1 px-1">
              <span className="w-6 shrink-0" />
              <span className="flex-1 text-[9px] tracking-[0.2em] uppercase font-semibold text-[#325099]/50">Topic name</span>
              <span className="w-28 text-[9px] tracking-[0.2em] uppercase font-semibold text-[#325099]/50 text-center">Questions</span>
              <span className="w-20 text-[9px] tracking-[0.2em] uppercase font-semibold text-[#325099]/50 text-center">Marks</span>
              <span className="w-7 shrink-0" />
            </div>
            <div className="space-y-2">
              {topicDrafts.map((t, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-[#325099]/50 w-6 text-right shrink-0">{i + 1}.</span>
                  <input
                    type="text"
                    value={t.name}
                    onChange={e => handleTopicChange(i, 'name', e.target.value)}
                    placeholder="Topic name (e.g. Negative Numbers)"
                    className="flex-1 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="text"
                      value={t.questions || ''}
                      onChange={e => handleTopicChange(i, 'questions', e.target.value)}
                      placeholder="e.g. Q1–2"
                      title="Which question numbers belong to this topic"
                      className="w-28 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-center text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition"
                    />
                    <input
                      type="number"
                      min={1}
                      value={t.marks}
                      onChange={e => handleTopicChange(i, 'marks', e.target.value)}
                      placeholder="Marks"
                      className="w-20 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-center text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition"
                    />
                    <span className="text-xs text-[#2A2035]/40">marks</span>
                    <button onClick={() => handleRemoveTopic(i)}
                      className="text-[#991B1B]/50 hover:text-[#991B1B] hover:bg-[#FEE2E2] w-7 h-7 rounded-full flex items-center justify-center transition text-sm">
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={handleAddTopic}
              className="text-xs font-semibold text-[#325099] hover:text-[#062E63] flex items-center gap-1.5 transition">
              <span className="w-5 h-5 rounded-full bg-[#DEE7FF] flex items-center justify-center text-[13px] font-bold leading-none">+</span>
              Add topic
            </button>

            {/* Expected overall marks — a manual target for the test as a whole */}
            <div className="border-t border-[#DEE7FF] pt-4">
              <p className="text-[9px] tracking-[0.2em] uppercase font-semibold text-[#325099]/50 mb-2">Expected mark (whole test)</p>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-[#2A2035]">
                  <span className="font-semibold text-[#EF4444] w-16">Pre test</span>
                  <input type="number" min={0} value={expectedDraft.pre}
                    onChange={e => setExpectedDraft(d => ({ ...d, pre: e.target.value }))}
                    placeholder="e.g. 20"
                    className="w-24 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-center tabular-nums placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition" />
                  {totalMarks > 0 && <span className="text-xs text-[#2A2035]/40">/ {totalMarks}</span>}
                </label>
                <label className="flex items-center gap-2 text-sm text-[#2A2035]">
                  <span className="font-semibold text-[#325099] w-16">Post test</span>
                  <input type="number" min={0} value={expectedDraft.post}
                    onChange={e => setExpectedDraft(d => ({ ...d, post: e.target.value }))}
                    placeholder="e.g. 35"
                    className="w-24 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-center tabular-nums placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition" />
                  {totalMarks > 0 && <span className="text-xs text-[#2A2035]/40">/ {totalMarks}</span>}
                </label>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={handleSaveSetup} disabled={savingSetup || topicDrafts.filter(t => t.name.trim()).length === 0}
                className="text-xs font-semibold bg-[#325099] text-white px-5 py-2 rounded-full hover:bg-[#062E63] transition disabled:opacity-50">
                {savingSetup ? 'Saving…' : 'Save topics'}
              </button>
              <button onClick={() => setEditingSetup(false)}
                className="text-xs font-semibold text-[#2A2035]/50 px-4 py-2 rounded-full hover:bg-[#F8FAFF] transition">
                Cancel
              </button>
            </div>
          </div>
        ) : topics.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <div className="text-3xl mb-2">📝</div>
            <p className="text-sm font-semibold text-[#2A2035] mb-1">No topics set up yet.</p>
            <p className="text-xs text-[#2A2035]/50">
              {canEdit ? 'Click "Set up topics" to define the test structure.' : 'Your teacher will set up the topics for this test.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#DEE7FF]">
                  <th className="text-left pl-5 py-2.5 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] w-8">#</th>
                  <th className="text-left px-3 py-2.5 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099]">Topic</th>
                  <th className="text-center px-3 py-2.5 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] w-32">Questions</th>
                  <th className="text-center px-3 py-2.5 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] w-24">Marks</th>
                  <th className="text-center px-5 py-2.5 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] w-20">% of total</th>
                </tr>
              </thead>
              <tbody>
                {topics.map((t, i) => (
                  <tr key={i} className="border-b last:border-0 border-[#DEE7FF]">
                    <td className="pl-5 py-2.5 text-xs text-[#325099]/50 font-semibold">{i + 1}</td>
                    <td className="px-3 py-2.5 font-medium text-[#2A2035]">{t.name}</td>
                    <td className="px-3 py-2.5 text-center">
                      {t.questions ? (
                        <span className="inline-block text-xs font-semibold text-[#325099] bg-[#EEF4FF] px-2.5 py-0.5 rounded-full">
                          {t.questions}
                        </span>
                      ) : (
                        <span className="text-[#2A2035]/25 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold text-[#2A2035] tabular-nums">{t.marks}</td>
                    <td className="px-5 py-2.5 text-center text-xs text-[#2A2035]/50 tabular-nums">
                      {totalMarks > 0 ? `${Math.round((t.marks / totalMarks) * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#F8FAFF]">
                  <td className="pl-5 py-2.5" />
                  <td className="px-3 py-2.5 text-xs font-bold text-[#062E63] uppercase tracking-wide">Total</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-center font-bold text-[#062E63] tabular-nums">{totalMarks}</td>
                  <td className="px-5 py-2.5 text-center text-xs font-semibold text-[#062E63]">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 2. SCORE ENTRY ─────────────────────────────────────────────────── */}
      {topics.length > 0 && roster.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
          <div className="px-5 md:px-6 py-4 border-b border-[#DEE7FF] flex items-center justify-between gap-3 bg-[#F8FAFF]">
            <div>
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">Scores</p>
              <h3 className="text-base font-bold text-[#062E63] font-display mt-0.5">Mark Entry</h3>
            </div>
            <div className="flex items-center gap-1">
              {['pre', 'post'].map(mode => (
                <button key={mode} onClick={() => setScoreMode(mode)}
                  className={`text-xs font-semibold px-4 py-1.5 rounded-full transition ${
                    scoreMode === mode
                      ? mode === 'pre' ? 'bg-[#EF4444] text-white' : 'bg-[#325099] text-white'
                      : 'bg-white border border-[#DEE7FF] text-[#2A2035]/60 hover:bg-[#F8FAFF]'
                  }`}>
                  {mode === 'pre' ? 'Pre-test' : 'Post-test'}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                  <th className="text-left pl-5 pr-3 py-3 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] sticky left-0 bg-[#F8FAFF] z-10 min-w-[160px]">
                    Student
                  </th>
                  {topics.map((t, i) => (
                    <th key={i} className="text-center px-2 py-3 text-[10px] font-semibold text-[#325099] min-w-[90px]">
                      <span className="block tracking-[0.15em] uppercase">{t.name}</span>
                      <span className="text-[9px] text-[#2A2035]/40 font-normal">(/{t.marks})</span>
                      {t.questions && (
                        <span className="block text-[9px] text-[#325099]/60 font-semibold mt-0.5">{t.questions}</span>
                      )}
                    </th>
                  ))}
                  <th className="text-center px-4 py-3 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] min-w-[80px]">
                    Total <span className="text-[9px] text-[#2A2035]/40 font-normal">(/{totalMarks})</span>
                  </th>
                  <th className="text-center px-4 py-3 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] min-w-[70px]">%</th>
                </tr>
              </thead>
              <tbody>
                {roster.map(student => {
                  const total = studentTotal(student.id, scoreMode)
                  const percentage = total != null ? pct(total, totalMarks) : null
                  return (
                    <tr key={student.id} className="border-b last:border-0 border-[#DEE7FF] hover:bg-[#FAFBFF] transition-colors">
                      <td className="pl-5 pr-3 py-3 font-semibold text-[#2A2035] sticky left-0 bg-white hover:bg-[#FAFBFF] z-10">
                        {student.full_name}
                      </td>
                      {topics.map((t, i) => (
                        <td key={i} className="px-2 py-3 text-center">
                          {canEdit ? (
                            <input
                              type="number"
                              min={0}
                              max={t.marks}
                              value={getScore(student.id, scoreMode, i) ?? ''}
                              onChange={e => setScore(student.id, scoreMode, i, e.target.value)}
                              placeholder="—"
                              className="w-16 text-center text-sm font-semibold rounded-lg border border-[#DEE7FF] px-2 py-1 bg-[#F8FAFF] focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition tabular-nums"
                            />
                          ) : (
                            <span className="text-sm font-semibold text-[#2A2035] tabular-nums">
                              {getScore(student.id, scoreMode, i) ?? '—'}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center font-bold text-[#2A2035] tabular-nums">
                        {total ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {percentage != null ? (
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                            percentage >= 80 ? 'bg-[#D1FAE5] text-[#065F46]'
                            : percentage >= 60 ? 'bg-[#DEE7FF] text-[#062E63]'
                            : percentage >= 40 ? 'bg-[#FEF3C7] text-[#92400E]'
                            : 'bg-[#FEE2E2] text-[#991B1B]'
                          }`}>
                            {percentage}%
                          </span>
                        ) : <span className="text-[#2A2035]/30 text-xs">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <div className="px-5 md:px-6 py-4 border-t border-[#DEE7FF] flex items-center justify-between gap-3">
              {savedMsg ? (
                <span className="text-xs font-semibold text-[#065F46]">✓ Scores saved.</span>
              ) : (
                <span className="text-xs text-[#2A2035]/50">
                  Scores save for both pre and post tests — switch the toggle above to enter the other.
                </span>
              )}
              <button onClick={handleSaveScores} disabled={savingScores}
                className="text-xs font-semibold bg-[#325099] text-white px-5 py-2 rounded-full hover:bg-[#062E63] transition disabled:opacity-60">
                {savingScores ? 'Saving…' : 'Save scores'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 3. PER-STUDENT ANALYTICS ────────────────────────────────────────── */}
      {topics.length > 0 && roster.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">Analytics</p>
              <h3 className="text-lg font-bold text-[#062E63] font-display mt-0.5">Per-Student Charts</h3>
            </div>
            <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/50">
              {roster.length} student{roster.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="space-y-4">
            {roster.map(student => (
              <StudentCharts
                key={student.id}
                student={student}
                topics={topics}
                totalMarks={totalMarks}
                scoresMap={scoresMap}
                classAvg={classAvg}
                expectedPre={test?.expected_pre ?? null}
                expectedPost={test?.expected_post ?? null}
                expanded={expandedStudent === student.id}
                onToggle={() => setExpandedStudent(prev => prev === student.id ? null : student.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Per-student chart card ────────────────────────────────────────────────────
function StudentCharts({ student, topics, totalMarks, scoresMap, classAvg, expectedPre = null, expectedPost = null, expanded, onToggle }) {
  const preScores  = scoresMap[student.id]?.pre  || []
  const postScores = scoresMap[student.id]?.post || []

  const preTotal  = preScores.filter(s => s != null).reduce((a, b) => a + Number(b), 0)
  const postTotal = postScores.filter(s => s != null).reduce((a, b) => a + Number(b), 0)
  const hasPreData  = preScores.some(s => s != null && s !== '')
  const hasPostData = postScores.some(s => s != null && s !== '')

  const hasAnyData = hasPreData || hasPostData
  const prePct  = hasPreData  ? safePct(preTotal,  totalMarks) : null
  const postPct = hasPostData ? safePct(postTotal, totalMarks) : null
  const improvement = prePct != null && postPct != null ? postPct - prePct : null

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      {/* Student header / toggle */}
      <button type="button" onClick={onToggle}
        className="w-full px-5 md:px-6 py-4 flex items-center justify-between gap-4 hover:bg-[#FAFBFF] transition group text-left">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#062E63] text-white text-sm font-bold flex items-center justify-center shrink-0">
            {firstName(student.full_name).slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-[#2A2035]">{student.full_name}</p>
            {hasAnyData ? (
              <div className="flex items-center gap-3 mt-0.5">
                {prePct  != null && <span className="text-[11px] text-[#EF4444] font-semibold">Pre: {prePct}%</span>}
                {postPct != null && <span className="text-[11px] text-[#325099] font-semibold">Post: {postPct}%</span>}
                {improvement != null && (
                  <span className={`text-[11px] font-bold ${improvement >= 0 ? 'text-[#065F46]' : 'text-[#991B1B]'}`}>
                    {improvement >= 0 ? '▲' : '▼'} {Math.abs(improvement)}pp
                  </span>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-[#2A2035]/40 mt-0.5">No scores entered yet</p>
            )}
          </div>
        </div>
        <span className={`text-[#325099] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {/* Charts */}
      {expanded && (
        <div className="border-t border-[#DEE7FF] px-4 md:px-6 py-6">
          {!hasAnyData ? (
            <p className="text-center text-sm text-[#2A2035]/40 py-6">No scores entered for this student yet.</p>
          ) : (
            <PrePostCharts student={student} topics={topics} totalMarks={totalMarks}
              scoresMap={scoresMap} classAvg={classAvg} expectedPre={expectedPre} expectedPost={expectedPost} />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Shared 3-chart block (class Pre/Post tab + term report) ────────────────────
// Renders one student's pre/post results: raw by topic, % by topic, and totals
// vs class average (with optional Expected target). Computes its own chart data
// from the shared inputs so it can be dropped into the report individualised.
export function PrePostCharts({ student, topics = [], totalMarks = 0, scoresMap = {}, classAvg = { pre: null, post: null, byTopic: { pre: [], post: [] } }, expectedPre = null, expectedPost = null }) {
  const preScores  = scoresMap[student.id]?.pre  || []
  const postScores = scoresMap[student.id]?.post || []
  const preTotal  = preScores.filter(s => s != null).reduce((a, b) => a + Number(b), 0)
  const postTotal = postScores.filter(s => s != null).reduce((a, b) => a + Number(b), 0)
  const hasPreData  = preScores.some(s => s != null && s !== '')
  const hasPostData = postScores.some(s => s != null && s !== '')
  if (!hasPreData && !hasPostData) {
    return <p className="text-center text-sm text-[#2A2035]/40 py-6">No pre/post scores entered for this student yet.</p>
  }
  const fn = firstName(student.full_name)
  const topicChartData = topics.map((t, i) => ({
    name: t.name.length > 12 ? t.name.slice(0, 12) + '…' : t.name,
    fullName: t.name,
    maxMarks: t.marks,
    'Pre test':  hasPreData  && preScores[i]  != null ? Number(preScores[i])  : 0,
    'Post test': hasPostData && postScores[i] != null ? Number(postScores[i]) : 0,
    'Pre %':  hasPreData  && preScores[i]  != null ? safePct(preScores[i],  t.marks) : 0,
    'Post %': hasPostData && postScores[i] != null ? safePct(postScores[i], t.marks) : 0,
  }))
  const expPrePct  = expectedPre  != null && totalMarks > 0 ? Math.round((Number(expectedPre)  / totalMarks) * 100) : null
  const expPostPct = expectedPost != null && totalMarks > 0 ? Math.round((Number(expectedPost) / totalMarks) * 100) : null
  const hasExpected = expPrePct != null || expPostPct != null
  // Class average is suppressed for small cohorts (≤2 students) — in that case
  // classAvg.pre/post are null and we drop the bar, legend and title entirely.
  const hasClassAvg = classAvg && (classAvg.pre != null || classAvg.post != null)
  const totalChartData = [
    { name: 'Pre test',  'Score': hasPreData  ? safePct(preTotal,  totalMarks) : 0, 'Class avg': hasClassAvg && classAvg.pre  != null ? safePct(classAvg.pre,  totalMarks) : null, 'Expected': expPrePct },
    { name: 'Post test', 'Score': hasPostData ? safePct(postTotal, totalMarks) : 0, 'Class avg': hasClassAvg && classAvg.post != null ? safePct(classAvg.post, totalMarks) : null, 'Expected': expPostPct },
  ]
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Raw marks by topic */}
      <div>
        <p className="text-xs font-semibold text-[#062E63] mb-3 font-display">{fn}: Pre/Post test by topic (Raw mark)</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={topicChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF4FF" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#325099' }} />
            <YAxis tick={{ fontSize: 10, fill: '#325099' }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend content={<FixedLegend items={[
              ...(hasPreData  ? [{ label: 'Pre test',  color: PRE_COLOR }]  : []),
              ...(hasPostData ? [{ label: 'Post test', color: POST_COLOR }] : []),
            ]} />} />
            {hasPreData  && <Bar dataKey="Pre test"  fill={PRE_COLOR}  radius={[3,3,0,0]} />}
            {hasPostData && <Bar dataKey="Post test" fill={POST_COLOR} radius={[3,3,0,0]} />}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* % by topic */}
      <div>
        <p className="text-xs font-semibold text-[#062E63] mb-3 font-display">{fn}: Pre/Post test by topic (%)</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={topicChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF4FF" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#325099' }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#325099' }} unit="%" />
            <Tooltip content={<ChartTooltip />} />
            <Legend content={<FixedLegend items={[
              ...(hasPreData  ? [{ label: 'Pre test %',  color: PRE_COLOR }]  : []),
              ...(hasPostData ? [{ label: 'Post test %', color: POST_COLOR }] : []),
            ]} />} />
            {hasPreData  && <Bar dataKey="Pre %"  fill={PRE_COLOR}  name="Pre test %" radius={[3,3,0,0]} unit="%" />}
            {hasPostData && <Bar dataKey="Post %" fill={POST_COLOR} name="Post test %" radius={[3,3,0,0]} unit="%" />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      </div>

      {/* Totals vs class average — centred on its own row.
          Class average is hidden for small cohorts (≤2 students). */}
      <div className="md:max-w-[calc(50%_-_12px)] md:mx-auto">
        <p className="text-xs font-semibold text-[#062E63] mb-3 font-display">
          {fn}: Pre/Post test {hasClassAvg ? 'vs Class Average ' : ''}(Total)
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={totalChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF4FF" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#325099' }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#325099' }} unit="%" />
            <Tooltip content={<ChartTooltip />} />
            <Legend content={<FixedLegend items={[
              { label: `${fn}'s score`, color: SCORE_GREEN },
              ...(hasClassAvg ? [{ label: 'Class average', color: AVG_COLOR }] : []),
              ...(hasExpected ? [{ label: 'Expected', color: EXP_COLOR }] : []),
            ]} />} />
            <Bar dataKey="Score"     fill={SCORE_GREEN} name={`${fn}'s score`} radius={[3,3,0,0]} unit="%" />
            {hasClassAvg && <Bar dataKey="Class avg" fill={AVG_COLOR}  name="Class average" radius={[3,3,0,0]} unit="%" />}
            {hasExpected && <Bar dataKey="Expected" fill={EXP_COLOR} name="Expected" radius={[3,3,0,0]} unit="%" />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}


// Load a class+term's pre/post test, scores and class averages for the report.
// Returns null if no test is configured, else { topics, totalMarks, scoresMap,
// classAvg, expectedPre, expectedPost } ready for <PrePostCharts/>.
export async function loadPrePostForReport(classId, termId, roster = []) {
  const { data: testRow } = await supabase
    .from(T_PREPOST_TESTS)
    .select('id, topics, expected_pre, expected_post')
    .eq('class_id', classId).eq('term_id', termId)
    .maybeSingle()
  if (!testRow) return null
  const { data: scoreRows } = await supabase
    .from(T_PREPOST_SCORES)
    .select('student_id, test_type, scores')
    .eq('test_id', testRow.id)
  const scoresMap = {}
  for (const r of scoreRows || []) {
    if (!scoresMap[r.student_id]) scoresMap[r.student_id] = { pre: [], post: [] }
    scoresMap[r.student_id][r.test_type] = r.scores || []
  }
  const topics = testRow.topics || []
  const totalMarks = topics.reduce((s, t) => s + (Number(t.marks) || 0), 0)
  // Privacy: with ≤2 students a class average reveals the only other child's
  // score, so don't compute/show it (matches the exam analysis convention).
  if (roster.length <= 2) {
    return {
      topics, totalMarks, scores: scoresMap,
      classAvg: { pre: null, post: null, byTopic: { pre: topics.map(() => null), post: topics.map(() => null) } },
      expectedPre: testRow.expected_pre ?? null, expectedPost: testRow.expected_post ?? null,
    }
  }
  const studentTotal = (sid, mode) => {
    const filled = (scoresMap[sid]?.[mode] || []).filter(s => s != null && s !== '')
    return filled.length ? filled.reduce((a, b) => a + Number(b), 0) : null
  }
  const avg = (mode) => {
    const totals = roster.map(s => studentTotal(s.id, mode)).filter(v => v != null)
    return totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null
  }
  const topicAvg = (mode, idx) => {
    const vals = roster.map(s => { const v = scoresMap[s.id]?.[mode]?.[idx]; return v != null && v !== '' ? Number(v) : null }).filter(v => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  const classAvg = {
    pre: avg('pre'), post: avg('post'),
    byTopic: { pre: topics.map((_, i) => topicAvg('pre', i)), post: topics.map((_, i) => topicAvg('post', i)) },
  }
  return { topics, totalMarks, scores: scoresMap, classAvg, expectedPre: testRow.expected_pre ?? null, expectedPost: testRow.expected_post ?? null }
}

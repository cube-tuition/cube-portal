'use client'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { resolveAssignedExamId, loadExamItems, computeExamAnalysis } from '../lib/examMarking'
import StudentExamAnalysisView, { studentAnalysisRows } from './StudentExamAnalysisView'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

/*
 * ExamSection — per-question exam marking with automatic topical analysis.
 *
 * The exam is taken from the class's curriculum assignment for this term (the
 * is_exam booklet → qbank exam). Each question carries a topic and a mark value,
 * so awarding marks per question rolls straight up into a topic breakdown.
 *
 * Marks are stored per (class, term, student, question) in exam_question_marks.
 */

const firstName = (n) => (n || '—').split(' ')[0]
const pct = (s, m) => (!m || s == null) ? null : Math.round((Number(s) / Number(m)) * 100)
function scoreColor(p) { if (p == null) return '#9CA3AF'; if (p >= 80) return '#10B981'; if (p >= 60) return '#F59E0B'; return '#EF4444' }
function scoreBg(p) { if (p == null) return '#F3F4F6'; if (p >= 80) return '#D1FAE5'; if (p >= 60) return '#FEF3C7'; return '#FEE2E2' }

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#DEE7FF] rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-[#062E63] mb-1">{label}</p>
      <p style={{ color: payload[0].payload.fill }}>Class average: <strong>{payload[0].value}%</strong></p>
    </div>
  )
}

export default function ExamSection({ classId, termId, termNumber, roster, canEdit }) {
  const [loading, setLoading] = useState(true)
  const [exam, setExam] = useState(null)        // { id, name }
  const [items, setItems] = useState([])        // [{ qid, n, section, topic, max, qtype, stem }]
  const [marks, setMarks] = useState({})        // marks[studentId][qid] = awarded (string)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [selStudent, setSelStudent] = useState('')   // per-student analysis dropdown
  const skipNextSave = useRef(false)   // don't autosave the marks we just loaded

  // ── Load assigned exam + questions + existing marks ─────────────────────────
  useEffect(() => {
    let alive = true
    ;(async () => {
      await Promise.resolve()           // defer first setState out of the sync effect body
      if (!alive) return
      setLoading(true); setError(null)
      try {
        // Resolve the class's assigned exam (shared with the student reports).
        const { examId, examName, backfillBookletId } = await resolveAssignedExamId(classId, termNumber)
        if (!examId) { if (alive) { setExam(null); setItems([]); setLoading(false) } return }
        // Persist an old-style assignment's resolved link so future loads are direct.
        if (backfillBookletId) {
          await supabase.from('booklets').update({ is_exam: true, exam_id: examId }).eq('id', backfillBookletId)
        }
        const list = await loadExamItems(examId)

        const { data: existing } = await supabase
          .from('exam_question_marks')
          .select('student_id, question_id, awarded')
          .eq('class_id', classId).eq('term_id', termId).eq('exam_id', examId)
        const mm = {}
        for (const r of existing || []) {
          mm[r.student_id] = mm[r.student_id] || {}
          mm[r.student_id][r.question_id] = r.awarded == null ? '' : String(r.awarded)
        }
        if (alive) {
          skipNextSave.current = true   // loading marks shouldn't trigger an autosave
          setExam({ id: examId, name: examName || 'Exam' })
          setItems(list); setMarks(mm)
          setLoading(false)
        }
      } catch (e) { if (alive) { setError(e.message || 'Could not load the exam.'); setLoading(false) } }
    })()
    return () => { alive = false }
  }, [classId, termId, termNumber])

  const setMark = (sid, qid, v) => setMarks((m) => ({ ...m, [sid]: { ...(m[sid] || {}), [qid]: v } }))

  // MCQ is binary — tap a cell to cycle: unmarked → correct (full marks) → incorrect (0) → unmarked.
  const cycleMcq = (sid, it) => {
    const cur = marks[sid]?.[it.qid] ?? ''
    const next = cur === '' ? String(it.max) : (Number(cur) === it.max ? '0' : '')
    setMark(sid, it.qid, next)
  }
  // Award every student full marks for one MCQ question in a single click.
  const markAllCorrect = (it) => setMarks((m) => {
    const next = { ...m }
    for (const st of roster) next[st.id] = { ...(next[st.id] || {}), [it.qid]: String(it.max) }
    return next
  })

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!exam) return
    setSaving(true); setError(null)
    try {
      const ups = []
      for (const st of roster) {
        for (const it of items) {
          const a = marks[st.id]?.[it.qid]
          if (a === '' || a == null) continue
          ups.push({
            class_id: classId, term_id: termId, student_id: st.id, exam_id: exam.id, question_id: it.qid,
            awarded: Number(a),
            max_marks: it.max, topic: it.topic, section: it.section,
            updated_at: new Date().toISOString(),
          })
        }
      }
      if (ups.length) {
        const { error: err } = await supabase.from('exam_question_marks')
          .upsert(ups, { onConflict: 'class_id,term_id,student_id,question_id' })
        if (err) throw new Error(err.message)
      }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }, [exam, roster, items, marks, classId, termId])

  // Debounced autosave — marks persist as you mark; no manual save needed.
  useEffect(() => {
    if (!exam || !canEdit) return
    if (skipNextSave.current) { skipNextSave.current = false; return }
    const t = setTimeout(() => { handleSave() }, 800)
    return () => clearTimeout(t)
  }, [marks, exam, canEdit, handleSave])

  // ── Topical analysis (auto) ─────────────────────────────────────────────────
  // Core topic/section roll-up is shared with the student reports (single source
  // of truth in lib/examMarking); overall + strengths/weaknesses are layered on.
  const analysis = useMemo(() => {
    const base = computeExamAnalysis(items, marks, roster)
    const overallAwarded = base.topics.reduce((s, t) => s + t.awarded, 0)
    const overallMax = base.topics.reduce((s, t) => s + t.max, 0)
    return {
      ...base,
      overall: { awarded: overallAwarded, max: overallMax, pct: pct(overallAwarded, overallMax) },
      strengths: base.topics.filter((t) => t.pct != null && t.pct >= 80).map((t) => t.topic),
      weaknesses: base.topics.filter((t) => t.pct != null && t.pct < 60).map((t) => t.topic),
    }
  }, [roster, items, marks])

  // Per-question class average (% across students who attempted it)
  const qClassAvg = (it) => {
    let aw = 0, mx = 0
    for (const st of roster) {
      const a = marks[st.id]?.[it.qid]
      if (a === '' || a == null) continue
      aw += Number(a) || 0; mx += it.max
    }
    return pct(aw, mx)
  }

  // Per-student section total
  const studentSectionTotal = (sid, sectionLabel) => {
    let aw = 0, mx = 0
    for (const it of items) {
      if (it.section !== sectionLabel) continue
      const a = marks[sid]?.[it.qid]
      if (a === '' || a == null) continue
      aw += Number(a) || 0; mx += it.max
    }
    return mx ? { aw, mx, pct: Math.round((aw / mx) * 100) } : null
  }

  if (loading) return <div className="py-16 text-center text-sm text-[#2A2035]/40 animate-pulse">Loading exam…</div>

  if (!exam) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] p-10 text-center">
        <p className="text-sm font-semibold text-[#062E63] mb-1">No exam assigned for Term {termNumber}</p>
        <p className="text-xs text-[#2A2035]/50">Assign an exam to this class&apos;s curriculum (via the booklets / curriculum page) to mark it here.</p>
      </div>
    )
  }

  const sections = [...new Set(items.map((it) => it.section))]
  const chartData = analysis.topics.map((t) => ({ name: t.topic, pct: t.pct ?? 0, fill: scoreColor(t.pct) }))
  const sid = selStudent || roster[0]?.id || ''
  const sidStudent = roster.find((s) => s.id === sid)
  const sidData = studentAnalysisRows(analysis, sid)

  const inputCls = 'w-14 text-center border border-[#DEE7FF] rounded-md px-1 py-1 text-sm focus:outline-none focus:border-[#325099]'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-[#062E63]">{exam.name}</h2>
          <p className="text-[11px] text-[#2A2035]/45">{items.length} questions · {analysis.overall.max ? `${analysis.overall.max} marks entered` : 'enter marks below'} · marks roll up by topic automatically</p>
        </div>
        {canEdit && (
          <span className="text-xs font-semibold text-[#2A2035]/45 whitespace-nowrap">
            {saving ? 'Saving…' : saved ? 'All changes saved ✓' : 'Autosaves as you mark'}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-[#DC2626]">{error}</p>}

      {/* Marking grid, grouped by section */}
      {sections.map((sec) => {
        const rows = items.filter((it) => it.section === sec)
        return (
          <div key={sec} className="bg-white rounded-2xl border border-[#F0F4FF] overflow-hidden">
            <div className="px-4 py-2.5 bg-[#F8FAFF] border-b border-[#F0F4FF]">
              <p className="text-xs font-bold text-[#325099]">{sec}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[#2A2035]/45">
                    <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-white">Question</th>
                    <th className="text-left font-semibold px-2 py-2">Topic</th>
                    <th className="text-center font-semibold px-2 py-2">Max</th>
                    {roster.map((st) => (
                      <th key={st.id} className="text-center font-semibold px-2 py-2 whitespace-nowrap">{firstName(st.full_name)}</th>
                    ))}
                    <th className="text-center font-semibold px-2 py-2">Class&nbsp;avg</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => {
                    const cAvg = qClassAvg(it)
                    return (
                      <tr key={it.qid} className="border-t border-[#F0F4FF]">
                        <td className="px-3 py-2 sticky left-0 bg-white">
                          <span className="font-bold text-[#062E63]">Q{it.n}</span>
                          {it.stem && <span className="block text-[10px] text-[#2A2035]/40 max-w-[180px] truncate">{it.stem}</span>}
                        </td>
                        <td className="px-2 py-2"><span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#EEF4FF] text-[#325099] whitespace-nowrap">{it.topic}</span></td>
                        <td className="px-2 py-2 text-center text-[#2A2035]/50 font-semibold">
                          {it.max}
                          {canEdit && it.qtype === 'mcq' && (
                            <button type="button" onClick={() => markAllCorrect(it)} title="Mark every student correct"
                              className="block mx-auto mt-0.5 text-[9px] font-bold text-[#10B981] hover:underline">✓ all</button>
                          )}
                        </td>
                        {roster.map((st) => {
                          const a = marks[st.id]?.[it.qid] ?? ''
                          const isMcq = it.qtype === 'mcq'
                          const correct = a !== '' && Number(a) === it.max
                          const over = a !== '' && Number(a) > it.max
                          if (!canEdit) {
                            return (
                              <td key={st.id} className="px-2 py-1.5 text-center align-top">
                                {isMcq
                                  ? <span className="font-bold" style={{ color: a === '' ? '#9CA3AF' : (correct ? '#10B981' : '#EF4444') }}>{a === '' ? '–' : (correct ? '✓' : '✗')}</span>
                                  : <span className="font-semibold text-[#2A2035]">{a === '' ? '–' : a}</span>}
                              </td>
                            )
                          }
                          return (
                            <td key={st.id} className="px-2 py-1.5 text-center align-top">
                              {isMcq ? (
                                <button type="button" onClick={() => cycleMcq(st.id, it)}
                                  title="Tap to cycle: correct → incorrect → clear"
                                  className="w-8 h-8 rounded-md border text-sm font-bold transition"
                                  style={a === ''
                                    ? { background: '#fff', borderColor: '#DEE7FF', color: '#CBD5E1' }
                                    : correct
                                      ? { background: '#D1FAE5', borderColor: '#10B981', color: '#047857' }
                                      : { background: '#FEE2E2', borderColor: '#EF4444', color: '#B91C1C' }}>
                                  {a === '' ? '–' : (correct ? '✓' : '✗')}
                                </button>
                              ) : (
                                <>
                                  <input type="number" min="0" max={it.max} step="0.5" value={a}
                                    onChange={(e) => setMark(st.id, it.qid, e.target.value)}
                                    className={`${inputCls} ${over ? 'border-[#EF4444] text-[#EF4444]' : ''}`} />
                                </>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-2 py-2 text-center">
                          <span className="text-xs font-bold" style={{ color: scoreColor(cAvg) }}>{cAvg == null ? '–' : `${cAvg}%`}</span>
                        </td>
                      </tr>
                    )
                  })}
                  {/* Section totals */}
                  <tr className="border-t-2 border-[#DEE7FF] bg-[#FBFCFF] text-xs">
                    <td className="px-3 py-2 font-bold text-[#062E63] sticky left-0 bg-[#FBFCFF]" colSpan={3}>Section total</td>
                    {roster.map((st) => {
                      const tot = studentSectionTotal(st.id, sec)
                      return (
                        <td key={st.id} className="px-2 py-2 text-center font-bold" style={{ color: tot ? scoreColor(tot.pct) : '#9CA3AF' }}>
                          {tot ? `${tot.aw}/${tot.mx}` : '–'}
                        </td>
                      )
                    })}
                    <td className="px-2 py-2" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* ── Topical analysis ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#F0F4FF] p-5 space-y-5">
        <h3 className="text-sm font-bold text-[#062E63]">Topical analysis</h3>

        {analysis.overall.max === 0 ? (
          <p className="text-xs text-[#2A2035]/40 italic">Enter some marks above to see the topic breakdown.</p>
        ) : (
          <>
            <div style={{ width: '100%', height: Math.max(180, analysis.topics.length * 38) }}>
              <ResponsiveContainer>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#EEF2FB" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="pct" radius={[0, 6, 6, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Per-student topic table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[#2A2035]/45">
                    <th className="text-left font-semibold px-2 py-2 sticky left-0 bg-white">Student</th>
                    {analysis.orderedTopics.map((t) => <th key={t} className="text-center font-semibold px-2 py-2">{t}</th>)}
                    <th className="text-center font-semibold px-2 py-2">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((st) => {
                    const ps = analysis.perStudent[st.id]
                    return (
                      <tr key={st.id} className="border-t border-[#F0F4FF]">
                        <td className="px-2 py-1.5 font-semibold text-[#062E63] sticky left-0 bg-white whitespace-nowrap">{firstName(st.full_name)}</td>
                        {analysis.orderedTopics.map((t) => {
                          const cell = ps.topics[t]
                          const p = cell ? pct(cell.awarded, cell.max) : null
                          return (
                            <td key={t} className="px-2 py-1.5 text-center">
                              <span className="inline-block px-1.5 py-0.5 rounded-md font-bold" style={{ background: scoreBg(p), color: scoreColor(p) }}>
                                {p == null ? '–' : `${p}%`}
                              </span>
                            </td>
                          )
                        })}
                        <td className="px-2 py-1.5 text-center font-bold" style={{ color: scoreColor(pct(ps.awarded, ps.max)) }}>
                          {ps.max ? `${pct(ps.awarded, ps.max)}%` : '–'}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="border-t-2 border-[#DEE7FF] bg-[#FBFCFF]">
                    <td className="px-2 py-2 font-bold text-[#062E63] sticky left-0 bg-[#FBFCFF]">Class avg</td>
                    {analysis.topics.map((t) => (
                      <td key={t.topic} className="px-2 py-2 text-center font-bold" style={{ color: scoreColor(t.pct) }}>{t.pct == null ? '–' : `${t.pct}%`}</td>
                    ))}
                    <td className="px-2 py-2 text-center font-bold" style={{ color: scoreColor(analysis.overall.pct) }}>{analysis.overall.pct == null ? '–' : `${analysis.overall.pct}%`}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Strengths / weaknesses */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-[#D1FAE5] bg-[#ECFDF5] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#047857] mb-1">Strengths (≥80%)</p>
                <p className="text-xs text-[#065F46]">{analysis.strengths.length ? analysis.strengths.join(', ') : '—'}</p>
              </div>
              <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#B91C1C] mb-1">Needs work (&lt;60%)</p>
                <p className="text-xs text-[#991B1B]">{analysis.weaknesses.length ? analysis.weaknesses.join(', ') : '—'}</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Per-student analysis ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#F0F4FF] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-[#062E63]">Per-student analysis</h3>
          {roster.length > 0 && (
            <select value={sid} onChange={(e) => setSelStudent(e.target.value)}
              className="border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
              {roster.map((st) => <option key={st.id} value={st.id}>{st.full_name}</option>)}
            </select>
          )}
        </div>
        {sid ? (
          <StudentExamAnalysisView
            studentName={sidStudent?.full_name}
            rows={sidData.rows}
            overall={sidData.overall}
            sections={sidData.sections}
            strengths={sidData.strengths}
            weaknesses={sidData.weaknesses}
          />
        ) : (
          <p className="text-xs text-[#2A2035]/40 italic">No students in this class.</p>
        )}
      </div>
    </div>
  )
}

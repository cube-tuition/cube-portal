'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts'

/*
 * ExamSection — Exam topic marks split into Section 1 (MC) and Section 2 (Short Answer).
 *
 * Props:
 *   classId    — integer
 *   termId     — uuid
 *   termNumber — integer
 *   roster     — [{ id, full_name }]
 *   canEdit    — boolean
 */

const SECTIONS = [
  { id: '1', label: 'Section 1',  subtitle: 'Multiple Choice', totalMax: 10,  color: '#325099' },
  { id: '2', label: 'Section 2',  subtitle: 'Short Answer',    totalMax: 40,  color: '#7C3AED' },
]

function pct(score, max) {
  if (!max || score == null || score === '') return null
  return Math.round((Number(score) / Number(max)) * 100)
}
function scoreColor(p) {
  if (p == null) return '#E5E7EB'
  if (p >= 80) return '#10B981'
  if (p >= 60) return '#F59E0B'
  return '#EF4444'
}
function firstName(n) { return (n || '—').split(' ')[0] }

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#DEE7FF] rounded-xl shadow px-3 py-2 text-xs">
      <p className="font-semibold text-[#062E63] mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.fill || p.color }}>
          {p.name}: <strong>{p.value != null ? `${p.value}%` : '—'}</strong>
        </p>
      ))}
    </div>
  )
}

// ── Section mark entry panel ───────────────────────────────────────────────────
function SectionPanel({ section, topics, roster, marks, maxScores, canEdit, onChange, onMaxChange }) {
  const totalMax = section.totalMax

  // Sum of max scores entered across topics — for validation hint
  const enteredMax = topics.reduce((s, t) => s + Number(maxScores[section.id]?.[t] ?? 0), 0)

  return (
    <div className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#DEE7FF] flex items-center gap-3">
        <div className="w-2 h-8 rounded-full" style={{ background: section.color }} />
        <div>
          <p className="font-bold text-sm text-[#062E63]">{section.label}</p>
          <p className="text-[11px] text-[#325099]/50">{section.subtitle} · total {totalMax} marks</p>
        </div>
        {enteredMax > 0 && enteredMax !== totalMax && (
          <span className="ml-auto text-[11px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            {enteredMax}/{totalMax} marks allocated
          </span>
        )}
        {enteredMax === totalMax && (
          <span className="ml-auto text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            ✓ {totalMax} marks allocated
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
              <th className="text-left px-4 py-2.5 font-semibold text-[#325099] min-w-[140px]">Student</th>
              {topics.map(topic => (
                <th key={topic} className="text-center px-3 py-2.5 font-semibold text-[#325099] min-w-[110px]">
                  <div>{topic}</div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <span className="text-[10px] font-normal text-[#325099]/50">/ </span>
                    {canEdit ? (
                      <input
                        type="number"
                        value={maxScores[section.id]?.[topic] ?? ''}
                        onChange={e => onMaxChange(section.id, topic, e.target.value)}
                        placeholder="max"
                        className="w-12 text-center text-[10px] border border-[#DEE7FF] rounded px-1 py-0.5 focus:outline-none focus:border-[#325099]"
                        min={0}
                      />
                    ) : (
                      <span className="text-[10px] text-[#325099]/50">{maxScores[section.id]?.[topic] ?? '—'}</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.map((student, ri) => (
              <tr key={student.id} className={`border-b border-[#DEE7FF] ${ri % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'}`}>
                <td className="px-4 py-2.5 font-semibold text-[#062E63]">{student.full_name}</td>
                {topics.map(topic => {
                  const max   = Number(maxScores[section.id]?.[topic] ?? 0)
                  const score = marks[section.id]?.[student.id]?.[topic] ?? ''
                  const p     = max ? pct(score, max) : null
                  return (
                    <td key={topic} className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {canEdit ? (
                          <input
                            type="number"
                            value={score}
                            onChange={e => onChange(section.id, student.id, topic, e.target.value)}
                            min={0} max={max || undefined}
                            placeholder="—"
                            className="w-12 text-center text-xs border border-[#DEE7FF] rounded-lg px-1.5 py-1 focus:outline-none focus:border-[#325099]"
                          />
                        ) : (
                          <span className="font-semibold text-[#062E63]">{score !== '' ? score : '—'}</span>
                        )}
                        {max > 0 && <span className="text-[10px] text-[#325099]/40">/{max}</span>}
                      </div>
                      {p != null && (
                        <div className="mt-1 mx-auto w-16 h-1.5 rounded-full bg-[#F0F4FF]">
                          <div className="h-1.5 rounded-full transition-all" style={{ width: `${p}%`, background: scoreColor(p) }} />
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ExamSection({ classId, termId, termNumber, roster, canEdit }) {
  const [topics,    setTopics]    = useState([])
  // marks: { sectionId: { studentId: { topic: score } } }
  const [marks,     setMarks]     = useState({ '1': {}, '2': {} })
  // maxScores: { sectionId: { topic: max } }
  const [maxScores, setMaxScores] = useState({ '1': {}, '2': {} })
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [error,     setError]     = useState(null)
  const [expanded,  setExpanded]  = useState(null)

  // ── Load topics & existing marks ─────────────────────────────────────────────
  useEffect(() => {
    if (!classId || !termNumber) return
    supabase
      .from('class_booklet_assignments')
      .select('booklet_id, booklets(topic)')
      .eq('class_id', classId)
      .eq('term_number', termNumber)
      .then(async ({ data: cbaRows }) => {
        if (!cbaRows?.length) { setLoading(false); return }
        const uniqueTopics = [
          ...new Set(
            (cbaRows || [])
              .map(r => r.booklets?.topic)
              .filter(t => t && t !== 'Exam')
          ),
        ]
        setTopics(uniqueTopics)

        const { data: existing } = await supabase
          .from('exam_marks')
          .select('student_id, topic, section, score, max_score')
          .eq('class_id', classId)
          .eq('term_id', termId)

        const mMap = { '1': {}, '2': {} }
        const xMap = { '1': {}, '2': {} }
        for (const m of existing || []) {
          const sec = m.section || '2'
          if (!mMap[sec][m.student_id]) mMap[sec][m.student_id] = {}
          mMap[sec][m.student_id][m.topic] = m.score ?? ''
          xMap[sec][m.topic] = m.max_score
        }
        setMarks(mMap)
        setMaxScores(xMap)
        setLoading(false)
      })
  }, [classId, termId, termNumber])

  const handleChange = (sectionId, studentId, topic, value) => {
    setMarks(prev => ({
      ...prev,
      [sectionId]: {
        ...prev[sectionId],
        [studentId]: { ...(prev[sectionId]?.[studentId] || {}), [topic]: value },
      },
    }))
  }

  const handleMaxChange = (sectionId, topic, value) => {
    setMaxScores(prev => ({ ...prev, [sectionId]: { ...prev[sectionId], [topic]: value } }))
  }

  const handleSave = useCallback(async () => {
    setSaving(true); setError(null)
    try {
      const upserts = []
      for (const sec of SECTIONS) {
        for (const student of roster) {
          for (const topic of topics) {
            const score = marks[sec.id]?.[student.id]?.[topic]
            const max   = Number(maxScores[sec.id]?.[topic] ?? 0)
            if (score === '' || score == null || !max) continue
            upserts.push({
              class_id: classId, term_id: termId,
              student_id: student.id, topic, section: sec.id,
              score: Number(score), max_score: max,
              updated_at: new Date().toISOString(),
            })
          }
        }
      }
      if (upserts.length > 0) {
        const { error: err } = await supabase.from('exam_marks')
          .upsert(upserts, { onConflict: 'class_id,term_id,student_id,topic,section' })
        if (err) throw new Error(err.message)
      }
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [classId, termId, roster, topics, marks, maxScores])

  // ── Chart data helpers ───────────────────────────────────────────────────────
  const classChartData = topics.map(topic => {
    const entry = {}
    for (const sec of SECTIONS) {
      const max = Number(maxScores[sec.id]?.[topic] ?? 0)
      if (!max) continue
      const pcts = roster
        .map(s => pct(marks[sec.id]?.[s.id]?.[topic], max))
        .filter(p => p != null)
      entry[`s${sec.id}`] = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
    }
    return { topic, ...entry }
  })

  const studentChartData = (studentId) => topics.map(topic => {
    const entry = { topic }
    for (const sec of SECTIONS) {
      const max = Number(maxScores[sec.id]?.[topic] ?? 0)
      entry[`s${sec.id}`] = max ? pct(marks[sec.id]?.[studentId]?.[topic], max) : null
    }
    return entry
  })

  const studentOverall = (studentId) => {
    let totalScore = 0, totalMax = 0
    for (const sec of SECTIONS) {
      for (const topic of topics) {
        const max   = Number(maxScores[sec.id]?.[topic] ?? 0)
        const score = marks[sec.id]?.[studentId]?.[topic]
        if (max && score != null && score !== '') {
          totalScore += Number(score)
          totalMax   += max
        }
      }
    }
    return totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : null
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (topics.length === 0) return (
    <div className="bg-white border border-[#DEE7FF] rounded-2xl p-12 text-center">
      <p className="text-2xl mb-3">📚</p>
      <p className="text-sm font-semibold text-[#062E63]">No topics found for this term</p>
      <p className="text-xs text-[#325099]/60 mt-1">Topics are scanned from booklets assigned to this class this term.</p>
    </div>
  )

  return (
    <div className="space-y-6">

      {/* Save button */}
      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {saved  && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
          {error  && <span className="text-xs text-red-600">{error}</span>}
          <button onClick={handleSave} disabled={saving}
            className="text-xs font-semibold bg-[#062E63] text-white px-5 py-2 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
            {saving ? 'Saving…' : 'Save marks'}
          </button>
        </div>
      )}

      {/* Section panels */}
      {SECTIONS.map(sec => (
        <SectionPanel
          key={sec.id}
          section={sec}
          topics={topics}
          roster={roster}
          marks={marks}
          maxScores={maxScores}
          canEdit={canEdit}
          onChange={handleChange}
          onMaxChange={handleMaxChange}
        />
      ))}

      {/* Class summary chart */}
      <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
        <h3 className="font-bold text-sm text-[#062E63] mb-1">Class average by topic</h3>
        <p className="text-[11px] text-[#325099]/50 mb-4">S1 = Multiple Choice · S2 = Short Answer</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={classChartData} margin={{ top: 4, right: 20, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F4FF" />
            <XAxis dataKey="topic" tick={{ fontSize: 11, fill: '#325099' }} angle={-30} textAnchor="end" interval={0} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#325099' }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            <ReferenceLine y={80} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1.5} />
            <ReferenceLine y={60} stroke="#F59E0B" strokeDasharray="4 2" strokeWidth={1.5} />
            <Bar dataKey="s1" name="S1 — MC"          fill={SECTIONS[0].color} radius={[3,3,0,0]} />
            <Bar dataKey="s2" name="S2 — Short Answer" fill={SECTIONS[1].color} radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Individual student charts */}
      <div className="space-y-3">
        <h3 className="font-bold text-sm text-[#062E63]">Individual performance</h3>
        {roster.map(student => {
          const data    = studentChartData(student.id)
          const overall = studentOverall(student.id)
          const hasData = data.some(d => d.s1 != null || d.s2 != null)

          return (
            <div key={student.id} className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
              <button
                className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-[#F8FAFF] transition"
                onClick={() => setExpanded(e => e === student.id ? null : student.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-[#062E63]">{student.full_name}</span>
                  {overall != null && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: `${scoreColor(overall)}20`, color: scoreColor(overall) }}>
                      {overall}% overall
                    </span>
                  )}
                  {!hasData && <span className="text-[11px] text-[#325099]/40 italic">No marks entered</span>}
                </div>
                <span className="text-[#325099]/40 text-sm">{expanded === student.id ? '▲' : '▼'}</span>
              </button>

              {expanded === student.id && (
                <div className="border-t border-[#DEE7FF] px-5 py-4">
                  {!hasData ? (
                    <p className="text-xs text-[#325099]/40 italic text-center py-4">No marks entered yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F0F4FF" />
                        <XAxis dataKey="topic" tick={{ fontSize: 11, fill: '#325099' }} angle={-30} textAnchor="end" interval={0} />
                        <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#325099' }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                        <ReferenceLine y={80} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1.5} />
                        <ReferenceLine y={60} stroke="#F59E0B" strokeDasharray="4 2" strokeWidth={1.5} />
                        <Bar dataKey="s1" name="S1 — MC"          fill={SECTIONS[0].color} radius={[3,3,0,0]} />
                        <Bar dataKey="s2" name="S2 — Short Answer" fill={SECTIONS[1].color} radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

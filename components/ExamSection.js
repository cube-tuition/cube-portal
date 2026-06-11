'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  ComposedChart, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, Line, ErrorBar,
} from 'recharts'

/*
 * ExamSection — Exam topic marks split into Section 1 (MC) and Section 2 (Short Answer).
 *
 * Features:
 *  - Raw mark + % per cell in section tables
 *  - Silly mistake tracker (toggle-able per section)
 *  - Class summary table with S1/S2/Total raw+% and SM impact
 *  - Class average chart by topic (grouped bars)
 *  - Individual student chart with class average line overlay
 *  - Strengths & weaknesses recommendations per student
 */

const SECTIONS = [
  { id: '1', label: 'Section 1', subtitle: 'Multiple Choice', totalMax: 10, color: '#325099' },
  { id: '2', label: 'Section 2', subtitle: 'Short Answer',    totalMax: 40, color: '#7C3AED' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(score, max) {
  if (!max || score == null || score === '') return null
  return Math.round((Number(score) / Number(max)) * 100)
}

function scoreColor(p) {
  if (p == null) return '#9CA3AF'
  if (p >= 80)   return '#10B981'
  if (p >= 60)   return '#F59E0B'
  return '#EF4444'
}

function scoreBg(p) {
  if (p == null) return '#F3F4F6'
  if (p >= 80)   return '#D1FAE5'
  if (p >= 60)   return '#FEF3C7'
  return '#FEE2E2'
}

function firstName(n) { return (n || '—').split(' ')[0] }

// ── Tooltip for charts ────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#DEE7FF] rounded-xl shadow-lg px-3 py-2.5 text-xs min-w-[160px]">
      <p className="font-bold text-[#062E63] mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center justify-between gap-4 mb-1">
          <span style={{ color: p.color ?? p.fill }}>{p.name}</span>
          <strong style={{ color: p.color ?? p.fill }}>
            {p.value != null ? `${p.value}%` : '—'}
          </strong>
        </div>
      ))}
    </div>
  )
}

// ── Section panel ─────────────────────────────────────────────────────────────

function SectionPanel({
  section, topics, roster, marks, sillyMistakes, maxScores,
  canEdit, showSM, onToggleSM,
  onChange, onSMChange, onMaxChange,
}) {
  const totalMax    = section.totalMax
  const enteredMax  = topics.reduce((s, t) => s + Number(maxScores[section.id]?.[t] ?? 0), 0)

  // Per-student totals for this section
  const studentTotal = (studentId) => {
    let score = 0, max = 0
    for (const t of topics) {
      const m = Number(maxScores[section.id]?.[t] ?? 0)
      const v = marks[section.id]?.[studentId]?.[t]
      if (m && v != null && v !== '') { score += Number(v); max += m }
    }
    return max > 0 ? { score, max, pct: Math.round((score / max) * 100) } : null
  }

  // Class average per topic (%)
  const topicClassAvg = (topic) => {
    const max  = Number(maxScores[section.id]?.[topic] ?? 0)
    if (!max) return null
    const vals = roster.map(s => pct(marks[section.id]?.[s.id]?.[topic], max)).filter(p => p != null)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  return (
    <div className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#DEE7FF] flex items-center gap-3 flex-wrap">
        <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: section.color }} />
        <div>
          <p className="font-bold text-sm text-[#062E63]">{section.label}</p>
          <p className="text-[11px] text-[#325099]/50">{section.subtitle} · total {totalMax} marks</p>
        </div>
        {enteredMax > 0 && enteredMax !== totalMax && (
          <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            {enteredMax}/{totalMax} marks allocated
          </span>
        )}
        {enteredMax === totalMax && (
          <span className="text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            ✓ {totalMax} marks allocated
          </span>
        )}
        {/* SM toggle */}
        <button
          onClick={onToggleSM}
          className={`ml-auto text-[11px] font-semibold px-3 py-1 rounded-full border transition ${
            showSM
              ? 'bg-amber-50 text-amber-700 border-amber-300'
              : 'bg-[#F8FAFF] text-[#325099]/60 border-[#DEE7FF] hover:border-[#325099]/40'
          }`}
        >
          ✏️ Silly mistakes {showSM ? 'on' : 'off'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
              <th className="text-left px-4 py-2.5 font-semibold text-[#325099] min-w-[140px] sticky left-0 bg-[#F8FAFF]">
                Student
              </th>
              {topics.map(topic => (
                <th key={topic} className="text-center px-3 py-2.5 font-semibold text-[#325099] min-w-[120px]">
                  <div className="font-semibold">{topic}</div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <span className="text-[10px] font-normal text-[#325099]/50">/ </span>
                    {canEdit ? (
                      <input
                        type="text" inputMode="numeric" pattern="[0-9]*"
                        value={maxScores[section.id]?.[topic] ?? ''}
                        onChange={e => onMaxChange(section.id, topic, e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="max"
                        className="w-12 text-center text-[10px] border border-[#DEE7FF] rounded px-1 py-0.5 focus:outline-none focus:border-[#325099]"
                      />
                    ) : (
                      <span className="text-[10px] text-[#325099]/50">{maxScores[section.id]?.[topic] ?? '—'}</span>
                    )}
                  </div>
                </th>
              ))}
              <th className="text-center px-3 py-2.5 font-semibold text-[#325099] min-w-[90px] bg-[#F0F4FF]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {roster.map((student, ri) => {
              const tot = studentTotal(student.id)
              return (
                <tr key={student.id} className={`border-b border-[#DEE7FF] ${ri % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'}`}>
                  <td className="px-4 py-2 font-semibold text-[#062E63] sticky left-0 bg-inherit">{student.full_name}</td>
                  {topics.map(topic => {
                    const max   = Number(maxScores[section.id]?.[topic] ?? 0)
                    const score = marks[section.id]?.[student.id]?.[topic] ?? ''
                    const sm    = sillyMistakes[section.id]?.[student.id]?.[topic] ?? ''
                    const p     = max ? pct(score, max) : null
                    const adjScore = score !== '' && score != null && sm !== '' ? Number(score) + Number(sm) : null
                    const adjPct   = max && adjScore != null ? pct(adjScore, max) : null

                    return (
                      <td key={topic} className="px-2 py-2 text-center align-top">
                        <div className="flex flex-col items-center gap-0.5">
                          {/* Score row */}
                          <div className="flex items-center gap-0.5">
                            {canEdit ? (
                              <input
                                type="text" inputMode="numeric" pattern="[0-9]*"
                                value={score}
                                onChange={e => onChange(section.id, student.id, topic, e.target.value.replace(/[^0-9]/g, ''))}
                                placeholder="—"
                                className="w-10 text-center text-xs border border-[#DEE7FF] rounded-lg px-1 py-1 focus:outline-none focus:border-[#325099]"
                              />
                            ) : (
                              <span className="font-semibold text-[#062E63]">{score !== '' ? score : '—'}</span>
                            )}
                            {max > 0 && <span className="text-[10px] text-[#325099]/40">/{max}</span>}
                          </div>
                          {/* Percentage badge */}
                          {p != null && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ color: scoreColor(p), background: scoreBg(p) }}>
                              {p}%
                            </span>
                          )}
                          {/* Progress bar */}
                          {p != null && (
                            <div className="w-14 h-1 rounded-full bg-[#F0F4FF] mt-0.5">
                              <div className="h-1 rounded-full transition-all" style={{ width: `${p}%`, background: scoreColor(p) }} />
                            </div>
                          )}
                          {/* Silly mistake input */}
                          {showSM && (
                            <div className="mt-1.5 flex flex-col items-center gap-0.5 border-t border-amber-100 pt-1.5 w-full">
                              <div className="flex items-center gap-0.5">
                                <span className="text-[9px] text-amber-500 font-semibold">SM</span>
                                {canEdit ? (
                                  <input
                                    type="text" inputMode="numeric" pattern="[0-9]*"
                                    value={sm}
                                    onChange={e => onSMChange(section.id, student.id, topic, e.target.value.replace(/[^0-9]/g, ''))}
                                    placeholder="0"
                                    className="w-8 text-center text-[10px] border border-amber-200 bg-amber-50 rounded px-1 py-0.5 focus:outline-none focus:border-amber-400"
                                  />
                                ) : (
                                  <span className="text-[10px] text-amber-600 font-semibold">{sm || 0}</span>
                                )}
                              </div>
                              {/* Adjusted pct if SM > 0 */}
                              {adjPct != null && Number(sm) > 0 && (
                                <span className="text-[9px] text-amber-600">→ {adjPct}%</span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    )
                  })}
                  {/* Total cell */}
                  <td className="px-2 py-2 text-center bg-[#F8FAFF]">
                    {tot ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-bold text-[#062E63] text-xs">{tot.score}/{tot.max}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ color: scoreColor(tot.pct), background: scoreBg(tot.pct) }}>
                          {tot.pct}%
                        </span>
                      </div>
                    ) : <span className="text-[#325099]/30 text-xs">—</span>}
                  </td>
                </tr>
              )
            })}

            {/* Class average row */}
            <tr className="border-t-2 border-[#DEE7FF] bg-[#F0F4FF]">
              <td className="px-4 py-2 font-bold text-[#325099] text-[11px] sticky left-0 bg-[#F0F4FF]">Class avg</td>
              {topics.map(topic => {
                const avg = topicClassAvg(topic)
                return (
                  <td key={topic} className="px-2 py-2 text-center">
                    {avg != null ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ color: scoreColor(avg), background: scoreBg(avg) }}>
                        {avg}%
                      </span>
                    ) : <span className="text-[#325099]/30 text-xs">—</span>}
                  </td>
                )
              })}
              <td className="px-2 py-2 text-center bg-[#EEF4FF]">
                {(() => {
                  const vals = roster.map(s => {
                    const tot = (() => {
                      let sc = 0, mx = 0
                      for (const t of topics) {
                        const m = Number(maxScores[section.id]?.[t] ?? 0)
                        const v = marks[section.id]?.[s.id]?.[t]
                        if (m && v != null && v !== '') { sc += Number(v); mx += m }
                      }
                      return mx > 0 ? Math.round((sc / mx) * 100) : null
                    })()
                    return tot
                  }).filter(p => p != null)
                  const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
                  return avg != null ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ color: scoreColor(avg), background: scoreBg(avg) }}>
                      {avg}%
                    </span>
                  ) : <span className="text-[#325099]/30 text-xs">—</span>
                })()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Class summary table ───────────────────────────────────────────────────────

function ClassSummaryTable({ roster, marks, sillyMistakes, maxScores, topics }) {
  const studentStats = (studentId) => {
    const stats = {}
    for (const sec of SECTIONS) {
      let score = 0, max = 0, sm = 0
      for (const t of topics) {
        const m = Number(maxScores[sec.id]?.[t] ?? 0)
        const v = marks[sec.id]?.[studentId]?.[t]
        const s = Number(sillyMistakes[sec.id]?.[studentId]?.[t] ?? 0)
        if (m && v != null && v !== '') {
          score += Number(v); max += m; sm += s
        }
      }
      stats[sec.id] = max > 0 ? { score, max, pct: Math.round((score / max) * 100), sm } : null
    }
    // Combined
    let totalScore = 0, totalMax = 0, totalSM = 0
    for (const sec of SECTIONS) {
      if (stats[sec.id]) {
        totalScore += stats[sec.id].score
        totalMax   += stats[sec.id].max
        totalSM    += stats[sec.id].sm
      }
    }
    const overall = totalMax > 0 ? { score: totalScore, max: totalMax, pct: Math.round((totalScore / totalMax) * 100), sm: totalSM } : null
    return { ...stats, overall }
  }

  const anyData = roster.some(s => {
    const st = studentStats(s.id)
    return st.overall != null
  })

  if (!anyData) return null

  return (
    <div className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[#DEE7FF]">
        <h3 className="font-bold text-sm text-[#062E63]">Class summary</h3>
        <p className="text-[11px] text-[#325099]/50 mt-0.5">Raw marks and percentages across all sections</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
              <th className="text-left px-4 py-2.5 font-semibold text-[#325099] min-w-[140px]">Student</th>
              {SECTIONS.map(sec => (
                <th key={sec.id} className="text-center px-3 py-2.5 font-semibold min-w-[110px]"
                  style={{ color: sec.color }}>
                  {sec.label}<br />
                  <span className="text-[10px] font-normal opacity-60">{sec.subtitle}</span>
                </th>
              ))}
              <th className="text-center px-3 py-2.5 font-semibold text-[#062E63] min-w-[110px] bg-[#F0F4FF]">
                Overall
              </th>
              <th className="text-center px-3 py-2.5 font-semibold text-amber-600 min-w-[100px]">
                SM impact
              </th>
            </tr>
          </thead>
          <tbody>
            {roster.map((student, ri) => {
              const st = studentStats(student.id)
              return (
                <tr key={student.id} className={`border-b border-[#DEE7FF] ${ri % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'}`}>
                  <td className="px-4 py-2.5 font-semibold text-[#062E63]">{student.full_name}</td>
                  {SECTIONS.map(sec => {
                    const s = st[sec.id]
                    return (
                      <td key={sec.id} className="px-3 py-2.5 text-center">
                        {s ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-semibold text-[#062E63]">{s.score}<span className="text-[#325099]/40">/{s.max}</span></span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ color: scoreColor(s.pct), background: scoreBg(s.pct) }}>
                              {s.pct}%
                            </span>
                          </div>
                        ) : <span className="text-[#325099]/30">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 text-center bg-[#F8FAFF]">
                    {st.overall ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-bold text-[#062E63]">{st.overall.score}<span className="text-[#325099]/40">/{st.overall.max}</span></span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ color: scoreColor(st.overall.pct), background: scoreBg(st.overall.pct) }}>
                          {st.overall.pct}%
                        </span>
                      </div>
                    ) : <span className="text-[#325099]/30">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {st.overall?.sm > 0 ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[11px] font-semibold text-amber-600">–{st.overall.sm} marks</span>
                        {st.overall.max > 0 && (
                          <span className="text-[10px] text-amber-500">
                            → {Math.min(100, Math.round(((st.overall.score + st.overall.sm) / st.overall.max) * 100))}% w/o SM
                          </span>
                        )}
                      </div>
                    ) : <span className="text-[10px] text-[#325099]/30">None</span>}
                  </td>
                </tr>
              )
            })}

            {/* Class average row */}
            <tr className="border-t-2 border-[#DEE7FF] bg-[#F0F4FF]">
              <td className="px-4 py-2.5 font-bold text-[#325099] text-[11px]">Class avg</td>
              {SECTIONS.map(sec => {
                const vals = roster.map(s => {
                  const st = studentStats(s.id)
                  return st[sec.id]?.pct ?? null
                }).filter(p => p != null)
                const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
                return (
                  <td key={sec.id} className="px-3 py-2.5 text-center">
                    {avg != null ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ color: scoreColor(avg), background: scoreBg(avg) }}>
                        {avg}%
                      </span>
                    ) : <span className="text-[#325099]/30">—</span>}
                  </td>
                )
              })}
              <td className="px-3 py-2.5 text-center bg-[#EEF4FF]">
                {(() => {
                  const vals = roster.map(s => studentStats(s.id).overall?.pct ?? null).filter(p => p != null)
                  const avg  = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
                  return avg != null ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ color: scoreColor(avg), background: scoreBg(avg) }}>
                      {avg}%
                    </span>
                  ) : <span className="text-[#325099]/30">—</span>
                })()}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Strengths & weaknesses ────────────────────────────────────────────────────

function RecommendationsPanel({ studentId, topics, marks, sillyMistakes, maxScores, classChartData }) {
  // Per-topic combined % for student
  const topicPct = (topic) => {
    let score = 0, max = 0
    for (const sec of SECTIONS) {
      const m = Number(maxScores[sec.id]?.[topic] ?? 0)
      const v = marks[sec.id]?.[studentId]?.[topic]
      if (m && v != null && v !== '') { score += Number(v); max += m }
    }
    return max > 0 ? Math.round((score / max) * 100) : null
  }

  // Total silly mistakes across all topics
  const totalSM = SECTIONS.reduce((sum, sec) =>
    sum + topics.reduce((s2, t) =>
      s2 + Number(sillyMistakes[sec.id]?.[studentId]?.[t] ?? 0), 0), 0)

  const topicData = topics
    .map(t => ({ topic: t, pct: topicPct(t), classAvg: classChartData.find(d => d.topic === t)?.classAvg ?? null }))
    .filter(d => d.pct != null)

  if (!topicData.length) return null

  const strengths  = topicData.filter(d => d.pct >= 80).sort((a, b) => b.pct - a.pct)
  const weaknesses = topicData.filter(d => d.pct < 60).sort((a, b) => a.pct - b.pct)
  const aboveAvg   = topicData.filter(d => d.classAvg != null && d.pct > d.classAvg + 5)
  const belowAvg   = topicData.filter(d => d.classAvg != null && d.pct < d.classAvg - 5)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
      {/* Strengths */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5">
        <p className="text-xs font-bold text-emerald-700 mb-2">✅ Strengths (≥80%)</p>
        {strengths.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {strengths.map(d => (
              <span key={d.topic} className="text-[11px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300 px-2 py-0.5 rounded-full">
                {d.topic} · {d.pct}%
              </span>
            ))}
          </div>
        ) : <p className="text-[11px] text-emerald-600/60 italic">No topics at ≥80% yet</p>}
      </div>

      {/* Weaknesses */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-3.5">
        <p className="text-xs font-bold text-red-700 mb-2">⚠️ Needs work (&lt;60%)</p>
        {weaknesses.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {weaknesses.map(d => (
              <span key={d.topic} className="text-[11px] font-semibold bg-red-100 text-red-700 border border-red-300 px-2 py-0.5 rounded-full">
                {d.topic} · {d.pct}%
              </span>
            ))}
          </div>
        ) : <p className="text-[11px] text-red-600/60 italic">No topics below 60% 🎉</p>}
      </div>

      {/* Above / below class avg */}
      {(aboveAvg.length > 0 || belowAvg.length > 0) && (
        <div className="bg-[#F0F4FF] border border-[#DEE7FF] rounded-xl p-3.5">
          <p className="text-xs font-bold text-[#325099] mb-2">📊 vs class average</p>
          {aboveAvg.length > 0 && (
            <div className="mb-1.5">
              <span className="text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wide">Above avg</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {aboveAvg.map(d => (
                  <span key={d.topic} className="text-[11px] font-semibold bg-white text-[#325099] border border-[#C7D5F8] px-2 py-0.5 rounded-full">
                    ↑ {d.topic} (+{d.pct - d.classAvg}%)
                  </span>
                ))}
              </div>
            </div>
          )}
          {belowAvg.length > 0 && (
            <div>
              <span className="text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wide">Below avg</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {belowAvg.map(d => (
                  <span key={d.topic} className="text-[11px] font-semibold bg-white text-[#7C3AED]/80 border border-[#DDD6FE] px-2 py-0.5 rounded-full">
                    ↓ {d.topic} ({d.pct - d.classAvg}%)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Silly mistakes */}
      {totalSM > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5">
          <p className="text-xs font-bold text-amber-700 mb-1">✏️ Silly mistake impact</p>
          <p className="text-[11px] text-amber-700">
            <strong>{totalSM} mark{totalSM !== 1 ? 's' : ''}</strong> lost to silly mistakes across all topics.
          </p>
          <p className="text-[11px] text-amber-600 mt-0.5">Focus on checking work carefully before submitting.</p>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ExamSection({ classId, termId, termNumber, roster, canEdit }) {
  const [topics,        setTopics]        = useState([])
  const [marks,         setMarks]         = useState({ '1': {}, '2': {} })
  const [sillyMistakes, setSillyMistakes] = useState({ '1': {}, '2': {} })
  const [maxScores,     setMaxScores]     = useState({ '1': {}, '2': {} })
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [error,         setError]         = useState(null)
  const [expanded,      setExpanded]      = useState(null)
  // Per-section silly mistake toggle
  const [showSM, setShowSM] = useState({ '1': false, '2': false })

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!classId || !termNumber) return
    supabase
      .from('class_booklet_assignments')
      .select('booklet_id, booklets(topic)')
      .eq('class_id', classId)
      .eq('term_number', termNumber)
      .then(async ({ data: cbaRows }) => {
        if (!cbaRows?.length) { setLoading(false); return }
        const uniqueTopics = [...new Set(
          (cbaRows || []).map(r => r.booklets?.topic).filter(t => t && t !== 'Exam')
        )]
        setTopics(uniqueTopics)

        const { data: existing } = await supabase
          .from('exam_marks')
          .select('student_id, topic, section, score, max_score, silly_mistakes')
          .eq('class_id', classId)
          .eq('term_id', termId)

        const mMap  = { '1': {}, '2': {} }
        const smMap = { '1': {}, '2': {} }
        const xMap  = { '1': {}, '2': {} }
        for (const m of existing || []) {
          const sec = m.section || '2'
          if (!mMap[sec][m.student_id])  mMap[sec][m.student_id]  = {}
          if (!smMap[sec][m.student_id]) smMap[sec][m.student_id] = {}
          mMap[sec][m.student_id][m.topic]  = m.score ?? ''
          smMap[sec][m.student_id][m.topic] = m.silly_mistakes ?? 0
          xMap[sec][m.topic] = m.max_score
        }
        setMarks(mMap)
        setSillyMistakes(smMap)
        setMaxScores(xMap)
        setLoading(false)
      })
  }, [classId, termId, termNumber])

  const handleChange = (sectionId, studentId, topic, value) => {
    setMarks(prev => ({
      ...prev,
      [sectionId]: { ...prev[sectionId], [studentId]: { ...(prev[sectionId]?.[studentId] || {}), [topic]: value } },
    }))
  }

  const handleSMChange = (sectionId, studentId, topic, value) => {
    setSillyMistakes(prev => ({
      ...prev,
      [sectionId]: { ...prev[sectionId], [studentId]: { ...(prev[sectionId]?.[studentId] || {}), [topic]: value } },
    }))
  }

  const handleMaxChange = (sectionId, topic, value) => {
    setMaxScores(prev => ({ ...prev, [sectionId]: { ...prev[sectionId], [topic]: value } }))
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true); setError(null)
    try {
      const upserts = []
      for (const sec of SECTIONS) {
        for (const student of roster) {
          for (const topic of topics) {
            const score = marks[sec.id]?.[student.id]?.[topic]
            const sm    = Number(sillyMistakes[sec.id]?.[student.id]?.[topic] ?? 0)
            const max   = Number(maxScores[sec.id]?.[topic] ?? 0)
            if (score === '' || score == null || !max) continue
            upserts.push({
              class_id: classId, term_id: termId,
              student_id: student.id, topic, section: sec.id,
              score: Number(score), max_score: max,
              silly_mistakes: sm,
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
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }, [classId, termId, roster, topics, marks, sillyMistakes, maxScores])

  // ── Chart data ─────────────────────────────────────────────────────────────

  // Class average per topic (both sections separately + combined)
  const classChartData = topics.map(topic => {
    const entry = { topic }
    for (const sec of SECTIONS) {
      const max  = Number(maxScores[sec.id]?.[topic] ?? 0)
      if (!max) continue
      const vals = roster.map(s => pct(marks[sec.id]?.[s.id]?.[topic], max)).filter(p => p != null)
      entry[`s${sec.id}`] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
    }
    // Combined class avg for this topic
    let totalScore = 0, totalMax = 0
    for (const sec of SECTIONS) {
      const max = Number(maxScores[sec.id]?.[topic] ?? 0)
      if (!max) continue
      for (const s of roster) {
        const v = marks[sec.id]?.[s.id]?.[topic]
        if (v != null && v !== '') { totalScore += Number(v); totalMax += max }
      }
    }
    entry.classAvg = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : null
    return entry
  })

  // Per-student chart data with class avg overlay
  const studentChartData = (studentId) => topics.map(topic => {
    const entry = { topic }
    for (const sec of SECTIONS) {
      const max = Number(maxScores[sec.id]?.[topic] ?? 0)
      entry[`s${sec.id}`]        = max ? pct(marks[sec.id]?.[studentId]?.[topic], max) : null
      entry[`s${sec.id}ClassAvg`] = classChartData.find(d => d.topic === topic)?.[`s${sec.id}`] ?? null
    }
    return entry
  })

  const studentOverall = (studentId) => {
    let totalScore = 0, totalMax = 0
    for (const sec of SECTIONS) {
      for (const topic of topics) {
        const max   = Number(maxScores[sec.id]?.[topic] ?? 0)
        const score = marks[sec.id]?.[studentId]?.[topic]
        if (max && score != null && score !== '') { totalScore += Number(score); totalMax += max }
      }
    }
    return totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : null
  }

  const studentSMTotal = (studentId) =>
    SECTIONS.reduce((sum, sec) =>
      sum + topics.reduce((s2, t) => s2 + Number(sillyMistakes[sec.id]?.[studentId]?.[t] ?? 0), 0), 0)

  // ── Render ─────────────────────────────────────────────────────────────────
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
          sillyMistakes={sillyMistakes}
          maxScores={maxScores}
          canEdit={canEdit}
          showSM={showSM[sec.id]}
          onToggleSM={() => setShowSM(prev => ({ ...prev, [sec.id]: !prev[sec.id] }))}
          onChange={handleChange}
          onSMChange={handleSMChange}
          onMaxChange={handleMaxChange}
        />
      ))}

      {/* Class summary table */}
      <ClassSummaryTable
        roster={roster}
        marks={marks}
        sillyMistakes={sillyMistakes}
        maxScores={maxScores}
        topics={topics}
      />

      {/* Class average chart */}
      <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
        <h3 className="font-bold text-sm text-[#062E63] mb-1">Class average by topic</h3>
        <p className="text-[11px] text-[#325099]/50 mb-4">S1 = Multiple Choice · S2 = Short Answer · dashed lines: 60% and 80% thresholds</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={classChartData} margin={{ top: 4, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F4FF" />
            <XAxis dataKey="topic" tick={{ fontSize: 11, fill: '#325099' }} angle={0} textAnchor="middle" interval={0} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#325099' }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            <ReferenceLine y={80} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1.5} />
            <ReferenceLine y={60} stroke="#F59E0B" strokeDasharray="4 2" strokeWidth={1.5} />
            <Bar dataKey="s1" name="S1 — MC"           fill={SECTIONS[0].color} radius={[3,3,0,0]} />
            <Bar dataKey="s2" name="S2 — Short Answer"  fill={SECTIONS[1].color} radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Individual student cards */}
      <div className="space-y-3">
        <h3 className="font-bold text-sm text-[#062E63]">Individual performance</h3>
        {roster.map(student => {
          const data    = studentChartData(student.id)
          const overall = studentOverall(student.id)
          const smTotal = studentSMTotal(student.id)
          const hasData = data.some(d => d.s1 != null || d.s2 != null)

          // Per-section raw totals for header badges
          const sectionTotals = SECTIONS.map(sec => {
            let score = 0, max = 0
            for (const t of topics) {
              const m = Number(maxScores[sec.id]?.[t] ?? 0)
              const v = marks[sec.id]?.[student.id]?.[t]
              if (m && v != null && v !== '') { score += Number(v); max += m }
            }
            return max > 0 ? { ...sec, score, max, pct: Math.round((score / max) * 100) } : null
          }).filter(Boolean)

          return (
            <div key={student.id} className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
              <button
                className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-[#F8FAFF] transition"
                onClick={() => setExpanded(e => e === student.id ? null : student.id)}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-[#062E63]">{student.full_name}</span>
                  {/* Section badges */}
                  {sectionTotals.map(st => (
                    <span key={st.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                      style={{ color: st.color, background: `${st.color}15`, borderColor: `${st.color}40` }}>
                      S{st.id}: {st.score}/{st.max} ({st.pct}%)
                    </span>
                  ))}
                  {overall != null && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ background: scoreBg(overall), color: scoreColor(overall) }}>
                      {overall}% overall
                    </span>
                  )}
                  {smTotal > 0 && (
                    <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      ✏️ {smTotal} SM
                    </span>
                  )}
                  {!hasData && <span className="text-[11px] text-[#325099]/40 italic">No marks entered</span>}
                </div>
                <span className="text-[#325099]/40 text-sm flex-shrink-0">{expanded === student.id ? '▲' : '▼'}</span>
              </button>

              {expanded === student.id && (
                <div className="border-t border-[#DEE7FF] px-5 py-5">
                  {!hasData ? (
                    <p className="text-xs text-[#325099]/40 italic text-center py-4">No marks entered yet.</p>
                  ) : (
                    <>
                      {/* Chart: student bars + class avg line */}
                      <p className="text-[11px] text-[#325099]/50 mb-3">Bars = student · Dots = class average</p>
                      <ResponsiveContainer width="100%" height={220}>
                        <ComposedChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F0F4FF" />
                          <XAxis dataKey="topic" tick={{ fontSize: 11, fill: '#325099' }} angle={0} textAnchor="middle" interval={0} />
                          <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#325099' }} />
                          <Tooltip content={<ChartTooltip />} />
                          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                          <ReferenceLine y={80} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1.5} />
                          <ReferenceLine y={60} stroke="#F59E0B" strokeDasharray="4 2" strokeWidth={1.5} />
                          <Bar dataKey="s1" name="S1 — MC"           fill={SECTIONS[0].color} radius={[3,3,0,0]} />
                          <Bar dataKey="s2" name="S2 — Short Answer"  fill={SECTIONS[1].color} radius={[3,3,0,0]} />
                        </ComposedChart>
                      </ResponsiveContainer>

                      {/* Strengths & weaknesses */}
                      <RecommendationsPanel
                        studentId={student.id}
                        topics={topics}
                        marks={marks}
                        sillyMistakes={sillyMistakes}
                        maxScores={maxScores}
                        classChartData={classChartData}
                      />
                    </>
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

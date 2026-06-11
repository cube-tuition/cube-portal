'use client'
import {
  ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip,
  ReferenceLine, Bar, ResponsiveContainer,
} from 'recharts'

const EXAM_SECTIONS = [
  { id: '1', label: 'S1', subtitle: 'Multiple Choice', color: '#325099' },
  { id: '2', label: 'S2', subtitle: 'Short Answer',    color: '#7C3AED' },
]

function examScoreColor(p) {
  if (p == null) return '#9CA3AF'
  if (p >= 80)   return '#10B981'
  if (p >= 60)   return '#F59E0B'
  return '#EF4444'
}
function examScoreBg(p) {
  if (p == null) return '#F3F4F6'
  if (p >= 80)   return '#D1FAE5'
  if (p >= 60)   return '#FEF3C7'
  return '#FEE2E2'
}
function examPct(score, max) {
  if (!max || score == null || score === '') return null
  return Math.round((Number(score) / Number(max)) * 100)
}

export function ExamAnalyticsReport({ student, roster, examData, col, rqAvg }) {
  if (!examData) return (
    <div className="rounded-xl border border-[#E8EDF8] bg-[#F9FAFD] px-4 py-3">
      <p className="text-[11px] text-[#2A2035]/35 italic">No exam data loaded.</p>
    </div>
  )

  const { topics, marks, sillyMistakes, maxScores } = examData

  const hasAny = EXAM_SECTIONS.some(sec =>
    topics.some(t => {
      const v = marks[sec.id]?.[student.id]?.[t]
      return v != null && v !== ''
    })
  )

  if (!hasAny || topics.length === 0) return (
    <div className="rounded-xl border border-[#E8EDF8] bg-[#F9FAFD] px-4 py-3">
      <p className="text-[11px] text-[#2A2035]/35 italic">No exam marks recorded for this term.</p>
    </div>
  )

  const sectionTotal = (secId) => {
    let score = 0, max = 0, sm = 0
    for (const t of topics) {
      const m = Number(maxScores[secId]?.[t] ?? 0)
      const v = marks[secId]?.[student.id]?.[t]
      const s = Number(sillyMistakes[secId]?.[student.id]?.[t] ?? 0)
      if (m && v != null && v !== '') { score += Number(v); max += m; sm += s }
    }
    return max > 0 ? { score, max, pct: Math.round((score / max) * 100), sm } : null
  }

  const overallTotal = () => {
    let score = 0, max = 0, sm = 0
    for (const sec of EXAM_SECTIONS) {
      const t = sectionTotal(sec.id)
      if (t) { score += t.score; max += t.max; sm += t.sm }
    }
    return max > 0 ? { score, max, pct: Math.round((score / max) * 100), sm } : null
  }
  const overall = overallTotal()

  const classAvgAt = (secId, topic) => {
    const max = Number(maxScores[secId]?.[topic] ?? 0)
    if (!max || !roster?.length) return null
    const vals = roster
      .map(s => examPct(marks[secId]?.[s.id]?.[topic], max))
      .filter(p => p != null)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  const chartData = topics.map(topic => {
    const entry = { topic }
    for (const sec of EXAM_SECTIONS) {
      const max = Number(maxScores[sec.id]?.[topic] ?? 0)
      entry[`s${sec.id}`]    = max ? examPct(marks[sec.id]?.[student.id]?.[topic], max) : null
      entry[`s${sec.id}Avg`] = classAvgAt(sec.id, topic)
    }
    return entry
  })

  const topicCombinedPct = (topic) => {
    let score = 0, max = 0
    for (const sec of EXAM_SECTIONS) {
      const m = Number(maxScores[sec.id]?.[topic] ?? 0)
      const v = marks[sec.id]?.[student.id]?.[topic]
      if (m && v != null && v !== '') { score += Number(v); max += m }
    }
    return max > 0 ? Math.round((score / max) * 100) : null
  }
  const topicList  = topics.map(t => ({ topic: t, pct: topicCombinedPct(t) })).filter(d => d.pct != null)
  const strengths  = topicList.filter(d => d.pct >= 80).sort((a, b) => b.pct - a.pct)
  const weaknesses = topicList.filter(d => d.pct < 60).sort((a, b) => a.pct - b.pct)
  const totalSM    = EXAM_SECTIONS.reduce((sum, sec) =>
    sum + topics.reduce((s2, t) => s2 + Number(sillyMistakes[sec.id]?.[student.id]?.[t] ?? 0), 0), 0)

  const expectedRange = (() => {
    if (rqAvg == null || overall == null) return null
    const centre = Math.round(rqAvg * 0.92)
    const lower  = Math.max(0,   centre - 10)
    const upper  = Math.min(100, centre + 10)
    const actual = overall.pct
    const status = actual > upper  ? 'exceeded'
                 : actual >= lower ? 'on_track'
                 : 'below'
    return { centre, lower, upper, actual, status }
  })()

  const ExamChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'white', border: '1px solid #DEE7FF', borderRadius: 8, padding: '8px 12px', fontSize: 10 }}>
        <p style={{ fontWeight: 700, color: '#062E63', marginBottom: 4 }}>{label}</p>
        {payload.map(p => (
          <p key={p.name} style={{ color: p.color ?? p.fill, margin: '2px 0' }}>
            {p.name}: <strong>{p.value != null ? `${p.value}%` : '—'}</strong>
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#E8EDF8] overflow-hidden">
      {/* Summary tiles */}
      <div className="grid divide-x divide-[#E8EDF8]" style={{ gridTemplateColumns: `repeat(${EXAM_SECTIONS.length + 2}, 1fr)` }}>
        {EXAM_SECTIONS.map(sec => {
          const t = sectionTotal(sec.id)
          return (
            <div key={sec.id} className="px-4 py-3 bg-[#F9FAFD]">
              <p className="text-[9px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: sec.color + 'AA' }}>
                {sec.label} — {sec.subtitle}
              </p>
              {t ? (
                <>
                  <p className="text-xl font-bold tabular-nums" style={{ color: examScoreColor(t.pct) }}>{t.pct}%</p>
                  <p className="text-[9px] mt-0.5" style={{ color: '#2A2035AA' }}>{t.score} / {t.max} marks</p>
                </>
              ) : <p className="text-lg font-bold text-[#CBD5E1]">—</p>}
            </div>
          )
        })}
        <div className="px-4 py-3 bg-[#F0F4FF]">
          <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#325099]/60 mb-1">Overall</p>
          {overall ? (
            <>
              <p className="text-xl font-bold tabular-nums" style={{ color: examScoreColor(overall.pct) }}>{overall.pct}%</p>
              <p className="text-[9px] mt-0.5 text-[#2A2035]/50">{overall.score} / {overall.max} marks</p>
            </>
          ) : <p className="text-lg font-bold text-[#CBD5E1]">—</p>}
        </div>
        <div className="px-4 py-3 bg-[#FFFBEB]">
          <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-amber-600/70 mb-1">Expected range</p>
          {expectedRange ? (
            <>
              <p className="text-xl font-bold tabular-nums text-amber-700">
                {expectedRange.lower}–{expectedRange.upper}%
              </p>
              <p className={`text-[9px] font-bold mt-0.5 ${
                expectedRange.status === 'exceeded' ? 'text-emerald-600' :
                expectedRange.status === 'on_track' ? 'text-[#325099]'  : 'text-amber-600'
              }`}>
                {expectedRange.status === 'exceeded' ? '↑ Exceeded'   :
                 expectedRange.status === 'on_track' ? '✓ On track'   : '↓ Below expected'}
              </p>
            </>
          ) : <p className="text-lg font-bold text-[#CBD5E1]">—</p>}
        </div>
      </div>

      {expectedRange && (
        <div className="border-t border-[#E8EDF8] px-4 py-2 bg-[#FFFBEB]/60 flex items-start gap-2">
          <span className="text-amber-500 text-[11px] mt-0.5">ⓘ</span>
          <p className="text-[9px] text-amber-800/70 leading-relaxed">
            <strong>Expected range</strong> is based on your revision quiz average of{' '}
            <strong>{rqAvg}%</strong> (RQ avg × 0.92, ±10 pp). It predicts a consistent exam
            performance of <strong>{expectedRange.lower}–{expectedRange.upper}%</strong> based
            solely on your own quiz work — it does not reflect any other student's results.
          </p>
        </div>
      )}

      <div className="border-t border-[#E8EDF8] px-4 pt-3 pb-1">
        <p className="text-[9px] font-semibold text-[#325099]/50 uppercase tracking-wider mb-2">
          Performance by topic · Bars = student · Dashed = class average
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F4FF" />
            <XAxis dataKey="topic" tick={{ fontSize: 9, fill: '#325099' }} interval={0} angle={0} textAnchor="middle" />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9, fill: '#325099' }} width={32} />
            <Tooltip content={<ExamChartTooltip />} />
            <ReferenceLine y={80} stroke="#10B981" strokeDasharray="3 2" strokeWidth={1} />
            <ReferenceLine y={60} stroke="#F59E0B" strokeDasharray="3 2" strokeWidth={1} />
            <Bar dataKey="s1" name="S1 (student)" fill={EXAM_SECTIONS[0].color} radius={[2,2,0,0]} maxBarSize={28} />
            <Bar dataKey="s2" name="S2 (student)" fill={EXAM_SECTIONS[1].color} radius={[2,2,0,0]} maxBarSize={28} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="border-t border-[#E8EDF8]">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="bg-[#F8FAFF] border-b border-[#E8EDF8]">
              <th className="text-left px-3 py-2 font-semibold text-[#6B7CB8]">Topic</th>
              {EXAM_SECTIONS.map(sec => (
                <th key={sec.id} className="text-center px-2 py-2 font-semibold" style={{ color: sec.color }}>
                  {sec.label}
                </th>
              ))}
              <th className="text-center px-2 py-2 font-semibold text-[#062E63]">Combined</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((topic, i) => {
              const combined = topicCombinedPct(topic)
              return (
                <tr key={topic} className={`border-b last:border-0 border-[#EEF1F9] ${i % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFD]'}`}>
                  <td className="px-3 py-1.5 font-medium text-[#3A3550]">{topic}</td>
                  {EXAM_SECTIONS.map(sec => {
                    const max   = Number(maxScores[sec.id]?.[topic] ?? 0)
                    const score = marks[sec.id]?.[student.id]?.[topic]
                    const p     = examPct(score, max)
                    const avg   = classAvgAt(sec.id, topic)
                    return (
                      <td key={sec.id} className="px-2 py-1.5 text-center">
                        {p != null ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-bold tabular-nums" style={{ color: examScoreColor(p) }}>{p}%</span>
                            <span className="text-[#325099]/40">{score}/{max}</span>
                            {avg != null && (
                              <span className="text-[8px]" style={{ color: p >= avg ? '#10B981' : '#EF4444' }}>
                                {p >= avg ? '↑' : '↓'} avg {avg}%
                              </span>
                            )}
                          </div>
                        ) : <span className="text-[#CBD5E1]">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1.5 text-center">
                    {combined != null ? (
                      <span className="inline-block font-bold text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ color: examScoreColor(combined), background: examScoreBg(combined) }}>
                        {combined}%
                      </span>
                    ) : <span className="text-[#CBD5E1]">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {(strengths.length > 0 || weaknesses.length > 0 || totalSM > 0) && (
        <div className="border-t border-[#E8EDF8] px-4 py-3 grid grid-cols-2 gap-3 bg-[#FAFBFF]">
          {strengths.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-emerald-700 uppercase tracking-wider mb-1.5">✅ Strengths (≥80%)</p>
              <div className="flex flex-wrap gap-1">
                {strengths.map(d => (
                  <span key={d.topic} className="text-[9px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300 px-1.5 py-0.5 rounded-full">
                    {d.topic} {d.pct}%
                  </span>
                ))}
              </div>
            </div>
          )}
          {weaknesses.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-red-700 uppercase tracking-wider mb-1.5">⚠️ Needs work (&lt;60%)</p>
              <div className="flex flex-wrap gap-1">
                {weaknesses.map(d => (
                  <span key={d.topic} className="text-[9px] font-semibold bg-red-100 text-red-700 border border-red-300 px-1.5 py-0.5 rounded-full">
                    {d.topic} {d.pct}%
                  </span>
                ))}
              </div>
            </div>
          )}
          {totalSM > 0 && (
            <div className="col-span-2 border-t border-[#E8EDF8] pt-2">
              <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wider mb-1">✏️ Silly mistakes</p>
              <p className="text-[10px] text-amber-700">
                <strong>{totalSM} mark{totalSM !== 1 ? 's' : ''}</strong> attributed to silly mistakes.
                {overall && overall.max > 0 && (
                  <> Without them: <strong>{Math.min(100, Math.round(((overall.score + totalSM) / overall.max) * 100))}%</strong></>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

/*
 * StudentExamAnalysisView — parent-friendly per-student exam breakdown.
 * Shared by the class Exams page (with a student dropdown) and the individual
 * student report. Each topic is shown as a simple progress bar with a plain
 * performance label, plus a faint marker for the class average (an aggregate,
 * so individual students' marks are never exposed).
 *
 * Props:
 *   studentName : string
 *   rows        : [{ topic, studentPct, classPct, studentAwarded, studentMax }]
 *   overall     : { awarded, max, pct }
 *   strengths   : string[]   topics scored >= 80%
 *   weaknesses  : string[]   topics scored < 60%
 */
const band = (p) => {
  if (p == null) return { color: '#9CA3AF', bg: '#F3F4F6', label: '—' }
  if (p >= 80) return { color: '#059669', bg: '#D1FAE5', label: 'Strong' }
  if (p >= 60) return { color: '#D97706', bg: '#FEF3C7', label: 'Solid' }
  return { color: '#DC2626', bg: '#FEE2E2', label: 'Needs focus' }
}

export default function StudentExamAnalysisView({ studentName, rows = [], overall = {}, sections = [], strengths = [], weaknesses = [] }) {
  const has = rows.some((r) => r.studentPct != null)
  if (!has) {
    return <p className="text-sm text-[#2A2035]/45 italic">No exam marks recorded for {studentName || 'this student'} yet.</p>
  }
  const ov = band(overall.pct)
  const hasClass = rows.some((r) => r.classPct != null)

  return (
    <div className="space-y-4">
      {/* Overall headline */}
      <div className="rounded-xl px-4 py-3" style={{ background: ov.bg }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: ov.color }}>Overall result</p>
            {studentName && <p className="text-xs text-[#2A2035]/55">{studentName}</p>}
          </div>
          {overall.pct != null && (
            <p className="text-right">
              <span className="text-2xl font-bold" style={{ color: ov.color }}>{overall.pct}%</span>
              <span className="block text-xs text-[#2A2035]/55">{overall.awarded} out of {overall.max} marks</span>
            </p>
          )}
        </div>
        {sections.length > 0 && (
          <div className="grid gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'rgba(0,0,0,0.08)', gridTemplateColumns: `repeat(${Math.min(sections.length, 4)}, minmax(0,1fr))` }}>
            {sections.map((s) => {
              const sb = band(s.pct)
              return (
                <div key={s.section} className="text-center">
                  <p className="text-[10px] font-semibold text-[#2A2035]/55 truncate" title={s.section}>{s.section.split(' · ')[0]}</p>
                  <p className="text-sm font-bold" style={{ color: sb.color }}>{s.awarded}/{s.max}</p>
                  <p className="text-[10px] text-[#2A2035]/45">{s.pct == null ? '–' : `${s.pct}%`}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Per-topic bars */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#2A2035]/45 mb-2">By topic</p>
        <div className="space-y-3">
          {rows.map((r) => {
            const b = band(r.studentPct)
            const w = Math.max(0, Math.min(100, r.studentPct ?? 0))
            return (
              <div key={r.topic}>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-[#2A2035]">{r.topic}</span>
                  <span className="flex items-baseline gap-2 whitespace-nowrap">
                    {r.studentMax ? <span className="text-xs text-[#2A2035]/45">{r.studentAwarded}/{r.studentMax}</span> : null}
                    <span className="text-sm font-bold" style={{ color: b.color }}>{r.studentPct == null ? '–' : `${r.studentPct}%`}</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: b.bg, color: b.color }}>{b.label}</span>
                  </span>
                </div>
                <div className="relative h-3 rounded-full bg-[#EEF2F7]">
                  <div className="h-3 rounded-full" style={{ width: `${w}%`, background: b.color }} />
                  {r.classPct != null && (
                    <div title={`Class average ${r.classPct}%`}
                      className="absolute -top-[3px] h-[18px] w-[2px] bg-[#475569] rounded"
                      style={{ left: `calc(${Math.max(0, Math.min(100, r.classPct))}% - 1px)` }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {hasClass && (
          <p className="text-[11px] text-[#2A2035]/40 mt-2 flex items-center gap-1.5">
            <span className="inline-block h-[12px] w-[2px] bg-[#475569] rounded" /> marks the class average
          </p>
        )}
      </div>

      {/* Plain-language summary */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-[#D1FAE5] bg-[#ECFDF5] p-3">
          <p className="text-xs font-bold text-[#047857] mb-1">Doing well in</p>
          <p className="text-sm text-[#065F46]">{strengths.length ? strengths.join(', ') : 'Keep working across all topics.'}</p>
        </div>
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3">
          <p className="text-xs font-bold text-[#B91C1C] mb-1">Areas to focus on</p>
          <p className="text-sm text-[#991B1B]">{weaknesses.length ? weaknesses.join(', ') : 'No major gaps — solid across the board.'}</p>
        </div>
      </div>
    </div>
  )
}

// Helper: build the view's props for one student from the exam analysis object.
export function studentAnalysisRows(analysis, studentId) {
  const ps = analysis?.perStudent?.[studentId] || { topics: {}, awarded: 0, max: 0 }
  // With ≤2 students the class average is an average of one other child — showing
  // it would expose their result — so suppress it entirely for small cohorts.
  const showClassAvg = (analysis?.studentCount ?? Infinity) > 2
  const classByTopic = showClassAvg
    ? Object.fromEntries((analysis?.topics || []).map((t) => [t.topic, t.pct]))
    : {}
  const rows = (analysis?.orderedTopics || []).map((topic) => {
    const cell = ps.topics[topic]
    const studentPct = cell && cell.max ? Math.round((cell.awarded / cell.max) * 100) : null
    return {
      topic,
      studentPct,
      classPct: classByTopic[topic] ?? null,
      studentAwarded: cell?.awarded ?? 0,
      studentMax: cell?.max ?? 0,
    }
  })
  const overallPct = ps.max ? Math.round((ps.awarded / ps.max) * 100) : null
  const sections = (analysis?.orderedSections || []).map((sec) => {
    const cell = ps.sections?.[sec]
    return { section: sec, awarded: cell?.awarded ?? 0, max: cell?.max ?? 0, pct: cell?.max ? Math.round((cell.awarded / cell.max) * 100) : null }
  }).filter((s) => s.max > 0)
  return {
    rows,
    overall: { awarded: ps.awarded, max: ps.max, pct: overallPct },
    sections,
    strengths: rows.filter((r) => r.studentPct != null && r.studentPct >= 80).map((r) => r.topic),
    weaknesses: rows.filter((r) => r.studentPct != null && r.studentPct < 60).map((r) => r.topic),
  }
}

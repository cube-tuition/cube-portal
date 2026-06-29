'use client'
import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Bar, ComposedChart, Cell,
} from 'recharts'
import { inferSubject, subjectColor } from '../CourseDetail'
import { formatTermLabel } from '../../lib/terms'
import StudentExamAnalysisView, { studentAnalysisRows } from '../StudentExamAnalysisView'
import { PrePostCharts } from '../PrePostSection'

const ATT_COLOR = {
  present: '#10b981',
  late:    '#f59e0b',
  absent:  '#ef4444',
  makeup:  '#8b5cf6',
  excused: '#6366f1',
  none:    '#D1D5DB',
}
const HW_NUMERIC = { A: 5, B: 4, C: 3, D: 2, E: 1 }
const HW_LABEL   = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E' }

const CRITERIA_FIELDS = [
  { key: 'subject_knowledge',   label: 'Subject Knowledge & Understanding' },
  { key: 'class_participation', label: 'Class Participation & Engagement' },
  { key: 'class_behaviour',     label: 'Class Behaviour' },
  { key: 'homework_effort',     label: 'Homework Effort & Completion' },
]
const GRADE_STYLE = {
  A: { solid: '#10B981' },
  B: { solid: '#325099' },
  C: { solid: '#F59E0B' },
  D: { solid: '#EF4444' },
}

function isoToDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number)
  if (!y) return null
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}
function weekNumber(date, term) {
  if (!date || !term) return null
  const start = isoToDate(term.start_date)
  if (!start) return null
  const ms = date.getTime() - start.getTime()
  if (ms < 0) return null
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 7)) + 1
}

function StatBox({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] px-4 py-3">
      <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">{label}</p>
      <p className="text-xl font-bold text-[#2A2035] font-display tabular-nums leading-none">{value}</p>
      <p className="text-[10px] text-[#2A2035]/55 mt-1">{sub}</p>
    </div>
  )
}

export function StudentReport({ student, cls, term, roster, attendance, quizzes, comment, criteria, prepost, examData, rqByWeek = {}, isLast }) {
  const col = subjectColor(inferSubject(cls))

  const weekly = useMemo(() => {
    const attByWeek = new Map()
    for (const a of attendance) {
      const w = weekNumber(isoToDate(a.session_date), term)
      if (!w) continue
      // A cancelled lesson still counts as an absence for the trend/report.
      const order = { absent: 3, cancelled: 3, late: 2, excused: 1, makeup: 1, present: 0 }
      const prev = attByWeek.get(w)
      if (!prev || (order[a.status] || 0) > (order[prev.status] || 0)) attByWeek.set(w, a)
    }
    const quizByWeek = new Map()
    for (const q of quizzes) {
      const m = String(q.week || '').match(/(\d+)/)
      if (!m) continue
      quizByWeek.set(parseInt(m[1], 10), q)
    }
    const out = []
    for (let w = 1; w <= 10; w++) {
      const att  = attByWeek.get(w)
      const quiz = quizByWeek.get(w)
      const noRq = rqByWeek[w] === false   // class had no revision quiz this week
      // Suppress the score for no-RQ weeks so the trend line doesn't plot a
      // point (matches the table/stats, which already exclude these weeks).
      const score = !noRq && quiz?.score != null && quiz?.max_score
        ? Math.round((quiz.score / quiz.max_score) * 100) : null
      // Treat a cancelled lesson as an absence on the trend/report.
      const status = att?.status === 'cancelled' ? 'absent' : (att?.status || null)
      const hw = quiz?.homework_grade || null
      out.push({
        week: `Wk ${w}`, score,
        // Full-height shaded band for any recorded status (coloured per status by
        // the chart's Cell), so absences show as a red band rather than nothing.
        attended: status ? 1 : null,
        status, hw, hwNum: hw ? HW_NUMERIC[hw] || null : null,
        noRq,   // class had no revision quiz this week
      })
    }
    return out
  }, [attendance, quizzes, term, rqByWeek])

  const stats = useMemo(() => {
    const scored = quizzes.filter(q => {
      if (q.score == null || !q.max_score) return false
      const m = String(q.week || '').match(/(\d+)/)
      const w = m ? parseInt(m[1], 10) : null
      return !(w != null && rqByWeek[w] === false)   // exclude weeks marked 'No RQ'
    })
    const avgRq  = scored.length
      ? Math.round(scored.reduce((a, q) => a + (q.score / q.max_score) * 100, 0) / scored.length) : null
    const attTotal   = attendance.length
    const attPresent = attendance.filter(a => a.status === 'present' || a.status === 'late' || a.status === 'makeup').length
    const attPct  = attTotal ? Math.round((attPresent / attTotal) * 100) : null
    const hwTotal = quizzes.length
    const hwGrades = quizzes.map(q => q.homework_grade).filter(Boolean)
    const hwFreq = {}
    for (const g of hwGrades) hwFreq[g] = (hwFreq[g] || 0) + 1
    let hwMode = null, hwModeCount = 0
    for (const [g, c] of Object.entries(hwFreq)) {
      if (c > hwModeCount) { hwModeCount = c; hwMode = g }
    }
    return { avgRq, attPct, attTotal, hwMode, hwTotal, scoredCount: scored.length }
  }, [quizzes, attendance, rqByWeek])

  // Each report page is rasterised to one A4 image and clipped if it overflows,
  // so a long teacher comment pushes the pre/post bar charts off the bottom of
  // page 1. When the comment is long AND there are charts to show, give the
  // pre/post section its own page — the later pages are unaffected.
  const commentText = (comment || '').trim()
  const estCommentLines = commentText
    ? commentText.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 95)), 0)
    : 0
  // Only this student's OWN pre/post charts make the section tall enough to risk
  // overflowing page 1. A student with no pre/post data just shows a small
  // "no data" box that always fits, so it must never get its own page —
  // regardless of whether the class as a whole has data (prepost.classAvg).
  const ppScores = prepost?.scores?.[student.id]
  const studentHasPrePost =
    (ppScores?.pre  || []).some(v => v != null && v !== '') ||
    (ppScores?.post || []).some(v => v != null && v !== '')
  const prePostOwnPage = estCommentLines > 5 && studentHasPrePost && !!prepost?.classAvg
  const totalPages = prePostOwnPage ? 3 : 2

  const reportHeader = (pageNum) => (
    <header className="flex items-start justify-between gap-4 border-b border-[#DEE7FF] pb-4 mb-5">
      <div className="min-w-0">
        <p className="text-[10px] tracking-[0.3em] uppercase font-semibold font-display mb-1" style={{ color: col.fg }}>
          End-of-term report · {term ? formatTermLabel(term) : ''} · Page {pageNum} of {totalPages}
        </p>
        <h1 className="text-2xl font-bold text-[#2A2035] font-display leading-tight">
          {student.full_name || 'Unknown student'}
        </h1>
        <p className="text-xs text-[#2A2035]/60 mt-0.5">
          {student.school || ''}{student.year ? ` · Year ${student.year}` : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-[#2A2035]">
          {cls.class_name}{cls.teacher ? ` with ${cls.teacher}` : ''}
        </p>
      </div>
    </header>
  )

  const pageFooter = (
    <footer className="mt-auto pt-3 border-t border-[#DEE7FF] flex items-center justify-between text-[10px] text-[#2A2035]/50">
      <span>CUBE Tuition · Chatswood</span>
      <span>{cls.class_name} · {term ? formatTermLabel(term) : ''}</span>
    </footer>
  )

  // The Pre / Post Test section — rendered inline on page 1 normally, or on its
  // own page when the teacher comment is long (see prePostOwnPage above).
  const prePostBlock = (() => {
    const topics     = prepost?.topics || []
    const totalMarks = prepost?.totalMarks || 0
    const studentPP  = prepost?.scores?.[student.id]
    const preScores  = studentPP?.pre  || []
    const postScores = studentPP?.post || []
    const hasPreData  = preScores.some(s => s != null && s !== '')
    const hasPostData = postScores.some(s => s != null && s !== '')
    // Did the post-test actually run for the class? (some classmate has a
    // post mark) — so a blank post mark here means this student was
    // absent, not that marks simply haven't been entered yet.
    const classHasPost = Object.values(prepost?.scores || {})
      .some(s => (s?.post || []).some(v => v != null && v !== ''))
    const preTotal   = hasPreData  ? preScores.reduce((a, b) => a + (b != null ? Number(b) : 0), 0) : null
    const postTotal  = hasPostData ? postScores.reduce((a, b) => a + (b != null ? Number(b) : 0), 0) : null
    const prePct     = preTotal  != null && totalMarks ? Math.round((preTotal  / totalMarks) * 100) : null
    const postPct    = postTotal != null && totalMarks ? Math.round((postTotal / totalMarks) * 100) : null
    const improvement = prePct != null && postPct != null ? postPct - prePct : null

    return (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1 h-4 rounded-full" style={{ background: col.fg }} />
          <h2 className="text-[12px] font-bold tracking-[0.25em] uppercase" style={{ color: col.fg }}>Pre / Post Test</h2>
        </div>
        <p className="text-[11px] text-[#2A2035]/55 leading-relaxed mb-3 -mt-1">
          The same short diagnostic test is given at the start and again at the end of the term. Comparing the two shows how much your child has improved across each topic over the term.
        </p>
        {!prepost || (!hasPreData && !hasPostData) ? (
          <div className="rounded-xl border border-[#E8EDF8] bg-[#F9FAFD] px-4 py-3">
            <p className="text-[11px] text-[#2A2035]/35 italic">No pre/post test data recorded for this term.</p>
          </div>
        ) : (
          <>
          <div className="rounded-xl border border-[#E8EDF8] overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-[#E8EDF8]">
              <div className="px-4 py-3 bg-[#FEF2F2]">
                <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#EF4444]/70 mb-1">Pre-test</p>
                <p className="text-xl font-bold text-[#EF4444] tabular-nums">{prePct != null ? `${prePct}%` : '—'}</p>
                {preTotal != null && <p className="text-[9px] text-[#2A2035]/50 mt-0.5">{preTotal} / {totalMarks} marks</p>}
              </div>
              <div className="px-4 py-3 bg-[#EFF6FF]">
                <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#325099]/70 mb-1">Post-test</p>
                <p className="text-xl font-bold text-[#325099] tabular-nums">{postPct != null ? `${postPct}%` : '—'}</p>
                {postTotal != null && <p className="text-[9px] text-[#2A2035]/50 mt-0.5">{postTotal} / {totalMarks} marks</p>}
              </div>
              <div className={`px-4 py-3 ${improvement == null ? 'bg-[#F9FAFD]' : improvement >= 0 ? 'bg-[#F0FDF4]' : 'bg-[#FFF7ED]'}`}>
                <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#2A2035]/50 mb-1">Improvement</p>
                <p className="text-xl font-bold tabular-nums" style={{ color: improvement == null ? '#9CA3AF' : improvement >= 0 ? '#10B981' : '#F59E0B' }}>
                  {improvement == null ? '—' : `${improvement >= 0 ? '+' : ''}${improvement}pp`}
                </p>
                {improvement != null && <p className="text-[9px] text-[#2A2035]/50 mt-0.5">percentage points</p>}
              </div>
            </div>
          </div>
          {!hasPostData && classHasPost && (
            <p className="text-[11px] text-[#2A2035]/55 italic mt-2">
              Post-test mark not recorded — the student was absent for the post-test.
            </p>
          )}
          {prepost?.classAvg && (
            <div className="mt-4">
              <PrePostCharts student={student} topics={topics} totalMarks={totalMarks}
                scoresMap={prepost.scores} classAvg={prepost.classAvg}
                expectedPre={prepost.expectedPre} expectedPost={prepost.expectedPost} />
            </div>
          )}
          </>
        )}
      </section>
    )
  })()

  return (
    <div id={`student-report-${student.id}`}>
      {/* ── PAGE 1: Stats + Criteria + Teacher comment ── */}
      <article className="report-page bg-white rounded-2xl border border-[#DEE7FF] p-8 mb-4">
        {reportHeader(1)}

        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatBox label="Quiz average" value={stats.avgRq != null ? `${stats.avgRq}%` : '—'} sub={`${stats.scoredCount} quiz${stats.scoredCount === 1 ? '' : 'zes'}`} />
          <StatBox label="Average HWK grade" value={stats.hwMode ?? '—'} sub={`${stats.hwTotal} week${stats.hwTotal === 1 ? '' : 's'} logged`} />
          <StatBox label="Attendance" value={stats.attPct != null ? `${stats.attPct}%` : '—'} sub={`${stats.attTotal} session${stats.attTotal === 1 ? '' : 's'}`} />
        </div>

        <div className="space-y-5 mb-2">
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded-full" style={{ background: col.fg }} />
              <h2 className="text-[12px] font-bold tracking-[0.25em] uppercase" style={{ color: col.fg }}>Student Criteria</h2>
            </div>
            <div className="rounded-xl overflow-hidden border border-[#E8EDF8]">
              <div className="grid grid-cols-[1fr_repeat(4,2rem)] bg-[#F4F7FF] px-3 py-2 border-b border-[#E8EDF8]">
                <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#6B7CB8]">Criterion</span>
                {['A','B','C','D'].map(g => (
                  <span key={g} className="text-[9px] font-bold tracking-[0.15em] uppercase text-[#6B7CB8] text-center">{g}</span>
                ))}
              </div>
              {CRITERIA_FIELDS.map((c, ci) => {
                const grade = criteria[c.key] || null
                return (
                  <div key={c.key} className={`grid grid-cols-[1fr_repeat(4,2rem)] items-center px-3 py-2.5 border-b last:border-0 border-[#EEF1F9] ${ci % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFD]'}`}>
                    <span className="text-[11px] text-[#3A3550] leading-snug pr-2">{c.label}</span>
                    {['A','B','C','D'].map(g => {
                      const active = grade === g
                      const st = GRADE_STYLE[g]
                      return (
                        <div key={g} className="flex items-center justify-center">
                          {active ? (
                            <span className="w-6 h-6 rounded-full flex items-center justify-center shadow-sm" style={{ background: st.solid }}>
                              <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                                <path d="M1 4L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </span>
                          ) : (
                            <span className="w-6 h-6 rounded-full border-2" style={{ borderColor: st.solid + '40', background: st.solid + '0D' }} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded-full" style={{ background: col.fg }} />
              <h2 className="text-[12px] font-bold tracking-[0.25em] uppercase" style={{ color: col.fg }}>Teacher Comment</h2>
            </div>
            <div className="rounded-xl border border-[#E8EDF8] bg-[#F9FAFD] p-4 relative overflow-hidden">
              <span className="absolute top-2 right-3 text-5xl font-serif leading-none select-none pointer-events-none" style={{ color: col.fg + '18' }}>"</span>
              {comment.trim() ? (
                <p className="text-[14px] text-[#2A2035] leading-relaxed whitespace-pre-wrap relative z-10">{comment}</p>
              ) : (
                <p className="text-[13px] text-[#2A2035]/35 italic relative z-10">No comment recorded for this term.</p>
              )}
              {cls.teacher && (
                <p className="mt-3 pt-3 border-t border-[#E8EDF8] text-[10px] font-semibold tracking-[0.15em] uppercase" style={{ color: col.fg + 'BB' }}>
                  — {cls.teacher}
                </p>
              )}
            </div>
          </section>

          {!prePostOwnPage && prePostBlock}
        </div>

        {pageFooter}
      </article>

      {/* ── Pre / Post Test on its own page (long teacher comment only) ── */}
      {prePostOwnPage && (
        <article className="report-page bg-white rounded-2xl border border-[#DEE7FF] p-8 mb-4">
          {reportHeader(2)}
          {prePostBlock}
          {pageFooter}
        </article>
      )}

      {/* ── FINAL PAGE: Class tracker + Exam analytics ── */}
      <article className={`report-page bg-white rounded-2xl border border-[#DEE7FF] p-8 ${isLast ? '' : 'mb-8'}`}>
        {reportHeader(totalPages)}

        <section className="mb-6">
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-[#325099] mb-1">Revision quiz trend</h2>
          <p className="text-xs text-[#2A2035]/60 mb-3">
            RQ % per week (Wk 2–9) · attendance shaded · previous week's HWK grade shown below each week
          </p>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <ComposedChart
                data={weekly.filter(d => d.week !== 'Wk 1' && d.week !== 'Wk 10')}
                margin={{ top: 8, right: 20, bottom: 8, left: 12 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#DEE7FF" />
                <XAxis
                  dataKey="week"
                  height={52}
                  interval={0}
                  stroke="#DEE7FF"
                  tick={(props) => {
                    const { x, y, payload } = props
                    const wd = weekly.find(d => d.week === payload.value)
                    const hw = wd?.hw || null
                    const hwStyle = {
                      A: { bg: '#D1FAE5', fg: '#065F46' },
                      B: { bg: '#DEE7FF', fg: '#062E63' },
                      C: { bg: '#FEF3C7', fg: '#92400E' },
                      D: { bg: '#FFEDD5', fg: '#9A3412' },
                      E: { bg: '#FEE2E2', fg: '#991B1B' },
                    }
                    const c = hw ? hwStyle[hw] : null
                    return (
                      <g transform={`translate(${x},${y})`}>
                        <text x={0} y={0} dy={13} textAnchor="middle" fill="#6B7280" fontSize={10}>{payload.value}</text>
                        {c ? (
                          <>
                            <rect x={-11} y={18} width={22} height={15} rx={5} fill={c.bg} />
                            <text x={0} y={29} textAnchor="middle" fill={c.fg} fontSize={9} fontWeight="bold">{hw}</text>
                          </>
                        ) : (
                          <text x={0} y={30} textAnchor="middle" fill="#CBD5E1" fontSize={9}>—</text>
                        )}
                      </g>
                    )
                  }}
                />
                <YAxis
                  yAxisId="score"
                  type="number"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  interval={0}
                  tickFormatter={v => `${v}%`}
                  tick={{ fontSize: 11, fill: '#1F2937', fontWeight: 600 }}
                  tickMargin={6}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={{ stroke: '#CBD5E1' }}
                  width={46}
                />
                <YAxis yAxisId="att" orientation="right" hide domain={[0, 1]} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]?.payload || {}
                    return (
                      <div className="bg-white border border-[#DEE7FF] rounded-xl p-3 text-xs shadow-lg">
                        <p className="font-semibold text-[#2A2035] mb-1">{label}</p>
                        <p>RQ score: {row.noRq ? 'No RQ' : (row.score == null ? '—' : `${row.score}%`)}</p>
                        <p>Prev week's HWK: {row.hw || '—'}</p>
                        <p>Attendance: {row.status || '—'}</p>
                      </div>
                    )
                  }}
                />
                <Bar yAxisId="att" dataKey="attended" barSize={40} fillOpacity={0.25}>
                  {weekly.filter(d => d.week !== 'Wk 1' && d.week !== 'Wk 10').map((d, i) => (
                    <Cell key={i} fill={ATT_COLOR[d.status] || ATT_COLOR.none} />
                  ))}
                </Bar>
                <Line
                  yAxisId="score"
                  type="monotone"
                  dataKey="score"
                  stroke={col.line}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: col.line, strokeWidth: 0 }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-[#2A2035]/70">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: col.line }} /> RQ score</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-40" style={{ background: ATT_COLOR.present }} /> Present</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-40" style={{ background: ATT_COLOR.late }} /> Late</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-40" style={{ background: ATT_COLOR.absent }} /> Absent</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-40" style={{ background: ATT_COLOR.makeup }} /> Makeup</span>
            <span className="text-[#2A2035]/40">·</span>
            <span className="text-[#2A2035]/60">Previous week's HWK badge below each week</span>
          </div>

          <table className="w-full text-xs mt-4 border-collapse">
            <thead>
              <tr className="bg-[#F8FAFF] border-y border-[#DEE7FF]">
                <th className="text-left px-3 py-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099] w-[14%]">Week</th>
                <th className="text-center px-2 py-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]">Attendance</th>
                <th className="text-center px-2 py-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]">Previous week's HWK</th>
                <th className="text-center px-2 py-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]">RQ %</th>
              </tr>
            </thead>
            <tbody>
              {weekly.filter(r => r.week !== 'Wk 1' && r.week !== 'Wk 10').map(r => (
                <tr key={r.week} className="border-b last:border-0 border-[#DEE7FF]">
                  <td className="px-3 py-1.5 font-semibold text-[#2A2035]">{r.week}</td>
                  <td className="px-2 py-1.5 text-center">
                    {r.status ? (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{
                        background: r.status === 'present' ? '#D1FAE5' : r.status === 'late' ? '#FEF3C7' : r.status === 'absent' ? '#FEE2E2' : r.status === 'makeup' ? '#EDE9FE' : '#E0E7FF',
                        color:      r.status === 'present' ? '#065F46' : r.status === 'late' ? '#92400E' : r.status === 'absent' ? '#991B1B' : r.status === 'makeup' ? '#5B21B6' : '#3730A3',
                      }}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
                    ) : <span className="text-[#2A2035]/30">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {r.hw ? (
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                        background: r.hw === 'A' ? '#D1FAE5' : r.hw === 'B' ? '#DEE7FF' : r.hw === 'C' ? '#FEF3C7' : r.hw === 'D' ? '#FFEDD5' : '#FEE2E2',
                        color:      r.hw === 'A' ? '#065F46' : r.hw === 'B' ? '#062E63' : r.hw === 'C' ? '#92400E' : r.hw === 'D' ? '#9A3412' : '#991B1B',
                      }}>{r.hw}</span>
                    ) : <span className="text-[#2A2035]/30">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-[#2A2035]">
                    {r.noRq
                      ? <span className="text-[#2A2035]/40 font-normal italic">No RQ</span>
                      : r.score == null ? <span className="text-[#2A2035]/30 font-normal">—</span> : `${r.score}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mb-6">
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-[#325099] mb-3">Exam analytics</h2>
          {examData && examData.perStudent ? (() => {
            const d = studentAnalysisRows(examData, student.id)
            return (
              <StudentExamAnalysisView
                studentName={student.full_name}
                rows={d.rows}
                overall={d.overall}
                sections={d.sections}
                strengths={d.strengths}
                weaknesses={d.weaknesses}
              />
            )
          })() : (
            <p className="text-xs text-[#2A2035]/40 italic">No exam assigned to this class for the term.</p>
          )}
        </section>

        {pageFooter}
      </article>
    </div>
  )
}

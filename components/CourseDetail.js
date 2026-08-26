'use client'
import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { normalizeDay } from '../lib/format'

// ── Subject styles ─────────────────────────────────────────────────────────
// Colour palette keyed by *canonical* subject name. Display labels use these.
export const SUBJECT_COLOR = {
  Mathematics: { line: '#325099', bg: '#DEE7FF', fg: '#062E63', soft: '#F5F8FF' },
  English:     { line: '#9D174D', bg: '#FCE7F3', fg: '#9D174D', soft: '#FEF5F9' },
  Science:     { line: '#065F46', bg: '#D1FAE5', fg: '#065F46', soft: '#F1FCF6' },
  Chemistry:   { line: '#065F46', bg: '#D1FAE5', fg: '#065F46', soft: '#F1FCF6' },
  Physics:     { line: '#3730A3', bg: '#E0E7FF', fg: '#3730A3', soft: '#F4F5FE' },
  Biology:     { line: '#065F46', bg: '#D1FAE5', fg: '#065F46', soft: '#F1FCF6' },
  Economics:   { line: '#92400E', bg: '#FEF3C7', fg: '#92400E', soft: '#FEFAEC' },
  SpeakDev:    { line: '#7C3AED', bg: '#EDE9FE', fg: '#5B21B6', soft: '#F8F5FF' },
}
export const FALLBACK_COLOR = { line: '#325099', bg: '#DEE7FF', fg: '#062E63', soft: '#F8FAFF' }

// Alias → canonical map. Order matters: more specific aliases first (e.g.
// "Chem" before "Chemistry" doesn't matter for .includes(), but if you ever
// add overlapping aliases keep the longer/more-specific one first).
// Lowercased for matching.
const SUBJECT_ALIASES = [
  { canonical: 'Mathematics', aliases: ['mathematics', 'maths', 'math'] },
  { canonical: 'English',     aliases: ['english', 'eald'] },
  { canonical: 'SpeakDev',    aliases: ['speakdev', 'speak dev', 'speaking'] },
  { canonical: 'Chemistry',   aliases: ['chemistry', 'chem'] },
  { canonical: 'Physics',     aliases: ['physics'] },
  { canonical: 'Biology',     aliases: ['biology', 'bio'] },
  { canonical: 'Economics',   aliases: ['economics', 'econ'] },
  // Generic "Science" last so "Chem"/"Bio"/"Phys" take precedence over the
  // word "Science" inside e.g. "Y10 Science" (still correctly resolves to
  // Science because none of the more specific keywords appear in the name).
  { canonical: 'Science',     aliases: ['science'] },
]
export const SUBJECT_KEYWORDS = Object.keys(SUBJECT_COLOR)

export function inferSubject(course) {
  if (course?.subject) return course.subject
  const name = (course?.class_name || '').toLowerCase()
  if (!name) return ''
  for (const { canonical, aliases } of SUBJECT_ALIASES) {
    if (aliases.some(a => name.includes(a))) return canonical
  }
  return course?.class_name || ''
}

export function subjectColor(subject) {
  if (!subject) return FALLBACK_COLOR
  const s = subject.toLowerCase()
  // Exact canonical hit first
  if (SUBJECT_COLOR[subject]) return SUBJECT_COLOR[subject]
  // Otherwise resolve through aliases
  for (const { canonical, aliases } of SUBJECT_ALIASES) {
    if (aliases.some(a => s.includes(a) || a.includes(s))) {
      return SUBJECT_COLOR[canonical] || FALLBACK_COLOR
    }
  }
  return FALLBACK_COLOR
}

// Are these two subject strings the "same subject"?
// Used to filter quiz_results.subject (free text like "Maths") against the
// inferred subject of a class (canonical like "Mathematics").
export function subjectsMatch(a, b) {
  if (!a || !b) return false
  const A = a.toLowerCase().trim()
  const B = b.toLowerCase().trim()
  if (A === B) return true
  if (A.includes(B) || B.includes(A)) return true
  // Resolve both through aliases — if they both land on the same canonical,
  // they match.
  const resolve = (s) => {
    for (const { canonical, aliases } of SUBJECT_ALIASES) {
      if (aliases.some(al => s.includes(al))) return canonical
    }
    return null
  }
  const rA = resolve(A)
  const rB = resolve(B)
  if (rA && rA === rB) return true
  return false
}

const ATT_STYLES = {
  present: { bg: '#D1FAE5', fg: '#065F46', label: 'Present' },
  late:    { bg: '#FEF3C7', fg: '#92400E', label: 'Late' },
  absent:  { bg: '#FEE2E2', fg: '#991B1B', label: 'Absent' },
  excused: { bg: '#E0E7FF', fg: '#3730A3', label: 'Excused' },
}

function getGrade(pct) {
  if (pct >= 90) return { label: 'A+', bg: '#D1FAE5', fg: '#065F46' }
  if (pct >= 80) return { label: 'A',  bg: '#D1FAE5', fg: '#065F46' }
  if (pct >= 70) return { label: 'B',  bg: '#DEE7FF', fg: '#062E63' }
  if (pct >= 60) return { label: 'C',  bg: '#FEF3C7', fg: '#92400E' }
  return            { label: 'D',  bg: '#FEE2E2', fg: '#991B1B' }
}
function homeworkPill(grade) {
  const map = {
    A: { bg: '#D1FAE5', fg: '#065F46' },
    B: { bg: '#DEE7FF', fg: '#062E63' },
    C: { bg: '#FEF3C7', fg: '#92400E' },
    D: { bg: '#FFEDD5', fg: '#9A3412' },
    E: { bg: '#FEE2E2', fg: '#991B1B' },
  }
  return map[grade] || { bg: '#F4F4F4', fg: '#6B7280' }
}

// ── Main component ─────────────────────────────────────────────────────────
export default function CourseDetail({ course, subject, col, quizzes, exams, attendance }) {
  const quizAvg = quizzes.length
    ? Math.round(quizzes.reduce((s, q) => s + (q.score / q.max_score) * 100, 0) / quizzes.length)
    : null
  const latestHw = [...quizzes].reverse().find(q => q.homework_grade)?.homework_grade || null
  const attStats = useMemo(() => {
    const total = attendance.length
    const tally = { present: 0, late: 0, absent: 0, excused: 0 }
    for (const a of attendance) {
      const key = (a.status || 'present').toLowerCase()
      if (tally[key] !== undefined) tally[key] += 1
    }
    const attended = tally.present + tally.late
    const pct = total ? Math.round((attended / total) * 100) : null
    return { total, tally, pct }
  }, [attendance])
  // Attendance lookup keyed by session_date — used to find the row that
  // matches each quiz week (they share the same date when saved together
  // from the tutor portal's session page).
  const attendanceByDate = useMemo(() => {
    const map = new Map()
    for (const a of attendance) map.set(a.session_date, a)
    return map
  }, [attendance])

  return (
    <div className="space-y-8">
      {/* COURSE HEADER */}
      <div className="rounded-2xl border p-6 md:p-7" style={{ background: col.soft, borderColor: col.bg }}>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase font-semibold mb-1 font-display" style={{ color: col.fg }}>
              {subject}
            </p>
            <h2 className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display mb-1">
              {course.class_name}
            </h2>
            <p className="text-xs text-[#2A2035]/60">
              {[
                normalizeDay(course.day_of_week),
                course.start_time && `${String(course.start_time).slice(0, 5)}–${String(course.end_time).slice(0, 5)}`,
                course.teacher && `with ${course.teacher}`,
                course.room && `📍 ${course.room}`,
              ].filter(Boolean).join(' · ') || 'Class details coming soon'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.line }} />
            <span className="text-[10px] tracking-widest uppercase font-bold" style={{ color: col.fg }}>
              Course
            </span>
          </div>
        </div>
      </div>

      {/* STATS STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Quiz average" value={quizAvg !== null ? `${quizAvg}%` : '—'} sub={`${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'}`} />
        <StatCard label="Average Homework" value={latestHw || '—'}                     sub={latestHw ? 'Most recent grade' : 'No homework recorded'} />
        <StatCard label="Attendance"   value={attStats.pct !== null ? `${attStats.pct}%` : '—'} sub={`${attStats.tally.present + attStats.tally.late}/${attStats.total} sessions`} />
      </div>

      {/* WEEKLY TRACKER */}
      <SectionCard eyebrow="Term progress" title="Weekly Tracker">
        {quizzes.length === 0 ? (
          <EmptyMini emoji="📋" msg="No quizzes yet — your weekly tracker will fill in once your first quiz is logged." />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={quizzes.map(q => ({
                week: q.week,
                score: Math.round((q.score / q.max_score) * 100),
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#DEE7FF" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#6B7280' }} stroke="#DEE7FF" />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: '#6B7280' }} stroke="#DEE7FF" />
                <Tooltip
                  formatter={(v) => `${v}%`}
                  contentStyle={{ borderRadius: 12, border: '1px solid #DEE7FF', background: '#fff', fontSize: 12 }}
                  labelStyle={{ color: '#325099', fontWeight: 600 }}
                />
                <Line type="monotone" dataKey="score" stroke={col.line} strokeWidth={2.5} dot={{ r: 4, fill: col.line, strokeWidth: 0 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>

            <div className="-mx-6 mt-4 border-t border-[#DEE7FF]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                    {['Week','Attendance','Score','%','Progress',"Previous week's HWK"].map(h => (
                      <th key={h} className="text-left px-6 py-3 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quizzes.map((q, i) => {
                    const pct = Math.round((q.score / q.max_score) * 100)
                    const hw = homeworkPill(q.homework_grade)
                    const att = attendanceByDate.get(q.quiz_date)
                    const attStyle = att ? (ATT_STYLES[(att.status || '').toLowerCase()] || null) : null
                    return (
                      <tr key={i} className="border-b last:border-0 border-[#DEE7FF]">
                        <td className="px-6 py-3 font-medium text-[#2A2035]">{q.week}</td>
                        <td className="px-6 py-3">
                          {attStyle ? (
                            <span
                              className="inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full"
                              style={{ background: attStyle.bg, color: attStyle.fg }}
                            >
                              {attStyle.label}
                            </span>
                          ) : (
                            <span className="text-[#2A2035]/40 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-[#2A2035] tabular-nums">{q.score} / {q.max_score}</td>
                        <td className="px-6 py-3 font-semibold text-[#2A2035] tabular-nums">{pct}%</td>
                        <td className="px-6 py-3 w-44">
                          <div className="w-full rounded-full h-2 bg-[#DEE7FF]">
                            <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: col.line }} />
                          </div>
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className="inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full"
                            style={{ background: hw.bg, color: hw.fg }}
                          >
                            {q.homework_grade || '—'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      {/* EXAMS */}
      <SectionCard eyebrow="Exam scores" title="CUBE exams">
        {exams.length === 0 ? (
          <EmptyMini emoji="🌱" msg="No exam results yet — clean slate." />
        ) : (
          <div className="-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAFF] border-y border-[#DEE7FF]">
                  {['Exam','Date','Score','%','Grade'].map(h => (
                    <th key={h} className="text-left px-6 py-3 text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exams.map((r, i) => {
                  const pct = Math.round((r.score / r.exams?.max_score) * 100)
                  const g = getGrade(pct)
                  return (
                    <tr key={i} className="border-b last:border-0 border-[#DEE7FF]">
                      <td className="px-6 py-4 text-[#2A2035] font-medium">{r.exams?.name}</td>
                      <td className="px-6 py-4 text-[#2A2035]/50">{r.exams?.exam_date}</td>
                      <td className="px-6 py-4 text-[#2A2035] tabular-nums">{r.score} / {r.exams?.max_score}</td>
                      <td className="px-6 py-4 font-semibold text-[#2A2035] tabular-nums">{pct}%</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: g.bg, color: g.fg }}>
                          {g.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

    </div>
  )
}

// ── Reusable bits ──────────────────────────────────────────────────────────
export function SectionCard({ eyebrow, title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="px-6 pt-6 pb-3">
        <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
          {eyebrow}
        </p>
        <h3 className="text-lg font-semibold text-[#2A2035] font-display">{title}</h3>
      </div>
      <div className="px-6 pb-6 pt-2">{children}</div>
    </div>
  )
}

export function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-[#DEE7FF] bg-white px-5 py-4">
      <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1.5 font-display">
        {label}
      </p>
      <p className="text-2xl md:text-[1.75rem] font-bold text-[#2A2035] font-display leading-none tabular-nums">
        {value}
      </p>
      <p className="text-[11px] text-[#2A2035]/50 mt-1.5">{sub}</p>
    </div>
  )
}

export function EmptyMini({ emoji, msg }) {
  return (
    <div className="text-center py-8">
      <div className="text-3xl mb-2">{emoji}</div>
      <p className="text-sm text-[#2A2035]/70">{msg}</p>
    </div>
  )
}


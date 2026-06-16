'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { T_STUDENTS, T_ATTENDANCE, T_QUIZ_RESULTS } from '../../lib/tables'
import { WidgetShell } from './TrialFunnel'

/*
 * AtRiskWatchlist — director home widget. Proactively flags active students who
 * may be slipping, before parents raise it: repeated absences this term, and/or
 * a downward quiz trend. Read-only; thresholds are deliberately conservative.
 *
 * Flags:
 *   attendance — 3+ absences in the current term
 *   grades     — recent quiz average below 60%, or a drop of 15+ points
 */

const ABSENCE_FLAG = 3
const LOW_AVG = 60
const DROP_POINTS = 15
const QUIZ_LOOKBACK_DAYS = 120

export default function AtRiskWatchlist({ currentTerm }) {
  const [data, setData] = useState(null)   // { students, attendance, quizzes }
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const quizCutoff = new Date(Date.now() - QUIZ_LOOKBACK_DAYS * 86400000)
        .toISOString().slice(0, 10)
      const attQ = currentTerm
        ? supabase.from(T_ATTENDANCE).select('student_id, status, session_date')
            .gte('session_date', currentTerm.start_date).lte('session_date', currentTerm.end_date)
        : supabase.from(T_ATTENDANCE).select('student_id, status, session_date')
      const [stuRes, attRes, quizRes] = await Promise.all([
        supabase.from(T_STUDENTS).select('id, full_name, year').eq('status', 'active'),
        attQ,
        supabase.from(T_QUIZ_RESULTS).select('student_id, score, max_score, quiz_date').gte('quiz_date', quizCutoff),
      ])
      if (cancelled) return
      const err = stuRes.error || attRes.error || quizRes.error
      if (err) { setError(err.message); setData({ students: [], attendance: [], quizzes: [] }); return }
      setData({ students: stuRes.data || [], attendance: attRes.data || [], quizzes: quizRes.data || [] })
    })()
    return () => { cancelled = true }
  }, [currentTerm])

  if (data === null) {
    return <WidgetShell title="At-risk watchlist" eyebrow="Retention"><p className="text-xs text-[#2A2035]/40 animate-pulse py-8 text-center">Loading…</p></WidgetShell>
  }

  const nameById = new Map(data.students.map(s => [s.id, s]))
  const activeIds = new Set(data.students.map(s => s.id))

  // Absences per active student
  const absencesById = {}
  for (const a of data.attendance) {
    if (a.status === 'absent' && activeIds.has(a.student_id)) {
      absencesById[a.student_id] = (absencesById[a.student_id] || 0) + 1
    }
  }

  // Quiz trend per active student
  const quizzesById = {}
  for (const q of data.quizzes) {
    if (!activeIds.has(q.student_id)) continue
    const max = Number(q.max_score)
    if (!max) continue
    const pct = (Number(q.score) / max) * 100
    ;(quizzesById[q.student_id] ||= []).push({ pct, date: q.quiz_date })
  }

  const flagged = []
  for (const id of activeIds) {
    const reasons = []
    const abs = absencesById[id] || 0
    if (abs >= ABSENCE_FLAG) reasons.push({ type: 'attendance', detail: `${abs} absences this term` })

    const qs = (quizzesById[id] || []).sort((a, b) => String(a.date).localeCompare(String(b.date)))
    if (qs.length >= 2) {
      const recent = qs.slice(-2)
      const prior = qs.slice(0, -2)
      const recentAvg = recent.reduce((s, q) => s + q.pct, 0) / recent.length
      const priorAvg = prior.length ? prior.reduce((s, q) => s + q.pct, 0) / prior.length : null
      if (recentAvg < LOW_AVG) reasons.push({ type: 'grade', detail: `Quiz avg ${Math.round(recentAvg)}%` })
      else if (priorAvg !== null && priorAvg - recentAvg >= DROP_POINTS) reasons.push({ type: 'grade', detail: `Quiz avg ↓ ${Math.round(priorAvg)}→${Math.round(recentAvg)}%` })
    }

    if (reasons.length) {
      const st = nameById.get(id)
      flagged.push({ id, name: st?.full_name || 'Student', year: st?.year, reasons, absences: abs })
    }
  }

  // Most concerning first: more reasons, then more absences.
  flagged.sort((a, b) => (b.reasons.length - a.reasons.length) || (b.absences - a.absences))
  const top = flagged.slice(0, 6)

  return (
    <WidgetShell
      title="At-risk watchlist"
      eyebrow="Retention"
      action={<Link href="/tutor/students" className="text-[11px] font-semibold text-[#325099] hover:underline">Students →</Link>}
    >
      {flagged.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">🌿</div>
          <p className="text-sm font-semibold text-[#2A2035]">No students flagged.</p>
          <p className="text-xs text-[#2A2035]/50 mt-1">Attendance and grades look healthy.</p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-[#2A2035]/55 mb-2">
            <span className="font-bold text-[#B23A3A]">{flagged.length}</span> active student{flagged.length === 1 ? '' : 's'} worth a check-in
          </p>
          <div className="space-y-1.5">
            {top.map(s => (
              <Link key={s.id} href="/tutor/students"
                className="flex items-center gap-3 rounded-xl px-3 py-2 border border-[#FDE8E8] bg-[#FFF7F7] hover:border-[#F4A0A0] hover:bg-white transition group">
                <span className="w-7 h-7 rounded-full bg-[#FDE2E2] text-[#B23A3A] flex items-center justify-center text-[10px] font-bold shrink-0">
                  {(s.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('')}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-[#2A2035] truncate">{s.name}{s.year ? ` · Y${s.year}` : ''}</span>
                  <span className="flex flex-wrap gap-1 mt-0.5">
                    {s.reasons.map((r, i) => (
                      <span key={i} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${r.type === 'attendance' ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#FCE7F3] text-[#9D174D]'}`}>
                        {r.detail}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="text-[#B23A3A] text-xs shrink-0 opacity-0 group-hover:opacity-100 transition">→</span>
              </Link>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-2 text-[10px] text-rose-500">Couldn’t load watchlist: {error}</p>}
    </WidgetShell>
  )
}

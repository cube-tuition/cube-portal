'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { solutionsUnlockAt } from '../lib/terms'
import { accessFromEnrolments, weekOpen } from '../lib/classAccess'
import useChemModules from './booklet/useChemModules'

/*
 * A past term's work for one class, week by week (student portal, Past Terms).
 *
 * The same rows the current-term class page shows: the booklets set for each
 * week, opened in the read-only viewer (no download), the solutions copy once
 * it has unlocked, and online workbooks — the student's own saved copy. A
 * student who left the class part-way sees the weeks up to when they left
 * (lib/classAccess); later weeks show as closed.
 */
const WEEKS = Array.from({ length: 10 }, (_, i) => i + 1)
const isSolPath = (p) => /_solutions|_teacher|\.mt\./i.test(p || '')
const pathsOf = (b) => (b.file_paths?.length ? b.file_paths : (b.file_path ? [b.file_path] : []))

export default function PastClassWork({ cls, term, studentId, col }) {
  const { groupLabel } = useChemModules()
  const [assignments, setAssignments] = useState([])
  const [access, setAccess] = useState(null)
  const [week, setWeek] = useState(null)
  const [loading, setLoading] = useState(true)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    if (!cls?.id || !studentId) return
    let alive = true
    ;(async () => {
      await Promise.resolve()
      if (!alive) return
      setLoading(true)
      const [{ data: asg }, { data: enr }] = await Promise.all([
        supabase.from('class_booklet_assignments')
          .select('id, week, booklets(id, booklet_name, year, subject, topic, file_path, file_paths, pdf_filenames, is_exam, delivery)')
          .eq('class_id', cls.id),
        supabase.from('enrolments').select('status, ended_at').eq('class_id', cls.id).eq('student_id', studentId),
      ])
      if (!alive) return
      const rows = (asg || []).filter(a => a.booklets && a.week >= 1 && a.week <= 10)
      const acc = accessFromEnrolments(enr || [], term)
      setAssignments(rows)
      setAccess(acc)
      // Open on the first week with work the student can still open.
      const open = rows.map(a => a.week).filter(w => weekOpen(acc, w)).sort((a, b) => a - b)
      setWeek(open[0] ?? rows.map(a => a.week).sort((a, b) => a - b)[0] ?? 1)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [cls?.id, studentId, term])

  const byWeek = useMemo(() => {
    const m = {}
    for (const a of assignments) (m[a.week] ||= []).push(a.booklets)
    return m
  }, [assignments])
  const items = byWeek[week] || []
  const open = weekOpen(access, week)
  const unlockAt = (w) => solutionsUnlockAt(term, cls?.day_of_week, cls?.end_time, w)
  const solutionsUnlocked = (w) => { const at = unlockAt(w); return at ? now >= at.getTime() : false }
  const btn = 'shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition'

  return (
    <div className="rounded-2xl border border-[#DEE7FF] bg-white overflow-hidden mb-8">
      <div className="px-5 md:px-6 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF] flex items-center gap-2 flex-wrap">
        <p className="text-xs font-bold text-[#325099]">Weekly work</p>
        <span className="text-[11px] text-[#2A2035]/40">workbooks, solutions &amp; online workbooks — read in the portal</span>
        {access?.ok && access.lastWeek != null && (
          <span className="text-[11px] text-[#2A2035]/45 ml-auto">You left this class in week {access.lastWeek}</span>
        )}
      </div>

      {/* Week tabs */}
      <div className="flex items-center gap-1 overflow-x-auto px-4 md:px-5 py-2.5 border-b border-[#F0F4FF] no-scrollbar">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#2A2035]/35 pr-1">Week</span>
        {WEEKS.map(w => {
          const has = (byWeek[w] || []).length > 0
          const active = w === week
          const closed = has && !weekOpen(access, w)
          return (
            <button key={w} onClick={() => setWeek(w)}
              title={!has ? `Nothing was set for week ${w}` : closed ? `Week ${w} — after you left this class` : `${byWeek[w].length} item${byWeek[w].length === 1 ? '' : 's'} for week ${w}`}
              className="shrink-0 w-9 h-9 rounded-full text-sm font-semibold transition border relative"
              style={{
                background: active ? col.bg : '#fff',
                borderColor: active ? col.fg : '#DEE7FF',
                color: active ? col.fg : has && !closed ? '#2A2035' : '#B9C2D6',
              }}>
              {w}
              {has && !active && !closed && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: col.line }} />}
            </button>
          )
        })}
      </div>

      {loading ? (
        <p className="px-6 py-6 text-sm text-[#2A2035]/40">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-6 py-6 text-sm text-[#2A2035]/45 italic">Nothing was set for week {week}.</p>
      ) : !open ? (
        <p className="px-6 py-6 text-sm text-[#2A2035]/45 italic">Week {week} was after you left this class.</p>
      ) : (
        <div className="divide-y divide-[#F0F4FF]">
          {items.map(b => {
            const online = b.delivery === 'online'
            const pdfs = pathsOf(b).filter(p => !isSolPath(p))
            const hasSol = pathsOf(b).some(isSolPath)
            return (
              <div key={b.id} className="px-5 md:px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#2A2035]">{b.booklet_name}</p>
                  <p className="text-[11px] text-[#2A2035]/45 mt-0.5">
                    {online ? 'Online workbook — your saved answers'
                      : pdfs.length ? (b.is_exam ? 'Exam paper — read it in the portal' : 'Workbook — read it in the portal')
                      : 'No file attached'}
                    {groupLabel(b) ? ` · ${groupLabel(b)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {online ? (
                    <a href={`/workbook/${b.id}?class=${cls.id}`} target="_blank" rel="noopener noreferrer"
                      className={`${btn} bg-[#0E7A5F] text-white hover:bg-[#0B5F4A]`}>🌐 Open workbook ↗</a>
                  ) : pdfs.length ? (
                    <a href={`/workbook/view/${b.id}?class=${cls.id}`} target="_blank" rel="noopener noreferrer"
                      className={btn} style={{ background: col.bg, color: col.fg }}>📄 Open {b.is_exam ? 'paper' : 'workbook'} ↗</a>
                  ) : null}
                  {!online && hasSol && (
                    solutionsUnlocked(week) ? (
                      <a href={`/workbook/view/${b.id}?class=${cls.id}&copy=solutions`} target="_blank" rel="noopener noreferrer"
                        className={`${btn} border text-[#0E7A5F] border-[#BFE3D4] bg-[#F0FAF6] hover:bg-[#E2F5EC]`}>✅ Solutions ↗</a>
                    ) : (
                      <span title={unlockAt(week) ? `Solutions unlock ${unlockAt(week).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
                        className={`${btn} font-semibold border border-[#E3E8F4] bg-[#F8FAFF] text-[#2A2035]/40 cursor-default`}>🔒 Solutions soon</span>
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

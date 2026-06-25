'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadLevelTestItems } from '../../lib/levelTest'

/*
 * LevelTestsView — the "Level Tests" tab of the lessons explorer.
 * A clean, view-only list of level-test lessons showing the Add-Lesson modal
 * columns (Student, Level test, Date, Time, Room, Notes) plus the marked result
 * and an Open button to the marking / report page.
 */

const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }
const fmtTime = (t) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = ((h + 11) % 12) + 1; return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}` }
const timeRange = (a, b) => a ? `${fmtTime(a)}${b ? `–${fmtTime(b)}` : ''}` : '—'

export default function LevelTestsView({ rows = [], onOpen, onDelete }) {
  const [builds, setBuilds] = useState({})   // buildId → { title, total }
  const [awarded, setAwarded] = useState({}) // lessonId → summed awarded marks
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState(null)

  // A lesson can link to several level tests (array), falling back to the single col.
  const buildIdsOf = (r) => (Array.isArray(r.level_test_build_ids) && r.level_test_build_ids.length)
    ? r.level_test_build_ids
    : (r.level_test_build_id ? [r.level_test_build_id] : [])
  const buildIds = useMemo(() => [...new Set(rows.flatMap(buildIdsOf))], [rows])
  const lessonIds = useMemo(() => rows.map(r => r.id), [rows])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      // Level test titles + total marks (sum of question maxes from the qbank).
      const buildMap = {}
      if (buildIds.length) {
        const { data: bs } = await supabase.from('booklet_builds').select('id, title, blocks').in('id', buildIds)
        for (const b of bs || []) {
          let total = 0
          try { const items = await loadLevelTestItems(Array.isArray(b.blocks) ? b.blocks : []); total = items.reduce((s, it) => s + (it.max || 0), 0) } catch { /* noop */ }
          buildMap[b.id] = { title: b.title, total }
        }
      }
      // Awarded marks per lesson.
      const awardedMap = {}
      if (lessonIds.length) {
        const { data: ms } = await supabase.from('level_test_marks').select('lesson_id, awarded').in('lesson_id', lessonIds)
        for (const m of ms || []) awardedMap[m.lesson_id] = (awardedMap[m.lesson_id] || 0) + (Number(m.awarded) || 0)
      }
      if (!cancelled) { setBuilds(buildMap); setAwarded(awardedMap); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [buildIds, lessonIds])

  const sorted = useMemo(() => [...rows].sort((a, b) => String(b.lesson_date || '').localeCompare(String(a.lesson_date || ''))), [rows])

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-4xl">📝</p>
        <p className="text-sm font-semibold text-[#2A2035]">No level tests yet</p>
        <p className="text-xs text-[#2A2035]/50">Add a lesson with type “Level test” to see it here.</p>
      </div>
    )
  }

  const TH = 'sticky top-0 z-10 bg-[#EEF1F8] border-b-2 border-[#DEE7FF] text-left text-[10px] font-bold uppercase tracking-wider text-[#325099]/70 px-3 py-2.5'
  const TD = 'border-b border-[#F0F4FF] px-3 py-2.5 text-xs text-[#2A2035] align-middle'

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[860px] border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={TH}>Student</th>
            <th className={TH}>Level Test</th>
            <th className={TH}>Date</th>
            <th className={TH}>Time</th>
            <th className={TH}>Room</th>
            <th className={TH}>Notes</th>
            <th className={`${TH} text-center`}>Result</th>
            <th className={`${TH} text-right`}>{loading ? '…' : ''}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const ids = buildIdsOf(r)
            const linked = ids.map(bid => builds[bid]).filter(Boolean)
            const titles = linked.map(b => b.title).join(', ')
            const total = linked.reduce((s, b) => s + (b.total || 0), 0)
            const aw = awarded[r.id]
            const result = total ? `${aw ?? 0}/${total}` : (aw != null ? String(aw) : '—')
            const pct = total && aw != null ? Math.round((aw / total) * 100) : null
            return (
              <tr key={r.id} className="hover:bg-[#F8FAFF]">
                <td className={`${TD} font-semibold`}>{r.student_name || <span className="text-[#2A2035]/35 italic">—</span>}</td>
                <td className={TD}>{titles || <span className="text-[#2A2035]/35 italic">(unlinked)</span>}{linked.length > 1 ? <span className="text-[10px] text-[#2A2035]/45 ml-1">({linked.length})</span> : null}</td>
                <td className={TD}>{fmtDate(r.lesson_date)}</td>
                <td className={TD}>{timeRange(r.start_time, r.end_time)}</td>
                <td className={TD}>{r.room || <span className="text-[#2A2035]/30">—</span>}</td>
                <td className={`${TD} max-w-[220px] truncate`} title={r.notes || ''}>{r.notes || <span className="text-[#2A2035]/30">—</span>}</td>
                <td className={`${TD} text-center tabular-nums`}>
                  <span className="font-semibold">{result}</span>
                  {pct != null && <span className="text-[10px] text-[#2A2035]/45 ml-1">({pct}%)</span>}
                </td>
                <td className={`${TD} text-right whitespace-nowrap`}>
                  <button onClick={() => onOpen?.(r.id)}
                    className="text-xs font-semibold bg-[#325099] text-white px-4 py-1.5 rounded-full hover:bg-[#062E63] transition">
                    Open →
                  </button>
                  <button
                    onClick={() => { if (confirmId === r.id) { onDelete?.(r.id); setConfirmId(null) } else { setConfirmId(r.id); setTimeout(() => setConfirmId(c => (c === r.id ? null : c)), 3500) } }}
                    className={`ml-2 text-[11px] font-semibold px-3 py-1.5 rounded-full transition ${confirmId === r.id ? 'bg-[#FEE2E2] text-[#991B1B]' : 'text-[#991B1B]/60 hover:bg-[#FEE2E2]'}`}>
                    {confirmId === r.id ? 'Confirm?' : 'Delete'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

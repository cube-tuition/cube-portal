'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isoDate, addDays, mondayOf, weekLabelFor } from '../../lib/calendarWeeks'
import { pickSubjectColor } from '../../lib/subjectColours'

/*
 * Full-screen month calendar. Date-driven (no schedule projection): renders the
 * actual lesson rows for the visible classes plus 1:1 makeup overlays, exactly
 * like the weekly view. Navigable month-by-month; each week row is labelled
 * universally (W{n} inside a term, "Term N Holidays · Wk x" in the breaks).
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Tutor-view pill colours: own lessons vs everyone else's.
const MINE_COL = { bg: '#D6E4FF', fg: '#062E63' }
const GREY_COL = { bg: '#EEF0F4', fg: '#868D9C' }

const isOneToOne = (name) => /\b1\s*:\s*1\b/.test(name || '')
const startMin = (t) => { if (!t) return 0; const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const fmtTime = (t) => {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  const ap = h >= 12 ? 'pm' : 'am'
  const hh = ((h + 11) % 12) + 1
  return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`
}

export default function MonthCalendarModal({ classes = [], staff, isAdmin = false, classView = 'mine', terms = [], onClose }) {
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d })
  const [byDate, setByDate] = useState({})
  const [loading, setLoading] = useState(true)

  const classIds = useMemo(() => classes.map(c => c.id), [classes])
  const classById = useMemo(() => Object.fromEntries(classes.map(c => [c.id, c])), [classes])
  const staffId = staff?.id
  // Tutors get the full director-style calendar — their own lessons highlighted
  // blue, everyone else's greyed out. Only the admin "My classes" toggle narrows.
  const mineOnly = isAdmin && classView === 'mine'
  const tutorMode = !isAdmin
  const myFirst = ((staff?.full_name || '').split(' ')[0] || '').toLowerCase()

  const gridStart = useMemo(() => mondayOf(anchor), [anchor])
  const gridDays = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart])
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, w) => gridDays.slice(w * 7, w * 7 + 7)), [gridDays])
  const todayISO = isoDate(new Date())

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      const minISO = isoDate(gridDays[0])
      const maxISO = isoDate(gridDays[41])

      let regular = []
      if (classIds.length) {
        const { data } = await supabase.from('lessons')
          .select('id, lesson_date, start_time, class_id, status')
          .in('class_id', classIds)
          .is('makeup_student_id', null)
          .gte('lesson_date', minISO).lte('lesson_date', maxISO)
        regular = (data || []).filter(l => l.status !== 'cancelled')
      }

      // 1:1 overlay: real makeups (is_makeup) plus any student-based lesson added
      // via the database explorer (makeup_student_id set, not a class lesson).
      let mq = supabase.from('lessons')
        .select('id, lesson_date, start_time, status, lesson_type, student_name, makeup_source_lesson_id, scheduled_teacher_id, students!makeup_student_id(full_name), classes(class_name)')
        .or('is_makeup.eq.true,makeup_student_id.not.is.null,lesson_type.not.is.null')
        .gte('lesson_date', minISO).lte('lesson_date', maxISO)
      // "My classes" view: show the viewer's own makeups, but always include
      // unassigned overlay lessons (e.g. level tests, which have no teacher).
      if (mineOnly && staffId) mq = mq.or(`scheduled_teacher_id.eq.${staffId},scheduled_teacher_id.is.null`)
      const { data: makeups } = await mq
      const movedSrc = new Set((makeups || []).map(m => m.makeup_source_lesson_id).filter(Boolean))

      const map = {}
      const push = (d, pill) => { (map[d] = map[d] || []).push(pill) }
      for (const l of regular) {
        const c = classById[l.class_id]
        if (!c) continue
        if (movedSrc.has(l.id) && isOneToOne(c.class_name)) continue
        const mine = !!myFirst && (c.teacher || '').toLowerCase().startsWith(myFirst)
        push(l.lesson_date, { id: `l-${l.id}`, name: c.class_name, time: l.start_time, sort: startMin(l.start_time), makeup: false, mine, color: pickSubjectColor(c.class_name) })
      }
      for (const m of (makeups || [])) {
        if (m.status === 'cancelled') continue
        const sn = m.students?.full_name || m.student_name || 'Student'
        const subjName = m.classes?.class_name || ''
        // A genuine makeup points back at a source lesson; an ad-hoc 1:1 added in
        // the explorer does not, so label it simply "1:1".
        const isLevelTest = m.lesson_type === 'level_test'
        const prefix = isLevelTest ? 'Level Test' : (m.makeup_source_lesson_id ? '1:1 Makeup' : '1:1')
        push(m.lesson_date, { id: `m-${m.id}`, lessonId: m.id, levelTest: isLevelTest, name: `${prefix} · ${sn}`, time: m.start_time, sort: startMin(m.start_time), makeup: true, mine: !!staffId && m.scheduled_teacher_id === staffId, color: pickSubjectColor(subjName) })
      }
      for (const k of Object.keys(map)) map[k].sort((a, b) => a.sort - b.sort)
      if (!cancelled) { setByDate(map); setLoading(false) }
    }
    run()
    return () => { cancelled = true }
  }, [gridStart, gridDays, classIds, classById, mineOnly, staffId, myFirst])

  const moveMonth = (delta) => setAnchor(a => { const d = new Date(a); d.setMonth(d.getMonth() + delta); d.setDate(1); return d })
  const thisMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setAnchor(d) }
  const sessionCount = useMemo(() => gridDays.reduce((n, d) => {
    if (d.getMonth() !== anchor.getMonth()) return n
    return n + (byDate[isoDate(d)]?.length || 0)
  }, 0), [gridDays, byDate, anchor])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] my-6 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-[#DEE7FF] flex-wrap">
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-bold text-[#062E63]">{MONTHS[anchor.getMonth()]} {anchor.getFullYear()}</h2>
            <span className="text-[11px] tracking-widest uppercase text-[#325099]/50 font-semibold">{sessionCount} sessions</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => moveMonth(-1)} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1.5 hover:bg-[#F0F4FF]">← Prev</button>
            <button onClick={thisMonth} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1.5 hover:bg-[#F0F4FF]">This month</button>
            <button onClick={() => moveMonth(1)} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1.5 hover:bg-[#F0F4FF]">Next →</button>
            <button onClick={onClose} className="text-[#325099]/50 hover:text-[#325099] text-lg ml-1">✕</button>
          </div>
        </div>

        {/* Grid */}
        <div className="p-4 overflow-auto">
          <div className="grid" style={{ gridTemplateColumns: '92px repeat(7, minmax(0,1fr))' }}>
            <div />
            {DOW.map(d => (
              <div key={d} className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 px-2 pb-2 text-center">{d}</div>
            ))}
            {weeks.map((week, wi) => {
              const wl = weekLabelFor(week[0], terms)
              const holiday = wl?.kind === 'holiday'
              return [
                <div key={`g-${wi}`} className="pr-2 pt-2 flex items-start justify-end">
                  <span className={`text-[10px] font-bold text-right leading-tight ${holiday ? 'text-[#9333EA]' : 'text-[#325099]'}`}>{wl?.label || ''}</span>
                </div>,
                ...week.map(day => {
                  const dISO = isoDate(day)
                  const inMonth = day.getMonth() === anchor.getMonth()
                  const isToday = dISO === todayISO
                  const pills = byDate[dISO] || []
                  return (
                    <div key={dISO} className={`min-h-[104px] border border-[#EEF2FF] p-1.5 ${inMonth ? 'bg-white' : 'bg-[#FAFBFF]'} ${holiday && inMonth ? 'bg-[#FBF7FF]' : ''}`}>
                      <div className={`text-[11px] font-semibold mb-1 ${isToday ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#062E63] text-white' : inMonth ? 'text-[#2A2035]' : 'text-[#2A2035]/30'}`}>{day.getDate()}</div>
                      <div className="space-y-1">
                        {pills.map(p => {
                          // Tutor view: own lessons highlighted blue, everyone
                          // else's greyed out (admins keep subject colours).
                          const col = tutorMode ? (p.mine ? MINE_COL : GREY_COL) : p.color
                          const style = { background: col?.bg || '#EEF4FF', color: col?.fg || '#325099', borderLeft: p.makeup ? `3px solid ${col?.fg || '#6B21A8'}` : 'none' }
                          const inner = <>{p.time ? <span className="font-semibold mr-1">{fmtTime(p.time)}</span> : null}{p.name}</>
                          const title = `${p.name}${p.time ? ' · ' + fmtTime(p.time) : ''}${p.levelTest ? ' · click to mark' : ''}`
                          return p.levelTest ? (
                            <a key={p.id} href={`/tutor/lessons/${p.lessonId}`} title={title} style={style}
                              className="block text-[10px] leading-tight rounded px-1.5 py-0.5 truncate hover:underline">
                              {inner}
                            </a>
                          ) : (
                            <div key={p.id} title={title} style={style}
                              className="text-[10px] leading-tight rounded px-1.5 py-0.5 truncate">
                              {inner}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                }),
              ]
            })}
          </div>
          {loading && <p className="text-center text-xs text-[#2A2035]/40 py-3">Loading…</p>}
        </div>
      </div>
    </div>
  )
}

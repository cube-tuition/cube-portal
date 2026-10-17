'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { assignLanes, peakConcurrent, toMinutes } from '../../lib/dayLanes'
import { teacherColour } from '../../lib/teacherColours'

/*
 * "View by time" — one day of the weekly calendar drawn the way the timetable
 * planner draws a day: time down the side, sessions that overlap side by side,
 * each card in its teacher's colour. View only; a card opens the session just
 * like its pill in the weekly calendar.
 *
 * For room planning it also sums up the day: how many sessions, the busiest
 * moment, which rooms are in use, and any two sessions booked into the same
 * room at the same time.
 *
 * Works on the weekly calendar's session objects (sessionsByDate), so lessons,
 * subs, 1:1 makeups, level tests and drop-ins all appear exactly as they do
 * there. Moving to a day outside the loaded week asks the page to load it.
 */

const HOUR_PX = 64
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Rooms that are not a physical room: never a clash.
const VIRTUAL_ROOM = /^(online|zoom|google meet|meet|teams)$/i

const fromISO = (iso) => new Date(iso + 'T00:00:00')
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shiftISO = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d) }
function fmtMin(mins) {
  if (mins == null) return ''
  const h = Math.floor(mins / 60), m = mins % 60
  const ap = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`
}
const firstName = (name) => (name || '').trim().split(/\s+/)[0] || ''

// Which staff member a session belongs to, for its colour.
function teacherIdOf(s, palette, viewerId) {
  if (s.teacherId) return s.teacherId
  if (s.lesson?.scheduled_teacher_id) return s.lesson.scheduled_teacher_id
  if (s.isSub && viewerId) return viewerId
  const name = (s.isDropin ? s.dropin?.tutors?.[0] : s.cls?.teacher) || ''
  if (!name) return null
  const full = palette.find(p => (p.full_name || '').toLowerCase() === name.toLowerCase())
  if (full) return full.id
  const byFirst = palette.filter(p => firstName(p.full_name).toLowerCase() === firstName(name).toLowerCase())
  return byFirst.length === 1 ? byFirst[0].id : null
}

export default function DayTimeModal({ dateISO, onDateChange, sessionsByDate, palette = [], viewerId = null, tutorMode = false,
  classLabelMap, rosters, hrefFor, todayISO, weekDays = [], onClose }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onDateChange(shiftISO(dateISO, -1))
      else if (e.key === 'ArrowRight') onDateChange(shiftISO(dateISO, 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dateISO, onDateChange, onClose])

  const day = useMemo(() => {
    const raw = sessionsByDate.get(dateISO) || []
    const timed = [], untimed = []
    for (const s of raw) {
      const st = toMinutes(s.cls?.start_time), en = toMinutes(s.cls?.end_time)
      const tid = teacherIdOf(s, palette, viewerId)
      const teacherName = s.isDropin ? (s.dropin?.tutors || []).map(firstName).join(', ')
        : (palette.find(p => p.id === tid)?.full_name || s.cls?.teacher || '')
      const ev = {
        ...s,
        s: st, e: en != null && st != null && en > st ? en : (st != null ? st + 60 : null),
        tid, teacherName,
        room: String((s.isDropin ? (s.dropin?.location || s.cls?.room) : s.cls?.room) || '').trim(),
        title: classLabelMap?.get(s.cls?.id) ?? s.cls?.class_name ?? 'Session',
        count: (rosters?.[s.cls?.id] || []).length,
      }
      if (ev.s == null) untimed.push(ev); else timed.push(ev)
    }
    const laid = assignLanes(timed)
    // Two sessions in the same physical room at the same time.
    const clash = new Set()
    for (let i = 0; i < laid.length; i++) for (let j = i + 1; j < laid.length; j++) {
      const a = laid[i], b = laid[j]
      if (!a.room || VIRTUAL_ROOM.test(a.room) || a.room.toLowerCase() !== b.room.toLowerCase()) continue
      if (a.s < b.e && b.s < a.e) { clash.add(a.key); clash.add(b.key) }
    }
    const rooms = [...new Set(laid.map(e => e.room).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const teachers = new Map()
    for (const e of laid.concat(untimed)) {
      const k = e.tid || e.teacherName || '—'
      const t = teachers.get(k) || { id: e.tid, name: e.teacherName, n: 0 }
      t.n++; teachers.set(k, t)
    }
    return { laid, untimed, clash, rooms, peak: peakConcurrent(laid), teachers: [...teachers.values()].sort((a, b) => b.n - a.n) }
  }, [sessionsByDate, dateISO, palette, viewerId, classLabelMap, rosters])

  // Grid spans the day's sessions (whole hours), never less than 3 hours.
  let startH = 15, endH = 20
  if (day.laid.length) {
    startH = Math.floor(Math.min(...day.laid.map(e => e.s)) / 60)
    endH = Math.ceil(Math.max(...day.laid.map(e => e.e)) / 60)
  }
  if (endH - startH < 3) endH = startH + 3
  const hours = Array.from({ length: endH - startH + 1 }, (_, i) => startH + i)
  const gridH = (endH - startH) * HOUR_PX
  const d = fromISO(dateISO)
  const isToday = dateISO === todayISO
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = isToday && nowMin >= startH * 60 && nowMin <= endH * 60

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-2 sm:p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1100px] my-2 sm:my-6 flex flex-col max-h-[94vh]" role="dialog" aria-label="Day by time">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-[#DEE7FF] space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#062E63]">{DAY_LONG[d.getDay()]} {d.getDate()} {MONTH[d.getMonth()]}</h2>
              {isToday && <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#065F46]">Today</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onDateChange(shiftISO(dateISO, -1))} aria-label="Previous day"
                className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1.5 hover:bg-[#F0F4FF]">← Prev</button>
              {!isToday && <button onClick={() => onDateChange(todayISO)}
                className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1.5 hover:bg-[#F0F4FF]">Today</button>}
              <button onClick={() => onDateChange(shiftISO(dateISO, 1))} aria-label="Next day"
                className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1.5 hover:bg-[#F0F4FF]">Next →</button>
              <button onClick={onClose} aria-label="Close" className="text-[#325099]/50 hover:text-[#325099] text-lg ml-1">✕</button>
            </div>
          </div>
          {/* Day tabs for the loaded week */}
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
            {weekDays.map(wd => {
              const iso = toISO(wd)
              const n = (sessionsByDate.get(iso) || []).length
              const on = iso === dateISO
              return (
                <button key={iso} onClick={() => onDateChange(iso)}
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition ${on ? 'bg-[#062E63] text-white border-[#062E63]' : 'bg-white text-[#325099] border-[#DEE7FF] hover:bg-[#F0F4FF]'}`}>
                  {DAY_SHORT[wd.getDay()]} {wd.getDate()}
                  <span className={`ml-1.5 tabular-nums ${on ? 'text-white/70' : 'text-[#325099]/45'}`}>{n || '–'}</span>
                </button>
              )
            })}
          </div>
          {/* Day summary */}
          {day.laid.length + day.untimed.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[#2A2035]/70">
              <span><b className="text-[#2A2035]">{day.laid.length + day.untimed.length}</b> session{day.laid.length + day.untimed.length === 1 ? '' : 's'}</span>
              {day.peak.count > 0 && <span>Busiest: <b className="text-[#2A2035]">{day.peak.count} at once</b> from {fmtMin(day.peak.at)}</span>}
              {day.rooms.length > 0 && <span>Rooms in use: <b className="text-[#2A2035]">{day.rooms.join(', ')}</b></span>}
              {day.clash.size > 0 && <span className="font-bold text-[#B91C1C]">⚠ Room double-booked</span>}
            </div>
          )}
          {day.teachers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {day.teachers.map(t => {
                const c = teacherColour(t.id, palette)
                return (
                  <span key={t.id || t.name} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: c.bg, color: c.text, borderColor: c.border }}>
                    {firstName(t.name) || 'Unassigned'} <span className="opacity-60 tabular-nums">{t.n}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {/* Time grid */}
        <div className="overflow-y-auto p-3 sm:p-4">
          {day.laid.length + day.untimed.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-semibold text-[#2A2035] mb-1">Nothing on this day.</p>
              <p className="text-xs text-[#2A2035]/50">Use the arrows or the day tabs to look at another day.</p>
            </div>
          ) : (
            <>
              {day.laid.length > 0 && (
                <div className="flex relative" style={{ height: gridH + 12 }}>
                  <div className="w-14 sm:w-16 shrink-0 relative">
                    {hours.map((h, i) => (
                      <div key={h} className="absolute right-2 text-[10px] font-semibold text-[#325099]/50" style={{ top: i * HOUR_PX - 6 }}>
                        {fmtMin(h * 60)}
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 relative border-l border-[#DEE7FF]" style={{ height: gridH }}>
                    {hours.map((h, i) => (
                      <div key={h} className="absolute left-0 right-0 border-t border-[#EEF2FB]" style={{ top: i * HOUR_PX }} />
                    ))}
                    {hours.slice(0, -1).map((h, i) => (
                      <div key={`h${h}`} className="absolute left-0 right-0 border-t border-dashed border-[#F4F6FC]" style={{ top: i * HOUR_PX + HOUR_PX / 2 }} />
                    ))}
                    {showNow && (
                      <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: ((nowMin - startH * 60) / 60) * HOUR_PX }}>
                        <div className="border-t-2 border-[#EF4444]" />
                        <span className="absolute -left-1.5 -top-[5px] w-2.5 h-2.5 rounded-full bg-[#EF4444]" />
                      </div>
                    )}
                    {day.laid.map(ev => {
                      const c = teacherColour(ev.tid, palette)
                      const top = ((ev.s - startH * 60) / 60) * HOUR_PX
                      const height = Math.max(26, ((ev.e - ev.s) / 60) * HOUR_PX - 3)
                      const lanes = ev._lanes || 1, lane = ev._lane || 0
                      const clash = day.clash.has(ev.key)
                      const mine = tutorMode && ev.mine
                      const badge = ev.isDropin ? 'Drop-in' : ev.isLevelTest ? 'Level test'
                        : ev.isMakeup ? (ev.lesson?.makeup_source_lesson_id ? 'Makeup' : '1:1')
                        : (ev.isSub || ev.hasSub) ? 'Sub' : null
                      return (
                        <Link key={ev.key} href={hrefFor(ev)}
                          title={`${ev.title} · ${fmtMin(ev.s)}–${fmtMin(ev.e)}${ev.teacherName ? ' · ' + ev.teacherName : ''}${ev.room ? ' · ' + ev.room : ''}`}
                          className="absolute rounded-lg px-2 py-1 overflow-hidden shadow-sm hover:shadow-md hover:z-10 transition"
                          style={{
                            top, height,
                            left: `calc(${(lane / lanes) * 100}% + 3px)`,
                            width: `calc(${100 / lanes}% - 6px)`,
                            background: c.bg,
                            border: `1.5px solid ${clash ? '#EF4444' : c.border}`,
                            boxShadow: clash ? '0 0 0 1px #EF4444' : mine ? `0 0 0 2px ${c.text}55` : undefined,
                          }}>
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-[12px] font-bold leading-tight truncate" style={{ color: c.text }}>
                              {clash && '⚠ '}{ev.title}
                            </p>
                            {ev.count > 0 && (
                              <span className="text-[9px] font-bold tabular-nums px-1.5 rounded-full bg-white/70 shrink-0" style={{ color: c.text }}>{ev.count}</span>
                            )}
                          </div>
                          <p className="text-[10.5px] leading-tight truncate" style={{ color: c.text, opacity: 0.85 }}>
                            {/* Room first: in a narrow lane the time truncates, not the room. */}
                            {ev.room && <><b>{ev.room}</b> · </>}{fmtMin(ev.s)}–{fmtMin(ev.e)}
                          </p>
                          <p className="text-[10.5px] leading-tight truncate" style={{ color: c.text, opacity: 0.75 }}>
                            {ev.teacherName || 'No teacher'}
                            {badge && <span className="ml-1 text-[8px] font-bold tracking-wide uppercase px-1 py-px rounded bg-white/70">{badge}</span>}
                            {mine && <span className="ml-1 text-[8px] font-bold tracking-wide uppercase px-1 py-px rounded bg-white/70">Yours</span>}
                          </p>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
              {day.untimed.length > 0 && (
                <div className="mt-4 border-t border-[#DEE7FF] pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/60 mb-2">No time set</p>
                  <div className="flex flex-wrap gap-2">
                    {day.untimed.map(ev => {
                      const c = teacherColour(ev.tid, palette)
                      return (
                        <Link key={ev.key} href={hrefFor(ev)} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border"
                          style={{ background: c.bg, color: c.text, borderColor: c.border }}>
                          {ev.title}{ev.teacherName ? ` · ${firstName(ev.teacherName)}` : ''}{ev.room ? ` · ${ev.room}` : ''}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

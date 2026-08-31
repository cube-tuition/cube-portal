'use client'
import Link from 'next/link'
import { fmtTimeRange, isoDate } from '../../lib/format'
import { pickSubjectColor } from '../../lib/subjectColours'

const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const DAY_SHORT = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat', Sunday:'Sun' }
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const dayNameOf = (d) => DAY_ORDER[(d.getDay() + 6) % 7]  // Monday-indexed

// start_time / end_time are stored as PostgreSQL time (HH:MM:SS), 24-hour.
function startMinutes(t) {
  if (!t) return 99999
  const [hRaw, mRaw] = String(t).split(':')
  const h = parseInt(hRaw, 10)
  const m = parseInt(mRaw || '0', 10) || 0
  if (Number.isNaN(h)) return 99999
  return h * 60 + m
}

// Compute the 1-based term week number for a given ISO date string.
function termWeekNumber(dateISO, term) {
  if (!term || !term.start_date) return null
  const termStart = new Date(`${term.start_date}T00:00:00`)
  const sessionDate = new Date(`${dateISO}T00:00:00`)
  const diff = sessionDate.getTime() - termStart.getTime()
  const week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1
  return week >= 1 ? week : null
}

/* Timetable-style week: seven day columns against an hour ruler, with every
   session block positioned and sized by its actual start/end time — the same
   visual language as the admin timetable, minus the drag editing. The pills
   keep all the calendar's semantics: subject colour, the tutor view's
   yours-in-colour/others-grey split, sub / makeup / drop-in states, roster
   counts and deep links. The hour range hugs the week's sessions rather than
   always running 8am–9pm, so an afternoon-only week doesn't waste half the
   grid on empty mornings. */
// Tall hours and wide columns: a 1-hour class is 72px, and a day's width
// scales with how many classes run at once — every simultaneous class gets a
// full lane of at least 280px, so a three-way overlap gets a triple-width day
// instead of three slivers. The grid grows as wide as it needs to and scrolls
// horizontally (the hour ruler stays pinned).
const GRID_HOUR_PX = 72
const DAY_MIN_PX = 280
const LANE_MIN_PX = 280

export default function WeekTimeGrid({ weekDays, sessionsByDate, todayISO, showTeacher, tutorMode = false, rosters, currentTerm, classLabelMap }) {
  let minM = Infinity, maxM = -Infinity
  for (const d of weekDays) {
    for (const s of (sessionsByDate.get(isoDate(d)) || [])) {
      const st = startMinutes(s.cls.start_time)
      if (st >= 99999) continue
      const en = s.cls.end_time ? startMinutes(s.cls.end_time) : st + 60
      minM = Math.min(minM, st)
      maxM = Math.max(maxM, en)
    }
  }
  const startHour = minM === Infinity ? 9 : Math.max(6, Math.floor(minM / 60))
  const endHour = maxM === -Infinity ? 20 : Math.min(23, Math.ceil(maxM / 60))
  const hours = []
  for (let h = startHour; h <= endHour; h++) hours.push(h)
  const gridHeight = (endHour - startHour) * GRID_HOUR_PX
  const hourLabel = (h) => `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`

  // Overlapping sessions split the column into lanes — same greedy layout as
  // the admin timetable, so the two read identically.
  const layout = (sessions) => {
    const evs = sessions.map(sess => {
      const st = startMinutes(sess.cls.start_time)
      const s = st >= 99999 ? startHour * 60 : st
      const e = sess.cls.end_time ? Math.max(startMinutes(sess.cls.end_time), s + 30) : s + 60
      return { s, e, sess }
    }).sort((a, b) => a.s - b.s || a.e - b.e)
    const laneEnds = []
    evs.forEach(ev => {
      let lane = laneEnds.findIndex(end => end <= ev.s)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(ev.e) } else laneEnds[lane] = ev.e
      ev.lane = lane
    })
    let curEnd = -1, cluster = []
    const flush = () => { const n = cluster.length ? Math.max(...cluster.map(e => e.lane)) + 1 : 1; cluster.forEach(e => { e.lanes = n }); cluster = [] }
    evs.forEach(ev => { if (cluster.length && ev.s >= curEnd) { flush(); curEnd = -1 } cluster.push(ev); curEnd = Math.max(curEnd, ev.e) })
    flush()
    return evs
  }

  // Lay out every day once, up front — the header cell and the body column
  // must agree on each day's width, which depends on its widest overlap.
  const days = weekDays.map(d => {
    const iso = isoDate(d)
    const evs = layout(sessionsByDate.get(iso) || [])
    const lanes = evs.reduce((n, ev) => Math.max(n, ev.lanes || 1), 1)
    return { d, iso, evs, width: Math.max(DAY_MIN_PX, lanes * LANE_MIN_PX) }
  })

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
      <div className="w-max min-w-full">
        {/* Day headers */}
        <div className="flex border-b border-[#DEE7FF]">
          <div className="w-14 flex-shrink-0 border-r border-[#DEE7FF] sticky left-0 bg-white z-30" />
          {days.map(({ d, iso, width }) => {
            const isToday = iso === todayISO
            return (
              <div key={iso} className={`px-2 py-2.5 text-center border-r border-[#DEE7FF] last:border-r-0 ${isToday ? 'bg-[#F0FDF4]' : 'bg-white'}`} style={{ flex: `1 0 ${width}px`, width }}>
                <div className="flex items-baseline justify-center gap-1.5">
                  <span className={`text-[10px] tracking-[0.25em] uppercase font-semibold ${isToday ? 'text-[#065F46]' : 'text-[#325099]/70'}`}>
                    {DAY_SHORT[dayNameOf(d)]}
                  </span>
                  <span className={`text-base font-bold tabular-nums font-display leading-none ${isToday ? 'text-[#065F46]' : 'text-[#2A2035]'}`}>
                    {d.getDate()}
                  </span>
                  <span className={`text-[10px] font-medium leading-none ${isToday ? 'text-[#065F46]/70' : 'text-[#2A2035]/35'}`}>
                    {MONTH_SHORT[d.getMonth()]}
                  </span>
                </div>
                {isToday && (
                  <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-[#065F46]">Today</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Grid body */}
        <div className="flex relative" style={{ height: gridHeight }}>
          {/* Hour ruler */}
          <div className="w-14 flex-shrink-0 border-r border-[#DEE7FF] relative sticky left-0 bg-white z-30">
            {hours.map((h, i) => i > 0 && (
              <div key={h} className="absolute right-1.5 text-[10px] font-semibold text-[#325099]/50" style={{ top: i * GRID_HOUR_PX - 6 }}>
                {hourLabel(h)}
              </div>
            ))}
          </div>

          {days.map(({ iso, evs, width }) => {
            const isToday = iso === todayISO
            return (
              <div key={iso} className={`relative border-r border-[#DEE7FF] last:border-r-0 ${isToday ? 'bg-[#F0FDF4]/40' : ''}`} style={{ flex: `1 0 ${width}px`, width }}>
                {hours.map((h, i) => i > 0 && (
                  <div key={h} className="absolute left-0 right-0 border-t border-[#EEF2FB]" style={{ top: i * GRID_HOUR_PX }} />
                ))}
                {evs.map(ev => {
                  const s = ev.sess
                  const col = pickSubjectColor(s.cls.class_name)
                  const count = (rosters?.[s.cls.id] || []).length
                  const wk = termWeekNumber(s.dateISO, currentTerm)
                  const href = wk
                    ? `/tutor/classes/${s.cls.id}?week=${wk}`
                    : `/tutor/classes/${s.cls.id}`
                  // Tutor view: every lesson is visible (director-style), but
                  // only the viewer's own are in colour — theirs highlighted
                  // blue, everyone else's greyed out. Special states (sub /
                  // makeup / drop-in) keep their colours on OWN lessons only.
                  const grey = tutorMode && !s.mine
                  const isAmber  = !grey && (s.isSub || s.hasSub)
                  const isMakeup = s.isMakeup
                  const isDropin = s.isDropin
                  const mineBlue = tutorMode && s.mine && !isAmber && !isMakeup && !isDropin
                  const pillBg     = grey ? '#EEF0F4' : mineBlue ? '#D6E4FF' : isDropin ? '#CCFBF1CC' : isMakeup ? '#EDE9FECC' : isAmber ? '#FEF9ECCC' : col.bg + 'AA'
                  const pillBorder = grey ? 'none' : mineBlue ? '1px solid #9DBBF5' : isDropin ? '1px solid #5EEAD4' : isMakeup ? '1px solid #C4B5FD' : isAmber ? '1px solid #FDE68A' : 'none'
                  const textColor  = grey ? '#868D9C' : mineBlue ? '#062E63' : isDropin ? '#0F766E' : isMakeup ? '#5B21B6' : isAmber ? '#92400E' : col.fg
                  const subColor   = grey ? '#868D9C99' : mineBlue ? '#325099AA' : isDropin ? '#0F766E99' : isMakeup ? '#5B21B699' : isAmber ? '#92400E99' : col.fg + 'AA'
                  const badgeGrey  = 'bg-[#E2E5EB] text-[#868D9C]'
                  const pillHref = isDropin
                    ? `/tutor/dropin/${s.dropin?.id}`
                    : s.isLevelTest
                    ? `/tutor/lessons/${s.lessonId}`
                    : isMakeup
                    ? `/tutor/classes/makeup/${s.lesson?.id}`
                    : href
                  const top = ((ev.s - startHour * 60) / 60) * GRID_HOUR_PX
                  const height = Math.max(30, ((ev.e - ev.s) / 60) * GRID_HOUR_PX - 2)
                  const roomy = height >= 52
                  return (
                    <Link
                      key={s.key}
                      href={pillHref}
                      title={`${classLabelMap.get(s.cls.id) ?? s.cls.class_name} · ${fmtTimeRange(s.cls.start_time, s.cls.end_time)}${s.cls.room ? ' · ' + s.cls.room : ''}${s.cls.teacher ? ' · ' + s.cls.teacher : ''}`}
                      className="absolute rounded-lg px-2 py-1 overflow-hidden shadow-sm transition hover:shadow-md hover:z-20"
                      style={{
                        top, height,
                        left: `calc(${(ev.lane / ev.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / ev.lanes}% - 4px)`,
                        background: pillBg, border: pillBorder,
                      }}
                    >
                      <div className="flex items-center gap-1">
                        <p className="text-[12px] font-bold truncate leading-tight flex-1 min-w-0" style={{ color: textColor }}>
                          {classLabelMap.get(s.cls.id) ?? s.cls.class_name}
                        </p>
                        {isAmber && (
                          <span className="text-[8px] font-bold tracking-wide uppercase px-1 py-0.5 rounded-full bg-[#F59E0B]/20 text-[#92400E] shrink-0 whitespace-nowrap">
                            {s.isSub ? 'Sub' : 'Sub covering'}
                          </span>
                        )}
                        {isMakeup && (
                          <span className={`text-[8px] font-bold tracking-wide uppercase px-1 py-0.5 rounded-full shrink-0 whitespace-nowrap ${grey ? badgeGrey : 'bg-[#8B5CF6]/15 text-[#5B21B6]'}`}>
                            Makeup
                          </span>
                        )}
                        {isDropin && (
                          <span className={`text-[8px] font-bold tracking-wide uppercase px-1 py-0.5 rounded-full shrink-0 whitespace-nowrap ${grey ? badgeGrey : 'bg-[#CCFBF1] text-[#0F766E]'}`}>
                            Drop-in
                          </span>
                        )}
                        {count > 0 && (
                          <span className="text-[9px] font-bold tabular-nums px-1 py-0.5 rounded-full bg-white/70 shrink-0" style={{ color: textColor }}>
                            {count}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] leading-tight truncate" style={{ color: subColor }}>
                        {fmtTimeRange(s.cls.start_time, s.cls.end_time)}
                        {!isDropin && s.cls.room && <> · {s.cls.room}</>}
                        {isDropin && s.dropin?.tutors?.length > 0 && <> · {s.dropin.tutors.join(', ')}</>}
                      </p>
                      {showTeacher && s.cls.teacher && roomy && (
                        <p className="text-[9px] leading-tight truncate" style={{ color: textColor + '88' }}>
                          {s.cls.teacher}
                        </p>
                      )}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


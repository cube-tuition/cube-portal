/*
 * Laying out one day's sessions on a time grid: sessions that overlap sit side
 * by side in lanes, the way the timetable planner draws a day column.
 *
 * Each event needs `s` and `e` (start / end in minutes from midnight). The
 * events are annotated in place with `_lane` (0-based column) and `_lanes`
 * (how many columns its cluster of overlapping events needs), and returned
 * sorted by start time.
 */
export function assignLanes(events) {
  const evs = [...events].sort((a, b) => a.s - b.s || a.e - b.e)
  const laneEnds = []
  for (const ev of evs) {
    let lane = laneEnds.findIndex(end => end <= ev.s)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(ev.e) } else laneEnds[lane] = ev.e
    ev._lane = lane
  }
  // A cluster is a run of events joined by overlaps; all of it shares one width.
  let curEnd = -1, cluster = []
  const flush = () => {
    const n = cluster.length ? Math.max(...cluster.map(e => e._lane)) + 1 : 1
    for (const e of cluster) e._lanes = n
    cluster = []
  }
  for (const ev of evs) {
    if (cluster.length && ev.s >= curEnd) { flush(); curEnd = -1 }
    cluster.push(ev)
    curEnd = Math.max(curEnd, ev.e)
  }
  flush()
  return evs
}

// The most sessions running at once, and when that first happens.
export function peakConcurrent(events) {
  const marks = []
  for (const ev of events) { marks.push([ev.s, 1]); marks.push([ev.e, -1]) }
  // Ends before starts at the same minute: back-to-back sessions don't overlap.
  marks.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let cur = 0, best = 0, at = null
  for (const [t, d] of marks) {
    cur += d
    if (cur > best) { best = cur; at = t }
  }
  return { count: best, at }
}

// Minutes from midnight for a stored time ("16:00", "16:00:00", "4:00 pm").
// A bare 1–7 o'clock is an afternoon class time, as the payroll trigger reads it.
export function toMinutes(t) {
  if (!t) return null
  const m = String(t).trim().toLowerCase().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (m[3] === 'pm' && h < 12) h += 12
  else if (m[3] === 'am' && h === 12) h = 0
  else if (!m[3] && h >= 1 && h <= 7) h += 12
  return h * 60 + min
}

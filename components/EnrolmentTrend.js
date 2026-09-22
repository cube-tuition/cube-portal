'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllTerms, isHolidayTerm } from '../lib/terms'
import { T_CLASSES, T_ENROLMENTS } from '../lib/tables'

/*
 * How enrolments and student numbers have moved, term by term.
 *
 * Two different counts, deliberately shown side by side:
 *   students   — distinct people (headcount)
 *   enrolments — course places, so a student doing Maths and English counts twice
 * They move apart when families add or drop a second subject without leaving, so
 * showing only one of them hides half of what happened.
 *
 * A handful of headline numbers is a KPI row, not a chart — with three or four
 * terms of history a plotted line would imply a trend the data can't support.
 *
 * Holiday terms are left out: they are short optional courses, and folding a
 * 1-student holiday programme in beside a 45-student teaching term would read
 * as a collapse.
 */
const TILE_COUNT = 4          // most recent terms shown

export default function EnrolmentTrend() {
  const [rows, setRows] = useState(null)   // null = loading, [] = nothing to show
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const terms = await fetchAllTerms()
        const [{ data: classes, error: cErr }, { data: enrols, error: eErr }] = await Promise.all([
          supabase.from(T_CLASSES).select('id, term_id'),
          supabase.from(T_ENROLMENTS).select('class_id, student_id, status'),
        ])
        if (cErr || eErr) throw (cErr || eErr)

        const termOfClass = new Map((classes || []).map((c) => [c.id, c.term_id]))
        const perTerm = new Map()        // term_id → { places, students:Set }
        for (const e of enrols || []) {
          if (e.status !== 'active') continue           // trials and disenrols aren't a place
          const tid = termOfClass.get(e.class_id)
          if (!tid) continue
          let acc = perTerm.get(tid)
          if (!acc) { acc = { places: 0, students: new Set() }; perTerm.set(tid, acc) }
          acc.places += 1
          if (e.student_id) acc.students.add(e.student_id)
        }

        const today = new Date().toISOString().slice(0, 10)
        const out = (terms || [])
          .filter((t) => !isHolidayTerm(t))
          .sort((a, b) => (a.year - b.year) || (a.term_number - b.term_number))
          .map((t) => {
            const acc = perTerm.get(t.id)
            return {
              id: t.id,
              label: `T${t.term_number} ${String(t.year).slice(2)}`,
              places: acc?.places ?? 0,
              students: acc?.students.size ?? 0,
              // A term that hasn't started yet is still filling up, so its
              // shortfall is not a fall — it gets no red delta.
              upcoming: !!t.start_date && t.start_date > today,
            }
          })
          .filter((r) => r.places > 0)
          .slice(-TILE_COUNT)
        if (alive) setRows(out)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => { alive = false }
  }, [])

  if (failed || (rows && rows.length < 2)) return null      // nothing worth saying
  if (!rows) return <div className="h-[104px] rounded-2xl bg-white border border-[#F0F4FF] mb-4 animate-pulse" />

  const settled = rows.filter((r) => !r.upcoming)
  const last = settled[settled.length - 1]
  const prev = settled[settled.length - 2]

  return (
    <div className="bg-white rounded-2xl border border-[#F0F4FF] p-5 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-bold text-[#062E63]">Enrolments over recent terms</h2>
        <p className="text-[11px] text-[#2A2035]/45">
          Students are people; enrolments are course places
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {rows.map((r, i) => {
          const before = rows[i - 1]
          return (
            <div key={r.id} className={`rounded-xl px-3 py-2.5 border ${r.upcoming ? 'border-dashed border-[#E4EAF7] bg-[#FCFDFF]' : 'border-[#EDF1FA] bg-[#F8FAFF]'}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#98A5BE]">
                {r.label}{r.upcoming && <span className="normal-case tracking-normal font-semibold"> · so far</span>}
              </p>
              <p className="text-[20px] font-bold text-[#062E63] leading-tight mt-0.5">{r.students}</p>
              <p className="text-[10px] text-[#2A2035]/50 -mt-0.5">students</p>
              <p className="text-[11px] font-semibold text-[#325099] mt-1.5">
                {r.places} <span className="font-medium text-[#2A2035]/45">places</span>
              </p>
              <Delta from={before} to={r} />
            </div>
          )
        })}
      </div>

      {last && prev && (
        <p className="text-xs text-[#2A2035]/60 leading-relaxed mt-3">{summary(prev, last, rows)}</p>
      )}
    </div>
  )
}

// Change in headcount against the term before. An upcoming term is still
// filling, so its difference is shown in neutral ink rather than as a drop.
function Delta({ from, to }) {
  if (!from) return <p className="text-[10px] text-[#2A2035]/30 mt-1">—</p>
  const d = to.students - from.students
  if (d === 0) return <p className="text-[10px] font-semibold text-[#2A2035]/40 mt-1">level with {from.label}</p>
  const tone = to.upcoming ? 'text-[#2A2035]/45' : (d > 0 ? 'text-emerald-700' : 'text-[#A8531A]')
  return (
    <p className={`text-[10px] font-semibold mt-1 ${tone}`}>
      {d > 0 ? '+' : '−'}{Math.abs(d)} student{Math.abs(d) === 1 ? '' : 's'} <span className="font-medium text-[#2A2035]/40">vs {from.label}</span>
    </p>
  )
}

// One plain sentence, because four tiles do not say what actually happened.
function summary(prev, last, rows) {
  const dS = last.students - prev.students
  const dP = last.places - prev.places
  const per = (r) => r.students ? (r.places / r.students) : 0
  const word = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat')

  let s = `Headcount is ${word(dS)}${dS ? ` ${Math.abs(dS)}` : ''} on ${prev.label}, at ${last.students} students across ${last.places} places`
  // The interesting case: the two counts disagree in direction.
  if (dS !== 0 && dP !== 0 && Math.sign(dS) !== Math.sign(dP)) {
    s += `, so places went ${word(dP)} while student numbers went ${word(dS)} — existing families changed how many subjects they take`
  } else if (per(last) && per(prev)) {
    const a = per(prev), b = per(last)
    const moved = Math.abs(b - a) >= 0.05
    s += moved
      ? `, ${b > a ? 'more' : 'fewer'} subjects each on average (${b.toFixed(2)} vs ${a.toFixed(2)})`
      : `, about ${b.toFixed(2)} subjects each either way`
  }
  const up = rows.find((r) => r.upcoming)
  if (up) s += `. ${up.label} is still filling, so its ${up.students} is a floor, not a forecast`
  return s + '.'
}

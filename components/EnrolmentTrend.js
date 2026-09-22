'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllTerms, isHolidayTerm } from '../lib/terms'
import { T_CLASSES, T_ENROLMENTS } from '../lib/tables'

/*
 * How enrolments and student numbers have moved, term by term.
 *
 * Two counts, kept in separate panels because they answer different questions
 * and do not move together:
 *   students   — distinct people on the roll (headcount)
 *   enrolments — course places, so one student doing Maths and English is two
 * Between T2 and T3 2026 they moved in opposite directions; merging them into
 * one figure would have reported that as either growth or loss, both wrong.
 *
 * Terms that have not started are left out entirely — a term still filling up
 * would show as a fall. Holiday terms are out too: a 1-student holiday
 * programme beside a 45-student teaching term reads as a collapse.
 */
const TERM_COUNT = 6          // most recent started terms shown

export default function EnrolmentTrend() {
  const [rows, setRows] = useState(null)   // null = loading
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
          // A term we have not reached yet is still filling, so it is not a
          // data point — showing it would read as a drop that has not happened.
          .filter((t) => !t.start_date || t.start_date <= today)
          .sort((a, b) => (a.year - b.year) || (a.term_number - b.term_number))
          .map((t) => {
            const acc = perTerm.get(t.id)
            return {
              id: t.id,
              label: `T${t.term_number} ${String(t.year).slice(2)}`,
              places: acc?.places ?? 0,
              students: acc?.students.size ?? 0,
            }
          })
          .filter((r) => r.places > 0)
          .slice(-TERM_COUNT)
        if (alive) setRows(out)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => { alive = false }
  }, [])

  if (failed || (rows && rows.length < 2)) return null      // nothing worth saying
  if (!rows) return <div className="h-[180px] rounded-2xl bg-white border border-[#F0F4FF] mb-4 animate-pulse" />

  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]

  return (
    <div className="bg-white rounded-2xl border border-[#F0F4FF] p-5 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="text-sm font-bold text-[#062E63]">Enrolments over recent terms</h2>
        <p className="text-[11px] text-[#2A2035]/45">Current term: {last.label}</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Metric title="Students" unit="distinct people on the roll" field="students" rows={rows} />
        <Metric title="Enrolments" unit="course places across all subjects" field="places" rows={rows} />
      </div>

      <p className="text-xs text-[#2A2035]/60 leading-relaxed mt-4">{summary(prev, last)}</p>
    </div>
  )
}

/*
 * One measure, one panel: the current figure, its change on the term before,
 * and a bar per term.
 *
 * The bars are zero-based and scaled to the largest term, so a change of one
 * student looks like a change of one student. A baseline cropped to make the
 * movement dramatic would misreport a roll that is essentially level — the
 * delta line above carries the exact number instead.
 */
function Metric({ title, unit, field, rows }) {
  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  const max = Math.max(...rows.map((r) => r[field]), 1)
  const d = last[field] - prev[field]
  const tone = d > 0 ? 'text-emerald-700' : d < 0 ? 'text-[#A8531A]' : 'text-[#2A2035]/45'

  return (
    <div className="rounded-xl border border-[#EDF1FA] bg-[#FBFCFF] px-4 py-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#98A5BE]">{title}</p>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className="text-[26px] font-bold text-[#062E63] leading-none">{last[field]}</span>
        <span className={`text-[11px] font-semibold ${tone}`}>
          {d === 0 ? `level with ${prev.label}` : `${d > 0 ? '+' : '−'}${Math.abs(d)} on ${prev.label}`}
        </span>
      </div>
      <p className="text-[10px] text-[#2A2035]/45 mt-0.5">{unit}</p>

      <div className="mt-3 space-y-1.5">
        {rows.map((r, i) => {
          const isNow = i === rows.length - 1
          return (
            <div key={r.id} className="flex items-center gap-2" title={`${r.label}: ${r[field]} ${title.toLowerCase()}`}>
              <span className="text-[9px] font-bold tabular-nums text-[#98A5BE] w-[34px] shrink-0">{r.label}</span>
              <div className="flex-1 h-[8px] rounded-full bg-[#EDF1FA] overflow-hidden">
                {/* current term in the accent, earlier terms recede */}
                <div className="h-full rounded-full" style={{ width: `${(r[field] / max) * 100}%`, background: isNow ? '#325099' : '#AFC3E6' }} />
              </div>
              <span className={`text-[10px] tabular-nums w-[22px] text-right shrink-0 ${isNow ? 'font-bold text-[#062E63]' : 'text-[#2A2035]/45'}`}>{r[field]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// One plain sentence, because two panels of numbers do not say what happened.
function summary(prev, last) {
  const dS = last.students - prev.students
  const dP = last.places - prev.places
  const word = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat')
  const per = (r) => (r.students ? r.places / r.students : 0)

  let s = `On ${prev.label}, students are ${word(dS)}${dS ? ` ${Math.abs(dS)}` : ''} and places are ${word(dP)}${dP ? ` ${Math.abs(dP)}` : ''}`
  if (dS !== 0 && dP !== 0 && Math.sign(dS) !== Math.sign(dP)) {
    s += ` — the roll went ${word(dS)} while the families who stayed took ${dP > 0 ? 'more' : 'fewer'} subjects`
  } else {
    const a = per(prev), b = per(last)
    if (a && b) {
      s += Math.abs(b - a) >= 0.05
        ? `, ${b > a ? 'more' : 'fewer'} subjects each on average (${b.toFixed(2)} vs ${a.toFixed(2)})`
        : `, holding at about ${b.toFixed(2)} subjects each`
    }
  }
  return s + '.'
}

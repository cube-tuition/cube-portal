'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { T_ENROLMENTS, T_COURSES } from '../../lib/tables'
import { isOneToOneClass } from '../../lib/classFormat'
import { WidgetShell } from './TrialFunnel'

/*
 * CapacityBoard — director home widget. Surfaces classes that need attention on
 * seat count for the current term: full (cap reached), one seat left (fill now),
 * and under-enrolled (at risk). Reuses the classes already loaded by the home
 * page; fetches only the active enrolment counts. Read-only.
 */

const CAP = 7
const SEATS_OCCUPYING = ['active', 'trial'] // statuses that hold a seat

export default function CapacityBoard({ classes = [], currentTermId, classLabelMap }) {
  const [counts, setCounts] = useState(null)   // { [classId]: number }
  const [courseModes, setCourseModes] = useState({})  // { [course_id]: '1:1' | 'Class' }
  const [error, setError] = useState(null)

  // Robust 1:1 detection comes from courses.delivery_mode (with a name fallback
  // for any course not tagged yet). Load the per-course modes once.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from(T_COURSES).select('id, delivery_mode')
      if (cancelled) return
      setCourseModes(Object.fromEntries((data || []).map(c => [c.id, c.delivery_mode])))
    })()
    return () => { cancelled = true }
  }, [])

  // Current-term group classes only (fall back to all if no term resolved);
  // 1:1 classes are excluded from capacity tracking.
  const termClasses = (currentTermId
    ? classes.filter(c => c.term_id === currentTermId)
    : classes
  ).filter(c => !isOneToOneClass(c, courseModes))
  const classIds = termClasses.map(c => c.id)
  const idKey = classIds.join(',')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (classIds.length === 0) { if (!cancelled) setCounts({}); return }
      const { data, error } = await supabase
        .from(T_ENROLMENTS)
        .select('class_id, status')
        .in('class_id', classIds)
        .in('status', SEATS_OCCUPYING)
      if (cancelled) return
      if (error) { setError(error.message); setCounts({}); return }
      const c = {}
      for (const r of data || []) c[r.class_id] = (c[r.class_id] || 0) + 1
      setCounts(c)
    })()
    return () => { cancelled = true }
    // idKey captures the set of class ids without re-running on array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey])

  if (counts === null) {
    return <WidgetShell title="Class capacity" eyebrow="Operations"><p className="text-xs text-[#2A2035]/40 animate-pulse py-8 text-center">Loading…</p></WidgetShell>
  }

  const withCounts = termClasses.map(c => ({ ...c, n: counts[c.id] || 0 }))
  const full      = withCounts.filter(c => c.n >= CAP)
  const oneLeft   = withCounts.filter(c => c.n === CAP - 1)
  const underFill = withCounts.filter(c => c.n <= 2).sort((a, b) => a.n - b.n)
  const openSeats = withCounts.reduce((s, c) => s + Math.max(0, CAP - c.n), 0)

  // Actionable list: 1-seat-left first (easy wins), then under-filled.
  const actionable = [
    ...oneLeft.map(c => ({ ...c, kind: 'oneLeft' })),
    ...underFill.map(c => ({ ...c, kind: 'under' })),
  ].slice(0, 6)

  const labelFor = (c) => (classLabelMap?.get?.(c.id)) || c.class_name || 'Untitled class'

  return (
    <WidgetShell
      title="Class capacity"
      eyebrow="Operations"
      action={<Link href="/tutor/classes" className="text-[11px] font-semibold text-[#325099] hover:underline">All classes →</Link>}
    >
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Tile label="Full" value={full.length} sub={`${CAP}/${CAP}`} tone="ok" />
        <Tile label="1 seat left" value={oneLeft.length} sub="fill now" tone={oneLeft.length ? 'amber' : 'neutral'} />
        <Tile label="Under-filled" value={underFill.length} sub="≤2 students" tone={underFill.length ? 'red' : 'neutral'} />
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Needs attention</p>
        <span className="text-[10px] text-[#2A2035]/45">{openSeats} open seat{openSeats === 1 ? '' : 's'} total</span>
      </div>
      <p className="text-[10px] text-[#2A2035]/35 mb-2">Group classes only — 1:1s excluded.</p>

      {actionable.length === 0 ? (
        <p className="text-center py-4 text-xs text-[#2A2035]/45">Every class is comfortably filled. 🎯</p>
      ) : (
        <div className="space-y-1.5">
          {actionable.map(c => (
            <Link key={c.id} href={`/tutor/classes/${c.id}`}
              className="flex items-center gap-3 rounded-xl px-3 py-2 border border-[#DEE7FF] bg-[#F8FAFF] hover:border-[#BACBFF] hover:bg-white transition group">
              <span className={`w-1.5 h-8 rounded-full shrink-0 ${c.kind === 'oneLeft' ? 'bg-[#F59E0B]' : 'bg-[#B23A3A]'}`} />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-[#2A2035] truncate">{labelFor(c)}</span>
                <span className="block text-[10px] text-[#2A2035]/50">
                  {c.kind === 'oneLeft' ? 'One seat left — great time to fill it' : c.n === 0 ? 'No students enrolled' : `Only ${c.n} student${c.n === 1 ? '' : 's'}`}
                </span>
              </span>
              <span className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full bg-white border border-[#DEE7FF] text-[#325099] shrink-0">{c.n}/{CAP}</span>
              <span className="text-[#325099] text-xs shrink-0 opacity-0 group-hover:opacity-100 transition">→</span>
            </Link>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-[10px] text-rose-500">Couldn’t load enrolments: {error}</p>}
    </WidgetShell>
  )
}

function Tile({ label, value, sub, tone }) {
  const toneCls = tone === 'red' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : tone === 'ok' ? 'text-emerald-700' : 'text-[#2A2035]'
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] px-3 py-2">
      <p className="text-[9px] tracking-[0.15em] uppercase text-[#325099]/70 font-semibold truncate">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${toneCls}`}>{value}</p>
      <p className="text-[9px] text-[#2A2035]/40">{sub}</p>
    </div>
  )
}

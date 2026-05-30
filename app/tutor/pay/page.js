'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { fetchAllTerms } from '../../../lib/terms'
import { T_SHIFTS } from '../../../lib/tables'

/*
 * Tutor "My pay" — read-only personal view of shifts + earnings.
 *
 * Period math: term-aligned fortnights. Each CUBE term is 10 weeks → 5
 * fortnights (W1-2, W3-4, W5-6, W7-8, W9-10) starting at term.start_date.
 * Mirrors the SQL pay_period_for() in app/api/payroll usage so the tutor
 * and admin views always agree.
 */

const isoDate = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const fmtDate = (s) => {
  if (!s) return ''
  return new Date(s + 'T00:00:00').toLocaleDateString('en-AU',
    { day: 'numeric', month: 'short' })
}
const fmtDateLong = (s) => {
  if (!s) return ''
  return new Date(s + 'T00:00:00').toLocaleDateString('en-AU',
    { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtTime = (t) => t ? t.slice(0, 5) : ''
const fmtMoney = (n) => '$' + (Number(n) || 0).toFixed(2)

// Compute term-aligned fortnight for a date, given the terms list.
// Returns { start, end, fortnight (1..5), weekStart, weekEnd, term } or null.
function payPeriod(dateIso, terms) {
  if (!terms || terms.length === 0) return null
  let term = terms.find(t => dateIso >= t.start_date && dateIso <= t.end_date)
  if (!term) {
    term = [...terms].sort((a, b) => b.end_date.localeCompare(a.end_date))
      .find(t => t.end_date < dateIso)
  }
  if (!term) term = [...terms].sort((a, b) => a.start_date.localeCompare(b.start_date))[0]
  if (!term) return null

  const dt = new Date(dateIso + 'T00:00:00')
  const ts = new Date(term.start_date + 'T00:00:00')
  const diff = Math.floor((dt - ts) / 86400000)
  const idx = diff < 0 ? 1 : Math.min(5, Math.floor(diff / 14) + 1)
  const sd = new Date(ts); sd.setDate(ts.getDate() + (idx - 1) * 14)
  const ed = new Date(sd); ed.setDate(sd.getDate() + 13)
  return {
    start: isoDate(sd),
    end: isoDate(ed),
    fortnight: idx,
    weekStart: (idx - 1) * 2 + 1,
    weekEnd: idx * 2,
    term,
  }
}

const STATUS_BADGE = {
  draft:     { bg: '#FEF3C7', fg: '#92400E', label: 'Pending review' },
  submitted: { bg: '#DEE7FF', fg: '#062E63', label: 'Submitted' },
  approved:  { bg: '#D1FAE5', fg: '#065F46', label: 'Approved' },
  paid:      { bg: '#E0E7FF', fg: '#3730A3', label: 'Paid' },
  void:      { bg: '#FEE2E2', fg: '#991B1B', label: 'Void' },
}

export default function MyPayPage() {
  const [staff, setStaff] = useState(null)
  const [terms, setTerms] = useState([])
  const [period, setPeriod] = useState(null)
  const [shifts, setShifts] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const router = useRouter()

  const reload = async (uid, p) => {
    setLoading(true); setError(null)
    try {
      const { data: cur, error: e1 } = await supabase
        .from(T_SHIFTS)
        .select('id, work_date, start_time, end_time, hours, rate_snapshot, notes, kind, status')
        .eq('tutor_id', uid)
        .gte('work_date', p.start)
        .lte('work_date', p.end)
        .order('work_date').order('start_time')
      if (e1) throw e1
      setShifts(cur || [])

      // History: everything before this period, grouped by fortnight.
      const { data: past, error: e2 } = await supabase
        .from(T_SHIFTS)
        .select('id, work_date, hours, rate_snapshot, status')
        .eq('tutor_id', uid)
        .lt('work_date', p.start)
        .order('work_date', { ascending: false })
      if (e2) throw e2

      const groups = new Map()
      for (const s of past || []) {
        const pp = payPeriod(s.work_date, terms)
        if (!pp) continue
        const key = pp.start
        if (!groups.has(key)) {
          groups.set(key, {
            start: pp.start, end: pp.end,
            weekStart: pp.weekStart, weekEnd: pp.weekEnd,
            term: pp.term,
            shifts: 0, hours: 0, amount: 0, paid: 0, approved: 0,
          })
        }
        const g = groups.get(key)
        g.shifts += 1
        g.hours  += Number(s.hours || 0)
        g.amount += Number(s.hours || 0) * Number(s.rate_snapshot || 0)
        if (s.status === 'paid')      g.paid += 1
        if (s.status === 'approved')  g.approved += 1
      }
      setHistory([...groups.values()].sort((a, b) => b.start.localeCompare(a.start)))
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    (async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile) { router.push('/'); return }
      if (profile.role === 'admin') { router.push('/tutor/payroll'); return }
      if (profile.role !== 'tutor') { router.push('/dashboard'); return }
      setStaff(profile)

      const termsData = await fetchAllTerms()
      setTerms(termsData)
      const initialPeriod = payPeriod(isoDate(new Date()), termsData)
      setPeriod(initialPeriod)
      if (initialPeriod) reload(user.id, initialPeriod)
      else setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = useMemo(() => {
    let hours = 0, amount = 0
    for (const s of shifts) {
      hours += Number(s.hours || 0)
      amount += Number(s.hours || 0) * Number(s.rate_snapshot || 0)
    }
    return { hours, amount, count: shifts.length }
  }, [shifts])

  const ytdAmount = useMemo(() => {
    const now = new Date()
    const yearStart = `${now.getFullYear()}-01-01`
    return history
      .filter(g => g.start >= yearStart)
      .reduce((acc, g) => acc + g.amount, 0) + totals.amount
  }, [history, totals])

  const jumpPeriod = (delta) => {
    if (!period) return
    const d = new Date(period.start + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    const p = payPeriod(isoDate(d), terms)
    if (!p) return
    setPeriod(p)
    if (staff) reload(staff.id, p)
  }

  if (!staff || !period) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">
        Loading…
      </div>
    </div>
  )

  const todayPeriod = payPeriod(isoDate(new Date()), terms)
  const isCurrent = todayPeriod && period.start === todayPeriod.start
  const titleWeeks = period.weekStart != null
    ? `W${period.weekStart} & ${period.weekEnd}`
    : `${fmtDate(period.start)} – ${fmtDate(period.end)}`

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={false} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 md:py-12">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display mb-2">
            My pay
          </p>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#2A2035] font-display">
                {titleWeeks}
              </h1>
              <p className="text-sm text-[#2A2035]/60 mt-1">
                {fmtDateLong(period.start)} – {fmtDateLong(period.end)}
                {period.term && <> · {period.term.name || `Term ${period.term.term_number} ${period.term.year}`}</>}
              </p>
            </div>
            {isCurrent && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                Current fortnight
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => jumpPeriod(-14)}
                className="text-xs font-semibold text-[#062E63] bg-white border border-[#DEE7FF] hover:bg-[#F8FAFF] px-3 py-1.5 rounded-full transition"
              >
                ← Previous
              </button>
              {!isCurrent && (
                <button
                  onClick={() => {
                    const p = payPeriod(isoDate(new Date()), terms)
                    if (!p) return
                    setPeriod(p); reload(staff.id, p)
                  }}
                  className="text-xs font-semibold text-[#062E63] bg-white border border-[#DEE7FF] hover:bg-[#F8FAFF] px-3 py-1.5 rounded-full transition"
                >
                  This fortnight
                </button>
              )}
              <button
                onClick={() => jumpPeriod(14)}
                className="text-xs font-semibold text-[#062E63] bg-white border border-[#DEE7FF] hover:bg-[#F8FAFF] px-3 py-1.5 rounded-full transition"
              >
                Next →
              </button>
            </div>
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-8">
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Shifts</p>
              <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">{totals.count}</p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Hours</p>
              <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">
                {totals.hours.toFixed(2)}
              </p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Earnings</p>
              <p className="text-2xl md:text-3xl font-bold text-[#062E63] font-display">{fmtMoney(totals.amount)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {error && (
          <div className="bg-[#FEE2E2] border border-[#FCA5A5] rounded-xl p-4 text-sm text-[#991B1B] mb-6">
            {error}
          </div>
        )}

        {/* CURRENT-PERIOD SHIFTS */}
        <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF]">
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">
              This fortnight
            </p>
            <h2 className="text-lg font-semibold text-[#2A2035] font-display">
              {loading ? 'Loading…' : `${totals.count} shift${totals.count === 1 ? '' : 's'}`}
            </h2>
          </div>

          {!loading && shifts.length === 0 && (
            <div className="text-center py-12">
              <div className="text-4xl mb-2">📭</div>
              <p className="text-sm font-semibold text-[#2A2035]">No shifts yet in this fortnight.</p>
              <p className="text-xs text-[#2A2035]/50 mt-1">
                Shifts appear here once attendance is marked.
              </p>
            </div>
          )}

          {!loading && shifts.length > 0 && (
            <div className="divide-y divide-[#DEE7FF]">
              {shifts.map(s => {
                const badge = STATUS_BADGE[s.status] || STATUS_BADGE.draft
                const amount = (Number(s.hours || 0) * Number(s.rate_snapshot || 0)).toFixed(2)
                return (
                  <div key={s.id} className="grid grid-cols-12 gap-3 items-center px-6 py-4 text-sm">
                    <div className="col-span-12 md:col-span-3">
                      <p className="font-semibold text-[#2A2035]">{fmtDateLong(s.work_date)}</p>
                      <p className="text-xs text-[#2A2035]/50">
                        {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                      </p>
                    </div>
                    <div className="col-span-12 md:col-span-4">
                      <p className="font-medium text-[#2A2035] truncate">
                        {(s.notes || '').replace(/^Auto:\s*/, '') || `(${s.kind})`}
                      </p>
                      <span
                        className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div className="col-span-4 md:col-span-2 text-right md:text-left">
                      <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Hours</p>
                      <p className="text-sm font-semibold text-[#2A2035]">{Number(s.hours).toFixed(2)}</p>
                    </div>
                    <div className="col-span-4 md:col-span-1 text-right md:text-left">
                      <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Rate</p>
                      <p className="text-sm font-semibold text-[#2A2035]">
                        {s.rate_snapshot == null ? '—' : fmtMoney(s.rate_snapshot)}
                      </p>
                    </div>
                    <div className="col-span-4 md:col-span-2 text-right">
                      <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Amount</p>
                      <p className="text-sm font-bold text-[#062E63] font-display">{fmtMoney(amount)}</p>
                    </div>
                  </div>
                )
              })}

              {/* Period total row */}
              <div className="grid grid-cols-12 gap-3 items-center px-6 py-3 text-sm bg-[#F8FAFF]">
                <div className="col-span-7 md:col-span-9 text-right">
                  <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">Period total</p>
                </div>
                <div className="col-span-2 md:col-span-1 text-right md:text-left">
                  <p className="text-sm font-semibold text-[#2A2035]">{totals.hours.toFixed(2)}h</p>
                </div>
                <div className="col-span-3 md:col-span-2 text-right">
                  <p className="text-base font-bold text-[#062E63] font-display">{fmtMoney(totals.amount)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* HISTORY */}
        {history.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF] flex items-end justify-between">
              <div>
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">
                  History
                </p>
                <h2 className="text-lg font-semibold text-[#2A2035] font-display">
                  Past fortnights
                </h2>
              </div>
              <div className="text-right">
                <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">
                  YTD earnings
                </p>
                <p className="text-lg font-bold text-[#062E63] font-display">{fmtMoney(ytdAmount)}</p>
              </div>
            </div>
            <div className="divide-y divide-[#DEE7FF]">
              {history.map(g => {
                const pct = g.shifts === 0 ? 0 : Math.round(((g.paid + g.approved) / g.shifts) * 100)
                const allPaid = g.paid === g.shifts
                const wkLabel = g.weekStart != null ? `W${g.weekStart} & ${g.weekEnd}` : `${fmtDate(g.start)} – ${fmtDate(g.end)}`
                return (
                  <button
                    key={g.start}
                    onClick={() => { setPeriod(g); reload(staff.id, g) }}
                    className="w-full grid grid-cols-12 gap-3 items-center px-6 py-3 text-sm hover:bg-[#F8FAFF] transition text-left"
                  >
                    <div className="col-span-6 md:col-span-4">
                      <p className="font-semibold text-[#2A2035]">{wkLabel}</p>
                      {g.weekStart != null && (
                        <p className="text-[11px] text-[#2A2035]/50 mt-0.5">{fmtDate(g.start)} – {fmtDate(g.end)}</p>
                      )}
                    </div>
                    <div className="col-span-3 md:col-span-2 text-xs text-[#2A2035]/60">
                      {g.shifts} shift{g.shifts === 1 ? '' : 's'}
                    </div>
                    <div className="col-span-3 md:col-span-2 text-xs text-[#2A2035]/60">
                      {g.hours.toFixed(2)}h
                    </div>
                    <div className="col-span-6 md:col-span-2 text-xs">
                      <span
                        className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background: allPaid ? '#E0E7FF' : (pct === 100 ? '#D1FAE5' : '#FEF3C7'),
                          color:      allPaid ? '#3730A3' : (pct === 100 ? '#065F46' : '#92400E'),
                        }}
                      >
                        {allPaid ? 'All paid' : (pct === 100 ? 'Approved' : `${pct}% processed`)}
                      </span>
                    </div>
                    <div className="col-span-6 md:col-span-2 text-right">
                      <p className="text-sm font-bold text-[#062E63] font-display">{fmtMoney(g.amount)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">
            © CUBE Tuition · Chatswood
          </p>
        </div>
      </footer>
    </div>
  )
}

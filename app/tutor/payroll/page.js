'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { formatTermLabel } from '../../../lib/terms'
import { T_PAY_RUN_SHIFTS, T_SHIFTS, T_TERMS } from '../../../lib/tables'
import { fmtTime, fmtMoney, isoDate } from '../../../lib/format'

// Xero Bills CSV defaults — edit here if your chart of accounts differs.
const XERO_ACCOUNT_CODE = '477'         // 477 = Wages & Salaries (AU default)
const XERO_TAX_TYPE     = 'BAS Excluded'
const DUE_DAYS_AFTER    = 3              // bill DueDate = period_end + N days

/*
 * Admin payroll review — term-aligned fortnights.
 *
 * Each CUBE term is 10 weeks → 5 fortnights (W1-2, W3-4, W5-6, W7-8, W9-10).
 * Navigation: 5 fortnight tabs across the active term, plus a small term
 * selector to flip between terms when needed.
 */

const FORTNIGHT_LABELS = ['W1 & 2', 'W3 & 4', 'W5 & 6', 'W7 & 8', 'W9 & 10']

const fmtDate = (s) => {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
const fmtDateLong = (s) => {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

// Compute (start, end) ISO dates for fortnight n (1..5) of a term.
function fortnightDates(term, idx) {
  if (!term) return null
  const start = new Date(term.start_date + 'T00:00:00')
  start.setDate(start.getDate() + (idx - 1) * 14)
  const end = new Date(start)
  end.setDate(start.getDate() + 13)
  return { start: isoDate(start), end: isoDate(end) }
}

// Pick which term+fortnight to land on by default.
//   • Today inside a term  → that term, fortnight containing today
//   • Holidays (after term) → most recent past term, fortnight 5
//   • No past terms        → earliest upcoming term, fortnight 1
function pickInitialTermFortnight(terms, todayIso) {
  if (!terms || terms.length === 0) return { term: null, fortnight: 1 }
  const inTerm = terms.find(t => todayIso >= t.start_date && todayIso <= t.end_date)
  if (inTerm) {
    const days = Math.floor(
      (new Date(todayIso + 'T00:00:00') - new Date(inTerm.start_date + 'T00:00:00')) / 86400000
    )
    return { term: inTerm, fortnight: Math.min(5, Math.max(1, Math.floor(days / 14) + 1)) }
  }
  const past = [...terms].sort((a, b) => b.end_date.localeCompare(a.end_date))
    .find(t => t.end_date < todayIso)
  if (past) return { term: past, fortnight: 5 }
  return { term: terms[0], fortnight: 1 }
}

const STATUS_STYLE = {
  open:     { bg: '#FEF3C7', fg: '#92400E', label: 'Open' },
  approved: { bg: '#D1FAE5', fg: '#065F46', label: 'Approved' },
  exported: { bg: '#DEE7FF', fg: '#062E63', label: 'Exported' },
  paid:     { bg: '#E0E7FF', fg: '#3730A3', label: 'Paid' },
  void:     { bg: '#FEE2E2', fg: '#991B1B', label: 'Void' },
}

export default function PayrollPage() {
  const [staff, setStaff] = useState(null)
  const [terms, setTerms] = useState([])
  const [activeTerm, setActiveTerm] = useState(null)
  const [fortnight, setFortnight] = useState(1)    // 1..5
  const [run, setRun] = useState(null)
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [approving, setApproving] = useState(false)
  const router = useRouter()

  // Load (or create) the pay run for the given (term, fortnight).
  const reload = async (term = activeTerm, idx = fortnight) => {
    if (!term) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const dates = fortnightDates(term, idx)
      const { data: prData, error: prErr } = await supabase
        .rpc('ensure_pay_run', { p_date: dates.start })
      if (prErr) throw prErr
      const pr = Array.isArray(prData) ? prData[0] : prData
      setRun(pr)

      const { data: sh, error: shErr } = await supabase
        .from(T_PAY_RUN_SHIFTS)
        .select('*')
        .gte('work_date', pr.period_start)
        .lte('work_date', pr.period_end)
        .order('tutor_name', { ascending: true })
        .order('work_date', { ascending: true })
        .order('start_time', { ascending: true })
      if (shErr) throw shErr
      setShifts(sh || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  // Boot: auth → admin check → fetch terms → pick initial term + fortnight.
  useEffect(() => {
    (async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile || profile.role !== 'admin') {
        router.push('/tutor'); return
      }
      setStaff(profile)

      const { data: termsData } = await supabase
        .from(T_TERMS)
        .select('*')
        .order('start_date', { ascending: true })
      const allTerms = termsData || []
      setTerms(allTerms)

      const { term, fortnight: f } = pickInitialTermFortnight(allTerms, isoDate(new Date()))
      setActiveTerm(term)
      setFortnight(f)
      if (term) reload(term, f)
      else setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const editable = run && ['open'].includes(run.status)

  // Group shifts by tutor for display
  const byTutor = useMemo(() => {
    const map = new Map()
    for (const s of shifts) {
      if (!map.has(s.tutor_id)) map.set(s.tutor_id, { name: s.tutor_name, shifts: [] })
      map.get(s.tutor_id).shifts.push(s)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [shifts])

  const totals = useMemo(() => {
    let hours = 0, amount = 0, missingRate = 0
    for (const s of shifts) {
      hours += Number(s.hours || 0)
      amount += Number(s.amount || 0)
      if (s.rate_snapshot == null) missingRate += 1
    }
    return { hours, amount, missingRate, tutorCount: byTutor.length, shiftCount: shifts.length }
  }, [shifts, byTutor])

  // Inline-edit a shift. Re-prices and saves to DB.
  const updateShift = async (id, patch) => {
    setSavingId(id)
    try {
      const { error: e } = await supabase.from(T_SHIFTS).update(patch).eq('id', id)
      if (e) throw e
      await reload()
    } catch (e) {
      alert('Save failed: ' + (e.message || String(e)))
    } finally {
      setSavingId(null)
    }
  }

  const approveRun = async () => {
    if (!confirm(`Approve ${totals.shiftCount} shifts for ${totals.tutorCount} tutors? Total: ${fmtMoney(totals.amount)}`)) return
    setApproving(true)
    try {
      const { error: e } = await supabase.rpc('approve_pay_run', { p_pay_run: run.id })
      if (e) throw e
      await reload()
    } catch (e) {
      alert('Approval failed: ' + (e.message || String(e)))
    } finally {
      setApproving(false)
    }
  }

  // Export approved shifts to Xero Bills CSV. One line per shift; one bill
  // (= one InvoiceNumber) per tutor.
  const exportCsv = async () => {
    if (!run) return
    try {
      // Re-fetch only shifts attached to this run (i.e. approved).
      const { data: rows, error: e } = await supabase
        .from(T_SHIFTS)
        .select('id, work_date, start_time, end_time, hours, rate_snapshot, notes, kind, tutor_id, tutors!shifts_tutor_id_fkey(full_name, email)')
        .eq('pay_run_id', run.id)
        .order('tutor_id').order('work_date')
      if (e) throw e
      if (!rows || rows.length === 0) {
        alert('No approved shifts to export.')
        return
      }
      const csv = buildXeroCsv(rows, run)
      downloadBlob(csv, `cube-payroll-${run.period_start}.csv`, 'text/csv;charset=utf-8')

      // Best-effort status flip — non-fatal if the user already exported once
      const { error: rpcErr } = await supabase.rpc('mark_pay_run_exported', { p_pay_run: run.id })
      if (rpcErr && !/must be approved/i.test(rpcErr.message)) console.warn(rpcErr)
      await reload()
    } catch (e) {
      alert('Export failed: ' + (e.message || String(e)))
    }
  }

  // Tab + term navigation handlers
  const selectFortnight = (idx) => {
    if (idx === fortnight) return
    setFortnight(idx)
    reload(activeTerm, idx)
  }
  const jumpTerm = (delta) => {
    if (!activeTerm || terms.length === 0) return
    const i = terms.findIndex(t => t.id === activeTerm.id)
    const j = i + delta
    if (j < 0 || j >= terms.length) return
    const newTerm = terms[j]
    setActiveTerm(newTerm)
    setFortnight(1)
    reload(newTerm, 1)
  }
  const termIndex = activeTerm ? terms.findIndex(t => t.id === activeTerm.id) : -1

  if (!staff) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">
        Loading…
      </div>
    </div>
  )

  const status = STATUS_STYLE[run?.status] || STATUS_STYLE.open

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 md:py-12">
          <div className="flex items-center gap-3 mb-2">
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">
              Payroll · Admin
            </p>
            <span className="text-[#325099]/40">·</span>
            <Link
              href="/tutor/payroll/rates"
              className="text-[11px] tracking-[0.2em] uppercase text-[#325099] hover:text-[#062E63] font-semibold transition"
            >
              Rates →
            </Link>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#2A2035] font-display">
                {FORTNIGHT_LABELS[fortnight - 1] || '—'}
              </h1>
              {run && (
                <p className="text-sm text-[#2A2035]/60 mt-1">
                  {fmtDateLong(run.period_start)} – {fmtDateLong(run.period_end)}
                </p>
              )}
            </div>
            {run && (
              <span
                className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: status.bg, color: status.fg }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.fg }} />
                {status.label}
              </span>
            )}
            {/* Term selector — small inline control */}
            <div className="flex items-center gap-1 ml-auto bg-white border border-[#DEE7FF] rounded-full px-2 py-1">
              <button
                onClick={() => jumpTerm(-1)}
                disabled={termIndex <= 0}
                className="text-xs font-semibold text-[#062E63] disabled:text-[#2A2035]/30 hover:bg-[#F8FAFF] px-2 py-0.5 rounded-full transition"
                aria-label="Previous term"
              >
                ←
              </button>
              <span className="text-xs font-semibold text-[#062E63] px-2 whitespace-nowrap">
                {activeTerm ? formatTermLabel(activeTerm) : '—'}
              </span>
              <button
                onClick={() => jumpTerm(1)}
                disabled={termIndex < 0 || termIndex >= terms.length - 1}
                className="text-xs font-semibold text-[#062E63] disabled:text-[#2A2035]/30 hover:bg-[#F8FAFF] px-2 py-0.5 rounded-full transition"
                aria-label="Next term"
              >
                →
              </button>
            </div>
          </div>

          {/* Fortnight tabs */}
          <div className="flex items-center gap-1 mt-6 overflow-x-auto -mx-1 px-1 no-scrollbar">
            {FORTNIGHT_LABELS.map((label, i) => {
              const idx = i + 1
              const active = idx === fortnight
              const dates = activeTerm ? fortnightDates(activeTerm, idx) : null
              return (
                <button
                  key={label}
                  onClick={() => selectFortnight(idx)}
                  className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                    active
                      ? 'bg-[#062E63] text-white border-[#062E63]'
                      : 'bg-white text-[#062E63] border-[#DEE7FF] hover:bg-[#F8FAFF]'
                  }`}
                >
                  {label}
                  {dates && (
                    <span className={`ml-2 text-[10px] font-medium ${active ? 'text-white/70' : 'text-[#2A2035]/40'}`}>
                      {fmtDate(dates.start)}–{fmtDate(dates.end)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Tutors</p>
              <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">{totals.tutorCount}</p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Shifts</p>
              <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">{totals.shiftCount}</p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Hours</p>
              <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">
                {totals.hours.toFixed(2)}
              </p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Total</p>
              <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">{fmtMoney(totals.amount)}</p>
            </div>
          </div>

          {totals.missingRate > 0 && (
            <div className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FCD34D] px-3 py-2 rounded-full">
              ⚠ {totals.missingRate} shift{totals.missingRate === 1 ? '' : 's'} missing a rate — set them inline below before approving.
            </div>
          )}
        </div>
      </section>

      {/* BODY */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {loading && (
          <p className="text-sm text-[#2A2035]/60">Loading shifts…</p>
        )}
        {error && (
          <div className="bg-[#FEE2E2] border border-[#FCA5A5] rounded-xl p-4 text-sm text-[#991B1B] mb-6">
            {error}
          </div>
        )}

        {!loading && shifts.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-4xl mb-2">🗓️</div>
            <p className="text-sm font-semibold text-[#2A2035]">No shifts in this period yet.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">
              Shifts are auto-created when tutors mark attendance.
            </p>
          </div>
        )}

        {byTutor.map(({ name, shifts: rows }) => {
          const sub = rows.reduce(
            (acc, s) => ({ h: acc.h + Number(s.hours || 0), a: acc.a + Number(s.amount || 0) }),
            { h: 0, a: 0 }
          )
          return (
            <div key={name} className="bg-white rounded-2xl border border-[#DEE7FF] mb-5 overflow-hidden">
              {/* Tutor header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF]">
                <div>
                  <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">
                    Tutor
                  </p>
                  <h2 className="text-lg font-semibold text-[#2A2035] font-display">{name}</h2>
                </div>
                <div className="text-right">
                  <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">
                    {rows.length} shift{rows.length === 1 ? '' : 's'} · {sub.h.toFixed(2)}h
                  </p>
                  <p className="text-lg font-semibold text-[#2A2035] font-display">{fmtMoney(sub.a)}</p>
                </div>
              </div>

              {/* Shift rows */}
              <div className="divide-y divide-[#DEE7FF]">
                {rows.map(s => (
                  <ShiftRow
                    key={s.id}
                    shift={s}
                    editable={editable}
                    saving={savingId === s.id}
                    onUpdate={(patch) => updateShift(s.id, patch)}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {/* Footer actions */}
        {!loading && shifts.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6 mt-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display mb-1">
                Pay run total
              </p>
              <p className="text-2xl font-bold text-[#2A2035] font-display">
                {fmtMoney(totals.amount)}
                <span className="text-sm font-medium text-[#2A2035]/50 ml-2">
                  / {totals.hours.toFixed(2)}h
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              {(run?.status === 'approved' || run?.status === 'exported' || run?.status === 'paid') ? (
                <button
                  onClick={exportCsv}
                  className="text-sm font-semibold text-[#062E63] bg-white border border-[#DEE7FF] hover:bg-[#F8FAFF] px-4 py-2 rounded-full transition"
                >
                  {run.status === 'exported' || run.status === 'paid' ? 'Re-export CSV' : 'Export Xero CSV'}
                </button>
              ) : (
                <button
                  disabled
                  title="Approve the run first"
                  className="text-sm font-semibold text-[#2A2035]/40 bg-white border border-[#DEE7FF] px-4 py-2 rounded-full cursor-not-allowed"
                >
                  Export Xero CSV
                </button>
              )}
              {editable ? (
                <button
                  onClick={approveRun}
                  disabled={approving || totals.shiftCount === 0}
                  className="text-sm font-semibold text-white bg-[#062E63] hover:bg-[#325099] disabled:bg-[#2A2035]/30 px-5 py-2 rounded-full transition"
                >
                  {approving ? 'Approving…' : `Approve all ${totals.shiftCount} shifts`}
                </button>
              ) : (
                <span className="text-xs font-semibold text-[#2A2035]/50">
                  Already {run?.status}
                </span>
              )}
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

// ─── Xero Bills CSV helpers ─────────────────────────────────────────────────
// Format docs: Xero → Business → Bills → Import. Required columns marked *.
// We emit one row per shift; multiple rows sharing an InvoiceNumber are
// imported as line items on a single bill.
function buildXeroCsv(rows, run) {
  const cols = [
    '*ContactName',
    'EmailAddress',
    '*InvoiceNumber',
    'Reference',
    '*InvoiceDate',
    '*DueDate',
    '*Description',
    '*Quantity',
    '*UnitAmount',
    '*AccountCode',
    '*TaxType',
  ]

  const invDate = ddmmyyyy(run.period_end)
  const dueDate = ddmmyyyy(addDays(run.period_end, DUE_DAYS_AFTER))
  const ref     = `CUBE Payroll ${run.period_start} → ${run.period_end}`

  // Stable invoice number per tutor per run, e.g. "CUBE-2026-05-18-AMBER"
  const invNumberFor = (tutor) => {
    const slug = (tutor?.full_name || tutor?.xero_contact_name || 'tutor')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30)
    return `CUBE-${run.period_start}-${slug}`
  }

  const lines = [cols.join(',')]
  for (const r of rows) {
    const tutor = r.tutors
    const contactName = tutor?.full_name || ''
    const email = tutor?.email || ''
    const inv   = invNumberFor(tutor)
    const desc  = (r.notes ? r.notes.replace(/^Auto:\s*/, '') : r.kind) +
                  ` · ${ddmmm(r.work_date)} ${(r.start_time || '').slice(0,5)}–${(r.end_time || '').slice(0,5)}`
    const qty   = Number(r.hours || 0).toFixed(2)
    const unit  = Number(r.rate_snapshot || 0).toFixed(2)

    lines.push([
      csvCell(contactName),
      csvCell(email),
      csvCell(inv),
      csvCell(ref),
      csvCell(invDate),
      csvCell(dueDate),
      csvCell(desc),
      qty,
      unit,
      csvCell(XERO_ACCOUNT_CODE),
      csvCell(XERO_TAX_TYPE),
    ].join(','))
  }
  return lines.join('\n')
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function ddmmyyyy(iso) {
  const [y, m, d] = (iso || '').split('-')
  return `${d}/${m}/${y}`
}
function ddmmm(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── One shift row — inline-editable while pay run is 'open' ────────────────
// Uses uncontrolled inputs with `key={shift.id|hours|rate}` so the row remounts
// after a save and picks up the new values without manual state syncing.
function lessonUrl(shift) {
  if (shift.source_table === 'class_session' && shift.source_id) {
    const idx = shift.source_id.indexOf('_')
    if (idx > 0) {
      const classId = shift.source_id.slice(0, idx)
      const date    = shift.source_id.slice(idx + 1)
      return `/tutor/classes/${classId}/${date}`
    }
  }
  return null
}

function ShiftRow({ shift, editable, saving, onUpdate }) {
  const rowKey = `${shift.id}-${shift.hours}-${shift.rate_snapshot ?? 'null'}`
  const url    = lessonUrl(shift)

  const commitHours = (raw) => {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n <= 24 && n !== Number(shift.hours)) onUpdate({ hours: n })
  }
  const commitRate = (raw) => {
    if (raw === '') return
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0 && n !== Number(shift.rate_snapshot)) onUpdate({ rate_snapshot: n })
  }

  const missingRate = shift.rate_snapshot == null
  const amount = (Number(shift.hours || 0) * (Number(shift.rate_snapshot) || 0)).toFixed(2)

  const linkClass = url ? 'group cursor-pointer hover:bg-[#F0F4FF] transition' : ''

  return (
    <div key={rowKey} className={`grid grid-cols-12 gap-3 items-center px-6 py-3 text-sm ${missingRate ? 'bg-[#FFFBEB]' : ''} ${linkClass}`}
      onClick={url && !editable ? () => window.open(url, '_blank') : undefined}
    >
      {/* date */}
      <div className="col-span-3 md:col-span-2">
        <p className={`font-semibold ${url ? 'text-[#325099] group-hover:text-[#062E63]' : 'text-[#2A2035]'} transition`}>{fmtDateLong(shift.work_date)}</p>
      </div>
      {/* class name + time */}
      <div className="col-span-9 md:col-span-4">
        <p className="font-medium text-[#2A2035] truncate flex items-center gap-1">
          {shift.notes?.replace(/^Auto:\s*/, '') || `(${shift.kind})`}
          {url && <span className="text-[#325099]/30 group-hover:text-[#325099] transition text-xs">↗</span>}
        </p>
        <p className="text-xs text-[#2A2035]/50">
          {fmtTime(shift.start_time)}–{fmtTime(shift.end_time)} · {shift.kind}
        </p>
      </div>
      {/* hours */}
      <div className="col-span-4 md:col-span-2">
        <label className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold block">Hours</label>
        {editable ? (
          <input
            type="number"
            step="0.25"
            min="0.25"
            max="24"
            defaultValue={String(shift.hours)}
            onBlur={e => commitHours(e.target.value)}
            disabled={saving}
            className="w-full text-sm font-semibold text-[#2A2035] bg-transparent border-b border-[#DEE7FF] focus:border-[#325099] focus:outline-none py-1"
          />
        ) : (
          <p className="text-sm font-semibold text-[#2A2035]">{Number(shift.hours).toFixed(2)}</p>
        )}
      </div>
      {/* rate */}
      <div className="col-span-4 md:col-span-2">
        <label className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold block">Rate</label>
        {editable ? (
          <input
            type="number"
            step="0.50"
            min="0"
            placeholder="—"
            defaultValue={shift.rate_snapshot == null ? '' : String(shift.rate_snapshot)}
            onBlur={e => commitRate(e.target.value)}
            disabled={saving}
            className={`w-full text-sm font-semibold bg-transparent border-b focus:outline-none py-1 ${
              missingRate ? 'border-[#FCD34D] text-[#92400E]' : 'border-[#DEE7FF] text-[#2A2035] focus:border-[#325099]'
            }`}
          />
        ) : (
          <p className="text-sm font-semibold text-[#2A2035]">{shift.rate_snapshot == null ? '—' : fmtMoney(shift.rate_snapshot)}</p>
        )}
      </div>
      {/* amount */}
      <div className="col-span-4 md:col-span-2 text-right">
        <label className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold block">Amount</label>
        <p className="text-sm font-bold text-[#062E63] font-display">{fmtMoney(amount)}</p>
      </div>
    </div>
  )
}

'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { formatTermLabel } from '../../../lib/terms'
import { T_ADMINS, T_CASH_LOG, T_CASH_PAY_STATUS, T_PAY_RUN_SHIFTS, T_SHIFTS, T_TERMS, T_TUTORS } from '../../../lib/tables'
import { fortnightlyRetainerFor } from '../../../lib/cashRetainers'

// tutors.pay_method → payment group. Anything unrecognised lands in 'unset'.
function payMethodGroup(pm) {
  const v = String(pm ?? '').toLowerCase()
  if (v.startsWith('bank')) return 'bank'
  if (v === 'cash') return 'cash'
  return 'unset'
}
const PM_GROUPS = [
  { id: 'bank',  icon: '🏦', title: 'Bank transfer', note: 'these will be pushed to Xero' },
  { id: 'cash',  icon: '💵', title: 'Cash',           note: 'paid in person — not pushed to Xero' },
  { id: 'unset', icon: '❓', title: 'Pay method not set', note: 'set pay_method (bank/cash) on the tutor/director record in the database explorer' },
]
import { registerUndoAction } from '../../../lib/undo'
import { fmtTime, fmtMoney, isoDate } from '../../../lib/format'
import { authedFetch } from '../../../lib/authedFetch'
import { SUPER_RATE } from '../../../lib/teacherCost'
import { buildPayslipPdfBase64, buildPayslipEmailHtml, payslipSubject } from '../../../lib/payslip'
import { TEST_RECIPIENT } from '../../../lib/emailConfig'
import XeroPayrollButtons from '../../../components/payroll/XeroPayrollPanel'

/*
 * Admin payroll review — term-aligned fortnights.
 *
 * Each CUBE term is 10 weeks → 5 fortnights (W1-2, W3-4, W5-6, W7-8, W9-10).
 * Navigation: 5 fortnight tabs across the active term, plus a small term
 * selector to flip between terms when needed.
 */

const FORTNIGHT_LABELS = ['W1 & 2', 'W3 & 4', 'W5 & 6', 'W7 & 8', 'W9 & 10']
const HOLIDAY_IDX = 6   // pseudo-fortnight for the break AFTER a term (Holidays tab)
const fortnightLabel = (idx) => idx === HOLIDAY_IDX ? 'Holidays' : (FORTNIGHT_LABELS[idx - 1] || '')

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
const addDaysIso = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d) }
// Super-guarantee quarter (= calendar quarter: Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun) containing a date.
const sgQuarterBounds = (iso) => {
  const d = new Date((iso || isoDate(new Date())) + 'T00:00:00')
  const qm = Math.floor(d.getMonth() / 3) * 3
  return { start: isoDate(new Date(d.getFullYear(), qm, 1)), end: isoDate(new Date(d.getFullYear(), qm + 3, 0)) }
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

// The break AFTER a term: day after it ends → day before the next term starts
// (mirrors pay_period_for's Holidays period). Falls back to +6 weeks if last term.
function holidayDatesFor(term, terms) {
  if (!term) return null
  const start = addDaysIso(term.end_date, 1)
  const next = (terms || []).filter(t => t.start_date > term.end_date)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0]
  const end = next ? addDaysIso(next.start_date, -1) : addDaysIso(term.end_date, 42)
  return { start, end }
}

// Dates for a tab index (1..5 fortnights, or HOLIDAY_IDX for the break).
function tabDates(term, idx, terms) {
  return idx === HOLIDAY_IDX ? holidayDatesFor(term, terms) : fortnightDates(term, idx)
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
  // Reaching here means today isn't inside any term → we're in a break, so land
  // on the Holidays tab of the most recent past term.
  const past = [...terms].sort((a, b) => b.end_date.localeCompare(a.end_date))
    .find(t => t.end_date < todayIso)
  if (past) return { term: past, fortnight: HOLIDAY_IDX }
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
  const [payMethods, setPayMethods] = useState({})   // tutor_id → pay_method (bank/cash)
  const [cashTutors, setCashTutors] = useState([])   // [{id, full_name, cash_pay_weekday}] for the cash pay schedule
  const [allTutors, setAllTutors] = useState([])     // every tutor — for the "add shift" picker
  const [addOpen, setAddOpen] = useState(false)      // add-shift form open
  const [addForm, setAddForm] = useState({ tutor_id: '', work_date: '', hours: '1', rate: '', notes: '' })
  const [adding, setAdding] = useState(false)
  const [emailByTutor, setEmailByTutor] = useState({})   // tutor_id → email (for payslips)
  const [quarterGrossByTutor, setQuarterGrossByTutor] = useState({})  // tutor_id → gross this SG quarter
  const [sendingPayslips, setSendingPayslips] = useState(false)
  const [payslipResults, setPayslipResults] = useState(null)
  const [payslipNote, setPayslipNote] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewIdx, setPreviewIdx] = useState(0)
  const [previewPdfUrl, setPreviewPdfUrl] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [cashPaid, setCashPaid] = useState({})       // tutor_id → cash_pay_status row (this run)
  const [payTab, setPayTab] = useState('bank')       // active pay-method tab
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [approving, setApproving] = useState(false)
  const [shiftActing, setShiftActing] = useState(null)   // shift id mid approve/undo
  const router = useRouter()

  // Load (or create) the pay run for the given (term, fortnight).
  const reload = async (term = activeTerm, idx = fortnight) => {
    if (!term) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const dates = tabDates(term, idx, terms)
      const { data: prData, error: prErr } = await supabase
        .rpc('ensure_pay_run', { p_date: dates.start })
      if (prErr) throw prErr
      const pr = Array.isArray(prData) ? prData[0] : prData
      setRun(pr)

      // Load by the shift's ASSIGNED pay period (computed by pay_period_for in the
      // view), not by work_date. Term-break dates (e.g. a makeup between terms)
      // get clamped to the adjacent fortnight, so their work_date falls outside
      // that fortnight's range — filtering by work_date would drop them entirely.
      const { data: sh, error: shErr } = await supabase
        .from(T_PAY_RUN_SHIFTS)
        .select('*')
        .eq('period_start', pr.period_start)
        .eq('period_end', pr.period_end)
        .order('tutor_name', { ascending: true })
        .order('work_date', { ascending: true })
        .order('start_time', { ascending: true })
      if (shErr) throw shErr
      setShifts(sh || [])

      // Quarter-to-date gross per tutor (SG quarter containing this run) — for the
      // payslip's "Super YTD this quarter" line.
      const q = sgQuarterBounds(pr.period_end)
      const { data: qsh } = await supabase
        .from(T_PAY_RUN_SHIFTS).select('tutor_id, amount')
        .gte('work_date', q.start).lte('work_date', q.end)
      const qg = {}
      for (const s of qsh || []) qg[s.tutor_id] = (qg[s.tutor_id] || 0) + Number(s.amount || 0)
      setQuarterGrossByTutor(qg)

      // Which cash tutors have already been marked paid for this run
      const { data: cps } = await supabase
        .from(T_CASH_PAY_STATUS)
        .select('*')
        .eq('pay_run_id', pr.id)
      setCashPaid(Object.fromEntries((cps || []).map(r => [r.tutor_id, r])))
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

      // Payable people = tutors + directors (directors teach makeups / cover, and
      // are paid via shifts too). Both tables carry pay_method/cash_pay_weekday;
      // staff_table records where edits (e.g. cash pay day) must be saved.
      const [{ data: tutorRows }, { data: dirRows }] = await Promise.all([
        supabase.from(T_TUTORS).select('id, full_name, email, pay_method, cash_pay_weekday'),
        supabase.from(T_ADMINS).select('id, full_name, email, pay_method, cash_pay_weekday'),
      ])
      const people = [
        ...(tutorRows || []).map(t => ({ ...t, staff_table: T_TUTORS })),
        ...(dirRows || []).map(d => ({ ...d, staff_table: T_ADMINS })),
      ]
      setPayMethods(Object.fromEntries(people.map(t => [t.id, t.pay_method])))
      setEmailByTutor(Object.fromEntries(people.map(t => [t.id, t.email])))
      setAllTutors(people.slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')))
      setCashTutors(people.filter(t => (t.pay_method || '').toLowerCase() === 'cash')
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')))

      const { term, fortnight: f } = pickInitialTermFortnight(allTerms, isoDate(new Date()))
      setActiveTerm(term)
      setFortnight(f)
      if (term) reload(term, f)
      else setLoading(false)

      // Pull Xero's posted-run truth in the background: posted runs flip their
      // shifts (and the portal run) to paid, so bank settlements never need a
      // manual catch-up. Refresh only if something actually settled.
      authedFetch('/api/xero/payroll/reconcile', { method: 'POST' })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          const settled = data && (data.shiftsMarkedPaid > 0 || (data.runsMarkedPaid?.length || 0) > 0)
          if (settled && term) reload(term, f)
        })
        .catch(() => {}) // Xero disconnected or offline — the page works without it
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const editable = run && ['open'].includes(run.status)

  // Group shifts by tutor for display (tagged with bank/cash pay group)
  const byTutor = useMemo(() => {
    const map = new Map()
    for (const s of shifts) {
      if (!map.has(s.tutor_id)) map.set(s.tutor_id, { name: s.tutor_name, payGroup: payMethodGroup(payMethods[s.tutor_id]), shifts: [] })
      map.get(s.tutor_id).shifts.push(s)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [shifts, payMethods])

  // Tutor options for the "add shift" picker — every tutor, plus anyone already
  // in this run (so it's never empty even if the tutor list is slow/unavailable).
  const tutorOptions = useMemo(() => {
    const map = new Map()
    for (const t of allTutors) map.set(t.id, t.full_name)
    for (const s of shifts) if (s.tutor_id && !map.has(s.tutor_id)) map.set(s.tutor_id, s.tutor_name)
    return [...map.entries()]
      .map(([id, full_name]) => ({ id, full_name }))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  }, [allTutors, shifts])

  // Bank vs cash split (Xero push will use the bank group only)
  const payGroups = useMemo(() => PM_GROUPS.map(g => {
    const tutors = byTutor.filter(t => t.payGroup === g.id)
    const sub = tutors.flatMap(t => t.shifts).reduce(
      (acc, s) => ({ h: acc.h + Number(s.hours || 0), a: acc.a + Number(s.amount || 0), n: acc.n + 1 }),
      { h: 0, a: 0, n: 0 }
    )
    return { ...g, tutors, sub }
  }).filter(g => g.tutors.length > 0), [byTutor])

  const totals = useMemo(() => {
    let hours = 0, amount = 0, missingRate = 0
    for (const s of shifts) {
      hours += Number(s.hours || 0)
      amount += Number(s.amount || 0)
      if (s.rate_snapshot == null) missingRate += 1
    }
    let approvedCount = 0, approvedAmount = 0
    for (const s of shifts) {
      if (s.status === 'approved') { approvedCount += 1; approvedAmount += Number(s.amount || 0) }
    }
    return { hours, amount, missingRate, approvedCount, approvedAmount, tutorCount: byTutor.length, shiftCount: shifts.length }
  }, [shifts, byTutor])

  // Inline-edit a shift. Re-prices and saves to DB.
  const updateShift = async (id, patch) => {
    setSavingId(id)
    try {
      // capture old values for undo before overwriting
      const before = shifts.find(s => s.id === id)
      const restore = before ? Object.fromEntries(Object.keys(patch).map(k => [k, before[k] ?? null])) : null
      const { error: e } = await supabase.from(T_SHIFTS).update(patch).eq('id', id)
      if (e) throw e
      if (restore) {
        registerUndoAction('shift edit', async () => {
          await supabase.from(T_SHIFTS).update(restore).eq('id', id)
          await reload()
        })
      }
      await reload()
    } catch (e) {
      alert('Save failed: ' + (e.message || String(e)))
    } finally {
      setSavingId(null)
    }
  }

  // Remove a shift from the pay run (only while it's 'open'). Undoable.
  const deleteShift = async (id) => {
    const before = shifts.find(s => s.id === id)
    if (!before) return
    if (!confirm(`Remove this shift (${before.tutor_name} · ${before.work_date})? It's deleted from the pay run.`)) return
    setSavingId(id)
    try {
      const { error: e } = await supabase.from(T_SHIFTS).delete().eq('id', id)
      if (e) throw e
      registerUndoAction('shift removed', async () => {
        await supabase.from(T_SHIFTS).insert({
          tutor_id: before.tutor_id, work_date: before.work_date, hours: before.hours, kind: before.kind,
          start_time: before.start_time ?? null, end_time: before.end_time ?? null,
          rate_snapshot: before.rate_snapshot ?? null, notes: before.notes ?? null,
          source_table: before.source_table ?? null, source_id: before.source_id ?? null, status: 'draft',
        })
        await reload()
      })
      await reload()
    } catch (e) {
      alert('Could not remove shift: ' + (e.message || String(e)))
    } finally {
      setSavingId(null)
    }
  }

  // Add a manual shift to the current run. Undoable.
  const addShift = async () => {
    const { tutor_id, work_date, hours, rate, notes } = addForm
    if (!tutor_id || !work_date || !(Number(hours) > 0)) { alert('Tutor, date and hours are required.'); return }
    setAdding(true)
    try {
      const { data, error: e } = await supabase.from(T_SHIFTS).insert({
        tutor_id, work_date, hours: Number(hours), kind: 'class',
        rate_snapshot: rate === '' ? null : Number(rate),
        source_table: 'manual', status: 'draft', notes: notes?.trim() || 'Manual shift',
      }).select('id').single()
      if (e) throw e
      if (data?.id) registerUndoAction('shift added', async () => {
        await supabase.from(T_SHIFTS).delete().eq('id', data.id); await reload()
      })
      setAddOpen(false)
      setAddForm({ tutor_id: '', work_date: '', hours: '1', rate: '', notes: '' })
      await reload()
    } catch (e) {
      alert('Could not add shift: ' + (e.message || String(e)))
    } finally {
      setAdding(false)
    }
  }

  // Mark a cash tutor as paid for this run → records an outflow in the cash log
  // and remembers the link so it can be reversed. `amount` is their cash total
  // for the current fortnight.
  const markCashPaid = async (tutor, amount) => {
    if (!run || !activeTerm) return
    const owed = Math.abs(Number(amount) || 0)
    const firstName = (tutor.full_name || '').split(' ')[0] || (tutor.full_name || 'Tutor')
    const termLabel = activeTerm.name || formatTermLabel(activeTerm)
    const fnLabel   = fortnightLabel(fortnight)
    const description = `${firstName} - ${termLabel} ${fnLabel}`.trim()
    try {
      // 1) Add the cash log outflow row
      const { data: logRow, error: e1 } = await supabase
        .from(T_CASH_LOG)
        .insert({
          date: isoDate(new Date()),
          direction: 'outflow',
          type: 'wages',
          description,
          amount: -owed,
          term_id: activeTerm.id,
        })
        .select('id')
        .single()
      if (e1) throw e1
      // 2) Record the paid status, linked to the log row for clean reversal
      const { data: st, error: e2 } = await supabase
        .from(T_CASH_PAY_STATUS)
        .insert({ pay_run_id: run.id, tutor_id: tutor.id, amount: owed, cash_log_id: logRow.id })
        .select('*')
        .single()
      if (e2) {
        await supabase.from(T_CASH_LOG).delete().eq('id', logRow.id) // roll back orphaned log row
        throw e2
      }
      setCashPaid(prev => ({ ...prev, [tutor.id]: st }))
    } catch (e) {
      alert('Could not mark as paid: ' + (e.message || String(e)))
    }
  }

  // Undo a cash payment → delete the auto-created cash log row and the status.
  const markCashUnpaid = async (tutor) => {
    const st = cashPaid[tutor.id]
    if (!st) return
    try {
      if (st.cash_log_id != null) {
        const { error: e1 } = await supabase.from(T_CASH_LOG).delete().eq('id', st.cash_log_id)
        if (e1) throw e1
      }
      const { error: e2 } = await supabase.from(T_CASH_PAY_STATUS).delete().eq('id', st.id)
      if (e2) throw e2
      setCashPaid(prev => { const n = { ...prev }; delete n[tutor.id]; return n })
    } catch (e) {
      alert('Could not mark as unpaid: ' + (e.message || String(e)))
    }
  }

  // Approve or pull back ONE shift. Approving attaches it to this run and the
  // run totals follow live; the run itself stays open until it is finalised.
  const approveShift = async (shift) => {
    setShiftActing(shift.id)
    try {
      const { error: e } = await supabase.rpc('approve_shift', { p_shift: shift.id, p_pay_run: run.id })
      if (e) throw e
      await reload()
    } catch (e) {
      alert('Could not approve the shift: ' + (e.message || String(e)))
    } finally { setShiftActing(null) }
  }
  const unapproveShift = async (shift) => {
    setShiftActing(shift.id)
    try {
      const { error: e } = await supabase.rpc('unapprove_shift', { p_shift: shift.id })
      if (e) throw e
      await reload()
    } catch (e) {
      alert('Could not unapprove the shift: ' + (e.message || String(e)))
    } finally { setShiftActing(null) }
  }

  const approveRun = async () => {
    const pending = totals.shiftCount - totals.approvedCount
    if (!confirm(`Approve ${pending ? `the remaining ${pending}` : 'all'} shift${pending === 1 ? '' : 's'} and finalise this run? Run total: ${fmtMoney(totals.amount)}`)) return
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

  // Finalise the run with ONLY the individually-approved shifts — the pending
  // ones stay submitted and unattached, to be dealt with separately.
  const finaliseApprovedOnly = async () => {
    const pending = totals.shiftCount - totals.approvedCount
    if (!confirm(`Finalise this run with only the ${totals.approvedCount} approved shift${totals.approvedCount === 1 ? '' : 's'} (${fmtMoney(totals.approvedAmount)})?\n\n${pending} pending shift${pending === 1 ? '' : 's'} will be left out of the run — they stay unpaid until approved into a run later.`)) return
    setApproving(true)
    try {
      const { error: e } = await supabase.rpc('approve_pay_run', { p_pay_run: run.id, p_sweep: false })
      if (e) throw e
      await reload()
    } catch (e) {
      alert('Finalising failed: ' + (e.message || String(e)))
    } finally {
      setApproving(false)
    }
  }

  // ── Payslips — one per tutor for this run (PDF + email summary) ──────────────
  // A finalised run may hold only SOME of the fortnight's shifts (approved
  // individually, finalised without the sweep). Payslips cover what the run
  // pays: the shifts attached to it — never the pending leftovers.
  const runFinalised = ['approved', 'exported', 'paid'].includes(run?.status)
  const paidShiftsOf = (g) => (runFinalised ? g.shifts.filter(s => s.pay_run_id === run.id) : g.shifts)
  const payslipDataFor = (g) => {
    const paidShifts = paidShiftsOf(g)
    const tutorId   = g.shifts[0]?.tutor_id
    const payMethod = (payMethods[tutorId] || 'bank').toLowerCase()
    const mapShift = (s) => ({
      date: fmtDate(s.work_date),
      description: (s.notes || '').replace(/^Auto:\s*/, '') || `(${s.kind})`,
      hours: Number(s.hours || 0), rate: s.rate_snapshot, amount: Number(s.amount || 0),
    })
    const shifts = paidShifts.map(mapShift)
    // Split into the two weeks of the fortnight (Week 1 = first 7 days).
    const weekIdx = (wd) => {
      if (!run?.period_start) return 0
      const diff = Math.floor((new Date(wd + 'T00:00:00') - new Date(run.period_start + 'T00:00:00')) / 86400000)
      return diff < 7 ? 0 : 1
    }
    const buckets = [[], []]
    for (const s of paidShifts) buckets[Math.min(1, Math.max(0, weekIdx(s.work_date)))].push(s)
    const weeks = buckets.map((arr, wi) => ({
      label: `Week ${wi + 1}`,
      range: run?.period_start ? `${fmtDate(addDaysIso(run.period_start, wi * 7))}–${fmtDate(addDaysIso(run.period_start, wi * 7 + 6))}` : '',
      shifts: arr.map(mapShift),
      hours: arr.reduce((a, s) => a + Number(s.hours || 0), 0),
      amount: arr.reduce((a, s) => a + Number(s.amount || 0), 0),
    })).filter(w => w.shifts.length)
    const gross = paidShifts.reduce((a, s) => a + Number(s.amount || 0), 0)
    const hours = paidShifts.reduce((a, s) => a + Number(s.hours || 0), 0)
    const superAmount = payMethod !== 'cash' ? gross * SUPER_RATE : 0
    const superYtd    = payMethod !== 'cash' ? (Number(quarterGrossByTutor[tutorId] || 0) * SUPER_RATE) : 0
    const periodLabel = `${activeTerm?.name ? activeTerm.name + ' · ' : ''}${fortnightLabel(fortnight)} (${fmtDate(run?.period_start)}–${fmtDate(run?.period_end)})`
    const paymentDate = run?.period_start ? fmtDateLong(addDaysIso(run.period_start, 14)) : null
    return { tutorId, email: emailByTutor[tutorId] || null, tutorName: g.name, periodLabel, paymentDate, payMethod, shifts, weeks, hours, gross, superAmount, superYtd, total: gross + superAmount }
  }

  // Emailed payslips go to bank-transfer teachers only. Cash teachers are paid
  // in person outside Xero/STP, so an emailed "payslip" would overstate what the
  // formal payroll covers; their pay lives in the cash schedule + cash log.
  const payslipTutors = useMemo(
    () => byTutor.filter(t => t.payGroup !== 'cash' && paidShiftsOf(t).length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byTutor, run?.status, run?.id])

  const buildPayslips = async () => {
    const out = []
    for (const g of payslipTutors) {
      const data = payslipDataFor(g)
      const pdf_base64 = await buildPayslipPdfBase64(data)
      out.push({
        name: data.tutorName, email: data.email,
        subject: payslipSubject(data.periodLabel), body: buildPayslipEmailHtml(data),
        pdf_base64, pdf_filename: `${(data.tutorName || 'tutor').replace(/[^a-z0-9]+/gi, '_')}_payslip.pdf`,
      })
    }
    return out
  }

  // Generate + show one tutor's payslip PDF in the preview modal.
  const loadPreview = async (idx) => {
    const g = byTutor[idx]
    if (!g) return
    setPreviewBusy(true)
    try {
      const b64   = await buildPayslipPdfBase64(payslipDataFor(g))
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const url   = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      setPreviewPdfUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })
    } catch (e) {
      alert('Preview failed: ' + (e.message || String(e)))
    } finally {
      setPreviewBusy(false)
    }
  }
  const openPreview = () => { setPreviewOpen(true); setPreviewIdx(0); loadPreview(0) }
  const closePreview = () => {
    setPreviewOpen(false)
    setPreviewPdfUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }

  const sendPayslips = async (test) => {
    if (!run || !['approved', 'exported', 'paid'].includes(run.status)) {
      alert('Payslips can be sent once the pay run is approved.'); return
    }
    if (!payslipTutors.length) { alert('No bank-paid teachers in this run — cash teachers don\'t get emailed payslips.'); return }
    if (!test && !confirm(`Send payslips to ${payslipTutors.length} bank-paid teacher${payslipTutors.length === 1 ? '' : 's'}? Cash-paid teachers are skipped. Each gets their own PDF payslip.`)) return
    setSendingPayslips(true); setPayslipResults(null); setPayslipNote(null)
    try {
      let payslips = await buildPayslips()
      if (test) payslips = payslips.slice(0, 1)   // one sample, redirected to staff
      const res = await authedFetch('/api/send-payslips', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payslips, test: !!test }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      if (test) setPayslipNote(`Sample payslip sent to ${TEST_RECIPIENT}.`)
      else setPayslipResults(data)
    } catch (e) {
      alert('Payslip send failed: ' + (e.message || String(e)))
    } finally {
      setSendingPayslips(false)
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
                {fortnightLabel(fortnight) || '—'}
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
            {/* Holidays tab — the break after the term (e.g. a makeup between terms) */}
            {(() => {
              const active = fortnight === HOLIDAY_IDX
              const dates = activeTerm ? holidayDatesFor(activeTerm, terms) : null
              return (
                <button
                  key="holidays"
                  onClick={() => selectFortnight(HOLIDAY_IDX)}
                  className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                    active
                      ? 'bg-[#062E63] text-white border-[#062E63]'
                      : 'bg-white text-[#062E63] border-[#DEE7FF] hover:bg-[#F8FAFF]'
                  }`}
                >
                  🏖 Holidays
                  {dates && (
                    <span className={`ml-2 text-[10px] font-medium ${active ? 'text-white/70' : 'text-[#2A2035]/40'}`}>
                      {fmtDate(dates.start)}–{fmtDate(dates.end)}
                    </span>
                  )}
                </button>
              )
            })()}
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

        {/* Pay-method tabs — bank vs cash (vs not-set when present) */}
        {!loading && payGroups.length > 0 && (
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {payGroups.map(g => (
              <button
                key={g.id}
                onClick={() => setPayTab(g.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition ${
                  (payGroups.find(x => x.id === payTab) ?? payGroups[0]).id === g.id
                    ? 'bg-[#DEE7FF] text-[#062E63] border-[#BACBFF]'
                    : g.id === 'unset'
                      ? 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] hover:border-[#F59E0B]'
                      : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
                }`}
              >
                {g.icon} {g.title}
                <span className="text-[10px] font-bold opacity-70">{g.tutors.length} tutor{g.tutors.length === 1 ? '' : 's'} · {fmtMoney(g.sub.a)}</span>
              </button>
            ))}
          </div>
        )}

        {payTab === 'cash' && <CashSchedulePanel tutors={cashTutors} shifts={shifts} onChange={setCashTutors} paid={cashPaid} onMarkPaid={markCashPaid} onMarkUnpaid={markCashUnpaid} canPay={!!run} />}

        {[payGroups.find(g => g.id === payTab) ?? payGroups[0]].filter(Boolean).map(group => (
          <div key={group.id} className="mb-8">
            {/* Pay-method group header */}
            <div className={`flex items-center justify-between px-5 py-3 rounded-2xl mb-4 border ${group.id === 'unset' ? 'bg-[#FFFBEB] border-[#FDE68A]' : 'bg-[#EEF4FF] border-[#BACBFF]'}`}>
              <div>
                <p className={`text-sm font-bold ${group.id === 'unset' ? 'text-[#92400E]' : 'text-[#062E63]'}`}>{group.icon} {group.title}</p>
                <p className={`text-[10px] ${group.id === 'unset' ? 'text-[#92400E]/70' : 'text-[#325099]/60'}`}>{group.note}</p>
              </div>
              <div className="text-right">
                <p className={`text-[10px] tracking-[0.2em] uppercase font-semibold ${group.id === 'unset' ? 'text-[#92400E]/70' : 'text-[#325099]/60'}`}>
                  {group.tutors.length} tutor{group.tutors.length === 1 ? '' : 's'} · {group.sub.n} shift{group.sub.n === 1 ? '' : 's'} · {group.sub.h.toFixed(2)}h
                </p>
                <p className={`text-lg font-bold font-display ${group.id === 'unset' ? 'text-[#92400E]' : 'text-[#062E63]'}`}>{fmtMoney(group.sub.a)}</p>
              </div>
            </div>

            {group.tutors.map(({ name, shifts: rows }) => {
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
                    onDelete={() => deleteShift(s.id)}
                    approval={run ? {
                      canAct: !['exported', 'paid'].includes(run.status),
                      acting: shiftActing === s.id,
                      onApprove: () => approveShift(s),
                      onUndo: () => unapproveShift(s),
                    } : null}
                  />
                ))}
              </div>
            </div>
          )
        })}
          </div>
        ))}

        {/* Add a manual shift (only while the run is open) */}
        {!loading && editable && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-4 mt-5">
            {!addOpen ? (
              <button onClick={() => { setAddOpen(true); setAddForm(f => ({ ...f, work_date: f.work_date || (run?.period_start || '') })) }}
                className="text-sm font-semibold text-[#325099] hover:text-[#062E63]">＋ Add a shift</button>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-bold text-[#062E63]">Add a manual shift</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-[10px] uppercase tracking-wider text-[#325099]/70 font-semibold block mb-1">Tutor</label>
                    <select value={addForm.tutor_id} onChange={e => setAddForm(f => ({ ...f, tutor_id: e.target.value }))}
                      className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm bg-white">
                      <option value="">—</option>
                      {tutorOptions.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-[#325099]/70 font-semibold block mb-1">Date</label>
                    <input type="date" value={addForm.work_date} min={run?.period_start} max={run?.period_end}
                      onChange={e => setAddForm(f => ({ ...f, work_date: e.target.value }))}
                      className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm bg-white" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-[#325099]/70 font-semibold block mb-1">Hours</label>
                    <input type="number" step="0.25" min="0.25" value={addForm.hours}
                      onChange={e => setAddForm(f => ({ ...f, hours: e.target.value }))}
                      className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm bg-white" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-[#325099]/70 font-semibold block mb-1">Rate $/h</label>
                    <input type="number" step="0.50" min="0" placeholder="—" value={addForm.rate}
                      onChange={e => setAddForm(f => ({ ...f, rate: e.target.value }))}
                      className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm bg-white" />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-[10px] uppercase tracking-wider text-[#325099]/70 font-semibold block mb-1">Note</label>
                    <input value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder="e.g. extra tutoring" className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm bg-white" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={addShift} disabled={adding}
                    className="text-sm font-semibold text-white bg-[#062E63] hover:bg-[#325099] px-4 py-2 rounded-full disabled:opacity-50">
                    {adding ? 'Adding…' : 'Add shift'}</button>
                  <button onClick={() => setAddOpen(false)} disabled={adding}
                    className="text-sm font-semibold text-[#325099] px-3 py-2">Cancel</button>
                  <span className="text-[11px] text-[#2A2035]/45">Date must fall within this fortnight to appear in the run.</span>
                </div>
              </div>
            )}
          </div>
        )}

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
            <div className="flex items-center gap-3 flex-wrap">
              <XeroPayrollButtons run={run} canPush={['approved', 'exported', 'paid'].includes(run?.status)} />
              {(run?.status === 'approved' || run?.status === 'exported' || run?.status === 'paid') && (
                <>
                  <button onClick={openPreview} disabled={sendingPayslips || !byTutor.length}
                    className="text-sm font-semibold text-[#325099] bg-white border border-[#DEE7FF] hover:bg-[#F0F4FF] px-4 py-2 rounded-full transition disabled:opacity-50">
                    👁 Preview
                  </button>
                  <button onClick={() => sendPayslips(false)} disabled={sendingPayslips || !payslipTutors.length}
                    title="Bank-transfer teachers only — cash-paid teachers are skipped"
                    className="text-sm font-semibold text-white bg-[#325099] hover:bg-[#062E63] px-4 py-2 rounded-full transition disabled:opacity-50">
                    {sendingPayslips ? 'Sending…' : `📄 Send payslips (${payslipTutors.length})`}
                  </button>
                  <button onClick={() => sendPayslips(true)} disabled={sendingPayslips}
                    title="Send one sample payslip to CUBE staff"
                    className="text-sm font-semibold text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] hover:bg-[#FEF3C7] px-3 py-2 rounded-full transition disabled:opacity-50">
                    🧪 Test to me
                  </button>
                </>
              )}
              {editable ? (
                <>
                  {totals.approvedCount > 0 && (
                    <span className="text-xs font-semibold text-[#065F46]">
                      {totals.approvedCount}/{totals.shiftCount} approved · {fmtMoney(totals.approvedAmount)}
                    </span>
                  )}
                  {totals.approvedCount > 0 && totals.approvedCount < totals.shiftCount && (
                    <button
                      onClick={finaliseApprovedOnly}
                      disabled={approving}
                      title="Finalise the run with only the shifts approved so far; the rest stay out of it"
                      className="text-sm font-semibold text-[#065F46] bg-[#D1FAE5] hover:bg-[#A7F3D0] px-4 py-2 rounded-full transition disabled:opacity-50"
                    >
                      Finalise {totals.approvedCount} approved only
                    </button>
                  )}
                  <button
                    onClick={approveRun}
                    disabled={approving || totals.shiftCount === 0}
                    className="text-sm font-semibold text-white bg-[#062E63] hover:bg-[#325099] disabled:bg-[#2A2035]/30 px-5 py-2 rounded-full transition"
                  >
                    {approving ? 'Approving…'
                      : totals.approvedCount > 0 && totals.approvedCount < totals.shiftCount
                        ? `Approve remaining ${totals.shiftCount - totals.approvedCount} & finalise`
                        : `Approve all ${totals.shiftCount} shifts`}
                  </button>
                </>
              ) : (
                <span className="text-xs font-semibold text-[#2A2035]/50">
                  Already {run?.status}
                </span>
              )}
            </div>
            {(payslipNote || payslipResults) && (
              <div className="w-full mt-1 text-xs">
                {payslipNote && <p className="text-emerald-700">{payslipNote}</p>}
                {payslipResults && (
                  <>
                    <p className="text-[#062E63] font-semibold">Payslips sent {payslipResults.successCount}/{payslipResults.total}.</p>
                    {payslipResults.results?.filter(r => !r.success).map((r, i) => <p key={i} className="text-rose-600">{r.name || r.email}: {r.error}</p>)}
                  </>
                )}
              </div>
            )}
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

      {previewOpen && byTutor[previewIdx] && (() => {
        const data = payslipDataFor(byTutor[previewIdx])
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={closePreview}>
            <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[#DEE7FF]">
                <div className="flex items-center gap-3 min-w-0">
                  <p className="text-sm font-bold text-[#062E63] shrink-0">Payslip preview</p>
                  <select value={previewIdx}
                    onChange={e => { const i = Number(e.target.value); setPreviewIdx(i); loadPreview(i) }}
                    className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-sm bg-white max-w-[200px]">
                    {byTutor.map((g, i) => <option key={i} value={i}>{g.name}</option>)}
                  </select>
                  <span className="text-xs text-[#2A2035]/45 truncate hidden sm:inline">
                    {data.email || 'no email'} · {fmtMoney(data.total)}
                  </span>
                </div>
                <button onClick={closePreview} className="text-[#325099]/40 hover:text-[#325099] text-xl leading-none">✕</button>
              </div>
              <div className="overflow-y-auto p-4 space-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#325099]/60 font-semibold mb-1">PDF payslip (attached)</p>
                  {previewBusy ? (
                    <p className="text-sm text-[#2A2035]/40 py-12 text-center animate-pulse">Generating…</p>
                  ) : previewPdfUrl ? (
                    <iframe title="payslip-pdf" src={previewPdfUrl} className="w-full h-[55vh] border border-[#DEE7FF] rounded-xl bg-white" />
                  ) : null}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#325099]/60 font-semibold mb-1">Email body</p>
                  <iframe title="payslip-email" srcDoc={buildPayslipEmailHtml(data)} className="w-full h-64 border border-[#DEE7FF] rounded-xl bg-white" />
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
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

function ShiftRow({ shift, editable, saving, onUpdate, onDelete, approval = null }) {
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
    <div key={rowKey} className={`relative grid grid-cols-12 gap-3 items-center px-6 py-3 text-sm ${missingRate ? 'bg-[#FFFBEB]' : ''} ${linkClass}`}
      onClick={url && !editable ? () => window.open(url, '_blank') : undefined}
    >
      {editable && onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          disabled={saving}
          title="Remove this shift from the pay run"
          className="absolute top-1.5 right-2 text-[#B23A3A]/40 hover:text-[#B23A3A] text-sm leading-none disabled:opacity-30"
        >✕</button>
      )}
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
      {/* amount + per-shift approval */}
      <div className="col-span-4 md:col-span-2 text-right">
        <label className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold block">Amount</label>
        <p className="text-sm font-bold text-[#062E63] font-display">{fmtMoney(amount)}</p>
        {approval && (
          shift.status === 'approved' ? (
            <p className="text-[10px] font-bold text-[#065F46] mt-0.5">
              ✓ Approved
              {approval.canAct && (
                <button
                  onClick={e => { e.stopPropagation(); approval.onUndo() }}
                  disabled={approval.acting}
                  className="ml-1.5 font-semibold text-[#2A2035]/40 hover:text-[#B23A3A] disabled:opacity-40"
                >{approval.acting ? '…' : 'Undo'}</button>
              )}
            </p>
          ) : approval.canAct ? (
            <button
              onClick={e => { e.stopPropagation(); approval.onApprove() }}
              disabled={approval.acting || missingRate}
              title={missingRate ? 'Set a rate before approving' : 'Approve just this shift'}
              className="mt-0.5 text-[10px] font-bold text-[#065F46] bg-[#D1FAE5] hover:bg-[#A7F3D0] rounded-full px-2 py-0.5 transition disabled:opacity-40"
            >{approval.acting ? 'Approving…' : 'Approve'}</button>
          ) : (
            <p className="text-[10px] font-semibold text-[#92400E] mt-0.5">Pending</p>
          )
        )}
      </div>
    </div>
  )
}

// Cash pay schedule — set the recurring weekday each cash teacher is paid. Cash
// is paid in the LAST week of each fortnight; the Action Centre raises a reminder
// on that weekday with the amount owed (computed from their approved shifts).
const WEEKDAYS = [{ v: 1, l: 'Monday' }, { v: 2, l: 'Tuesday' }, { v: 3, l: 'Wednesday' }, { v: 4, l: 'Thursday' }, { v: 5, l: 'Friday' }, { v: 6, l: 'Saturday' }, { v: 7, l: 'Sunday' }]

function CashSchedulePanel({ tutors, shifts, onChange, paid = {}, onMarkPaid, onMarkUnpaid, canPay = true }) {
  const [busyId, setBusyId] = useState(null)
  // Owed this run = approved shift pay + any fortnightly director retainer, so
  // the recorded cash payment covers both and the accounting board clears.
  const amt = {}
  for (const s of shifts || []) amt[s.tutor_id] = (amt[s.tutor_id] || 0) + Number(s.amount || 0)
  const retainerOf = {}
  for (const t of tutors || []) retainerOf[t.id] = fortnightlyRetainerFor(t.full_name)
  const setDay = async (id, val) => {
    const wd = val === '' ? null : Number(val)
    const person = tutors.find(t => t.id === id)
    onChange(prev => prev.map(t => (t.id === id ? { ...t, cash_pay_weekday: wd } : t)))
    await supabase.from(person?.staff_table || T_TUTORS).update({ cash_pay_weekday: wd }).eq('id', id)
  }
  const togglePaid = async (t) => {
    setBusyId(t.id)
    try {
      if (paid[t.id]) await onMarkUnpaid?.(t)
      else await onMarkPaid?.(t, (amt[t.id] || 0) + (retainerOf[t.id] || 0))
    } finally {
      setBusyId(null)
    }
  }
  return (
    <div className="mb-6 bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="px-5 py-3 bg-[#F8FAFF] border-b border-[#DEE7FF]">
        <p className="text-sm font-bold text-[#062E63]">🗓 Cash pay schedule</p>
        <p className="text-[11px] text-[#325099]/60">Pick the weekday each cash teacher is paid. When you hand over the cash, hit <span className="font-semibold">Mark paid</span> — it records the outflow in the Cash Log automatically. Marking unpaid removes that log row.</p>
      </div>
      {tutors.length === 0 ? (
        <p className="px-5 py-6 text-xs text-[#2A2035]/45">No cash teachers yet. Set a tutor’s or director’s pay method to “cash” in the database explorer to schedule them here.</p>
      ) : (
        <div className="divide-y divide-[#F0F4FF]">
          {tutors.map(t => {
            const isPaid = !!paid[t.id]
            const owed   = (amt[t.id] || 0) + (retainerOf[t.id] || 0)
            const busy   = busyId === t.id
            return (
            <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="flex-1 text-sm font-medium text-[#2A2035] truncate">{t.full_name}</span>
              <span className="text-[11px] text-[#2A2035]/45 w-40 text-right tabular-nums" title={retainerOf[t.id] ? `${fmtMoney(amt[t.id] || 0)} shifts + ${fmtMoney(retainerOf[t.id])} retainer` : undefined}>
                {owed ? `${fmtMoney(owed)} this run${retainerOf[t.id] ? ' *' : ''}` : '—'}
              </span>
              <select value={t.cash_pay_weekday ?? ''} onChange={e => setDay(t.id, e.target.value)}
                className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#325099]">
                <option value="">No pay day set</option>
                {WEEKDAYS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
              </select>
              <button
                onClick={() => togglePaid(t)}
                disabled={busy || !canPay || (!isPaid && owed <= 0)}
                title={isPaid ? 'Remove the cash log entry and mark unpaid' : owed <= 0 ? 'Nothing owed this run' : 'Record this cash payment in the Cash Log'}
                className={`w-32 shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  isPaid
                    ? 'bg-[#D1FAE5] text-[#065F46] border-[#A7F3D0] hover:bg-[#FEE2E2] hover:text-[#991B1B] hover:border-[#FCA5A5]'
                    : 'bg-[#062E63] text-white border-[#062E63] hover:bg-[#325099]'
                }`}
              >
                {busy ? '…' : isPaid ? '✓ Paid · undo' : '💵 Mark paid'}
              </button>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

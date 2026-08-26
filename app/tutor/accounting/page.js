'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { fetchAllTerms, getEnrolmentTerm, formatTermLabel } from '../../../lib/terms'
import { DUE_DATES, daysUntil } from '../../../lib/complianceDates'
import { projectedTeacherPay, LESSONS_PER_TERM } from '../../../lib/teacherCost'
import { CASH_RETAINERS, RETAINERS_FROM, fortnightlyRetainerFor } from '../../../lib/cashRetainers'

/*
 * Accounting Dashboard — /tutor/accounting
 * ─────────────────────────────────────────────────────────────────────────────
 * Daily command centre for directors: everything across invoicing, payroll,
 * tax/compliance, bookkeeping and reconciliation that needs action, is overdue,
 * is coming up, is missing, or needs review.
 *
 * Compliance items can be marked done per period (portal_settings
 * 'compliance_done').
 */

// Name a pay period the way staff think about it: term + week range, or the
// holidays between two terms. Pay runs are fortnightly, so most land on a clean
// two-week block inside one term.
const shortTerm = (t) => (t?.name || '').replace(/\s*\d{4}\s*$/, '').trim() || 'Term'

function labelPeriod(startISO, endISO, terms = []) {
  if (!startISO || !endISO) return 'Unscheduled'
  const day = (iso) => new Date(iso + 'T00:00:00')
  const s = day(startISO), e = day(endISO)
  const overlapping = (terms || [])
    .filter(t => t.start_date && t.end_date && s <= day(t.end_date) && e >= day(t.start_date))
    .sort((a, b) => a.start_date.localeCompare(b.start_date))

  if (!overlapping.length) {
    const before = (terms || []).filter(t => t.end_date && t.end_date < startISO)
      .sort((a, b) => b.end_date.localeCompare(a.end_date))[0]
    return before ? `Holidays after ${shortTerm(before)}` : 'School holidays'
  }

  const t = overlapping[0]
  const ts = day(t.start_date), te = day(t.end_date)
  const weekOf = (d) => Math.max(1, Math.floor((d - ts) / (7 * 86400000)) + 1)
  const w1 = weekOf(s < ts ? ts : s)
  const w2 = weekOf(e > te ? te : e)
  const weeks = w2 > w1 ? `Wk ${w1}–${w2}` : `Wk ${w1}`
  // A run that runs off the end of term finishes in the break.
  return `${shortTerm(t)} · ${weeks}${e > te ? ' → holidays' : ''}`
}

const fmtMoney = (n) => '$' + Math.abs(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtD = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'
const todayIso = () => new Date().toISOString().slice(0, 10)
const COMPLIANCE_DONE_KEY = 'compliance_done'
const SEV = {
  red:   { dot: 'bg-rose-500',  chip: 'bg-rose-100 text-rose-700 border-rose-200' },
  amber: { dot: 'bg-amber-400', chip: 'bg-amber-100 text-amber-700 border-amber-200' },
  blue:  { dot: 'bg-blue-400',  chip: 'bg-blue-100 text-blue-700 border-blue-200' },
}

function Panel({ icon, title, badge, badgeCls, children, footer }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFF] border-b border-[#F0F4FF]">
        <p className="text-xs font-bold text-[#062E63]">{icon} {title}</p>
        {badge != null && (
          <span className={`text-[9px] font-bold uppercase tracking-wider border px-2 py-0.5 rounded-full ${badgeCls}`}>{badge}</span>
        )}
      </div>
      <div className="flex-1">{children}</div>
      {footer}
    </div>
  )
}

function AlertRow({ item, onTask }) {
  const body = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${SEV[item.severity]?.dot ?? 'bg-gray-300'}`} />
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-semibold text-[#2A2035]">{item.title}</span>
        {item.detail && <span className="block text-[11px] text-[#2A2035]/50 leading-relaxed">{item.detail}</span>}
      </span>
      {item.amount != null && <span className="text-xs font-bold text-[#062E63] tabular-nums shrink-0">{fmtMoney(item.amount)}</span>}
    </>
  )
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5 group hover:bg-[#F8FAFF] transition">
      {item.href && item.href.startsWith('http')
        ? <a href={item.href} target="_blank" rel="noreferrer" className="flex items-start gap-2.5 flex-1 min-w-0">{body}</a>
        : item.href
          ? <Link href={item.href} className="flex items-start gap-2.5 flex-1 min-w-0">{body}</Link>
          : <div className="flex items-start gap-2.5 flex-1 min-w-0">{body}</div>}
      <div className="flex items-center gap-1.5 shrink-0">
        {item.markDone && (
          <button onClick={item.markDone} title="Mark done for this period"
            className="text-[9px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 px-2 py-0.5 rounded-full hover:bg-emerald-100 transition opacity-0 group-hover:opacity-100">
            ✓ Done
          </button>
        )}
        {onTask && (
          <button onClick={() => onTask(item)} title="Create a director task from this"
            className="text-[9px] font-bold text-[#325099] border border-[#DEE7FF] px-2 py-0.5 rounded-full hover:bg-[#F0F4FF] transition opacity-0 group-hover:opacity-100">
            + Task
          </button>
        )}
      </div>
    </div>
  )
}

const Empty = ({ msg }) => <p className="px-4 py-5 text-[11px] text-[#2A2035]/40">{msg}</p>

export default function AccountingDashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [checkedAt, setCheckedAt] = useState(null)

  // raw data
  const [terms, setTerms] = useState([])
  const [term, setTerm] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [shiftsSubmitted, setShiftsSubmitted] = useState(0)
  const [payRuns, setPayRuns] = useState([])
  const [cashLast, setCashLast] = useState(null)      // latest cash_log date
  const [cashTerm, setCashTerm] = useState({ inflow: 0, outflow: 0 })
  // Termly cash snapshot: income from cash-marked invoices vs projected pay for
  // cash-paid teachers (full-term forecast).
  const [cashIncome, setCashIncome] = useState(0)
  const [cashInvoices, setCashInvoices] = useState([])   // itemised cash-marked invoices this term
  const [cashTeacherPay, setCashTeacherPay] = useState({ total: 0, perTutor: [], missingRate: [] })
  const [noPrice, setNoPrice] = useState(0)           // active enrolments without price (current term)
  const [noEmailFamilies, setNoEmailFamilies] = useState(0)
  const [complianceDone, setComplianceDone] = useState({})
  // Unpaid teacher pay, accumulated per teacher per pay run. Anything not yet
  // marked paid is money still owed — being on the board at all means overdue.
  const [unpaidPay, setUnpaidPay] = useState({ rows: [], allSquare: [], owed: 0, draft: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    const allTerms = await fetchAllTerms()
    setTerms(allTerms)
    const cur = getEnrolmentTerm(allTerms)
    setTerm(cur)

    const [invRes, shiftsRes, runsRes, cashRes, cashTermRes, enrolRes, studRes, guardRes, doneRes, dirRes, classesRes, tutorsRes, ratesRes, coursesRes, unpaidRes, allRunsRes, cashPaidRes] = await Promise.all([
      supabase.from('invoices')
        .select('id, invoice_number, family_id, student_id, status, delivery_status, payment_status, due_date, total, term_id, created_at, xero_invoice_id, xero_status, payment_method')
        .neq('status', 'voided'),
      supabase.from('shifts').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      supabase.from('pay_runs').select('*').order('period_end', { ascending: false }).limit(4),
      supabase.from('cash_log').select('date').order('date', { ascending: false }).limit(1),
      cur ? supabase.from('cash_log').select('direction, amount').gte('date', cur.start_date).lte('date', cur.end_date) : { data: [] },
      cur ? supabase.from('enrolments').select('id, price, status, classes!inner(term_id)').eq('status', 'active').eq('classes.term_id', cur.id).is('price', null) : { data: [] },
      supabase.from('students').select('id, full_name').eq('status', 'active'),
      supabase.from('guardians').select('student_id, email'),
      supabase.from('portal_settings').select('value').eq('key', COMPLIANCE_DONE_KEY).maybeSingle(),
      supabase.from('directors').select('id, full_name, pay_method'),
      cur ? supabase.from('classes').select('id, class_name, teacher, start_time, end_time, course_id, term_id').eq('term_id', cur.id) : { data: [] },
      supabase.from('tutors').select('id, full_name, pay_method, active'),
      supabase.from('current_tutor_rates').select('tutor_id, year_band, mode, hourly_rate'),
      supabase.from('courses').select('id, delivery_mode'),
      supabase.from('shifts').select('tutor_id, status, hours, rate_snapshot, work_date, pay_run_id').neq('status', 'paid'),
      supabase.from('pay_runs').select('id, period_start, period_end, status').order('period_start'),
      // Cash settlements: shifts never flip to paid for cash staff — payment is
      // recorded per (run, tutor) here. Without it the board shows cash staff
      // as owed forever.
      supabase.from('cash_pay_status').select('pay_run_id, tutor_id, amount'),
    ])

    setInvoices(invRes.data || [])
    setShiftsSubmitted(shiftsRes.count || 0)
    setPayRuns(runsRes.data || [])
    setCashLast(cashRes.data?.[0]?.date || null)
    const ct = { inflow: 0, outflow: 0 }
    for (const r of cashTermRes.data || []) {
      if (r.direction === 'inflow') ct.inflow += Math.abs(Number(r.amount || 0))
      else ct.outflow += Math.abs(Number(r.amount || 0))
    }
    setCashTerm(ct)

    // Termly cash income — non-voided invoices for this term marked as cash,
    // itemised per student so the number is auditable at a glance.
    const studentName = Object.fromEntries((studRes.data || []).map(s => [String(s.id), s.full_name]))
    const cashInvs = (invRes.data || [])
      .filter(i => cur && i.term_id === cur.id && i.payment_method === 'cash')
      .map(i => ({
        id: i.id,
        total: Number(i.total || 0),
        label: studentName[String(i.student_id)] || i.invoice_number || `#${i.id}`,
        paid: i.payment_status === 'paid',
      }))
      .sort((a, b) => b.total - a.total)
    setCashIncome(cashInvs.reduce((s, i) => s + i.total, 0))
    setCashInvoices(cashInvs)
    // Termly cash expenses — projected full-term pay for cash-paid teachers.
    const courseModes = Object.fromEntries((coursesRes.data || []).map(c => [c.id, c.delivery_mode]))
    // Teachers = tutors + directors (both can be paid in cash).
    setCashTeacherPay(projectedTeacherPay(classesRes.data || [], {
      tutors: [...(tutorsRes.data || []), ...(dirRes.data || [])],
      rateMatrix: ratesRes.data || [], courseModes,
    }, { payMethod: 'cash' }))

    // ── Unpaid teacher pay, per staff member per pay run ──────────────────
    // A shift is worth hours x rate_snapshot; a null rate means the shift can't
    // be costed yet, so it is counted separately rather than silently as $0.
    // The pay run a shift belongs to: its own pay_run_id wins (every linked
    // shift was checked to sit inside its run's dates); unlinked shifts fall
    // back to the period containing the work date, earliest-starting run first
    // where periods overlap, so the answer is at least deterministic.
    const staffName = Object.fromEntries(
      [...(tutorsRes.data || []), ...(dirRes.data || [])].map(t => [t.id, t.full_name]))
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const allRuns = (allRunsRes.data || []).filter(r => r.period_start && r.period_end)
    const runById = Object.fromEntries(allRuns.map(r => [r.id, r]))
    const asDay = (iso) => new Date(iso + 'T00:00:00')
    const runForDate = (iso) => {
      const d = asDay(iso)
      const hits = allRuns.filter(r => asDay(r.period_start) <= d && d <= asDay(r.period_end))
      if (!hits.length) return null
      return hits.slice().sort((a, b) => a.period_start.localeCompare(b.period_start))[0]
    }
    const byTutor = new Map()
    for (const sh of unpaidRes.data || []) {
      if (!sh.tutor_id) continue
      const r = byTutor.get(sh.tutor_id) || {
        id: sh.tutor_id, name: staffName[sh.tutor_id] || 'Unknown',
        owed: 0, draft: 0, hours: 0, shifts: 0, noRate: 0, oldest: null,
        runs: new Map(),
      }
      const amount = Number(sh.hours || 0) * (Number(sh.rate_snapshot) || 0)
      if (sh.rate_snapshot == null) r.noRate += 1
      r.shifts += 1
      r.hours += Number(sh.hours || 0)
      const workDate = sh.work_date ? new Date(sh.work_date + 'T00:00:00') : null
      if (sh.status === 'approved') r.owed += amount
      else r.draft += amount
      if (workDate && (!r.oldest || workDate < r.oldest)) r.oldest = workDate
      // Which pay run this money belongs to (the kanban card).
      const run = (sh.pay_run_id && runById[sh.pay_run_id]) || (sh.work_date ? runForDate(sh.work_date) : null)
      const runKey = run ? run.id : 'unscheduled'
      const rr = r.runs.get(runKey) || {
        key: runKey,
        start: run?.period_start || null,
        end: run?.period_end || null,
        label: run ? labelPeriod(run.period_start, run.period_end, allTerms) : 'Outside any pay run',
        owed: 0, draft: 0, shifts: 0, noRate: 0,
      }
      rr.shifts += 1
      if (sh.rate_snapshot == null) rr.noRate += 1
      if (sh.status === 'approved') rr.owed += amount
      else rr.draft += amount
      r.runs.set(runKey, rr)
      byTutor.set(sh.tutor_id, r)
    }

    // Retainers accrue per fortnight whether or not shifts were logged in it:
    // every started run since RETAINERS_FROM gets a card for each retainer
    // director, so a quiet fortnight's $300 can't hide.
    const todayISOForRuns = now.toISOString().slice(0, 10)
    // One retainer per FORTNIGHT, not per run row: pay_runs carries stray
    // overlapping runs from before the fortnight grid was term-aligned (empty,
    // status open). Walking chronologically and skipping any run that overlaps
    // the last accrued one charges each fortnight exactly once.
    const retainerRuns = []
    for (const run of [...allRuns].sort((a, b) => a.period_start.localeCompare(b.period_start))) {
      if (run.period_start < RETAINERS_FROM || run.period_start > todayISOForRuns) continue
      const last = retainerRuns[retainerRuns.length - 1]
      if (last && run.period_start <= last.period_end) continue
      retainerRuns.push(run)
    }
    const retainerRunIds = new Set(retainerRuns.map(r => r.id))
    const retainerStaff = [...(tutorsRes.data || []), ...(dirRes.data || [])]
      .filter(p => fortnightlyRetainerFor(p.full_name) > 0)
    for (const p of retainerStaff) {
      const r = byTutor.get(p.id) || {
        id: p.id, name: p.full_name,
        owed: 0, draft: 0, hours: 0, shifts: 0, noRate: 0, oldest: null,
        runs: new Map(),
      }
      for (const run of retainerRuns) {
        if (!r.runs.has(run.id)) r.runs.set(run.id, {
          key: run.id, start: run.period_start, end: run.period_end,
          label: labelPeriod(run.period_start, run.period_end, allTerms),
          owed: 0, draft: 0, shifts: 0, noRate: 0,
        })
      }
      byTutor.set(p.id, r)
    }

    // Cash settlements recorded per (run, tutor) — money the payroll page has
    // already marked as handed over. Subtracted from that run's owed amount;
    // anything approved beyond the recorded payment stays visible.
    const cashPaidByRunTutor = new Map(
      (cashPaidRes.data || []).map(c => [`${c.pay_run_id}:${c.tutor_id}`, Number(c.amount) || 0]))
    const unpaidRows = [...byTutor.values()]
      .map(r => {
        const runs = [...r.runs.values()]
          .map(p => {
            // Director retainers ($300/fortnight cash) ride the pay run: owed
            // alongside that run's shifts once the fortnight has started, and
            // settled by the same Mark-paid that records the shift cash.
            const retainer = retainerRunIds.has(p.key) ? fortnightlyRetainerFor(r.name) : 0
            const cashPaid = cashPaidByRunTutor.get(`${p.key}:${r.id}`) || 0
            const owed = Math.max(0, p.owed + retainer - cashPaid)
            return { ...p, retainer, owed, total: owed + p.draft }
          })
          .filter(p => p.total > 0 || p.noRate > 0)
          // Oldest run first — the money that has been waiting longest is the story.
          .sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'))
        const owed  = runs.reduce((s2, p) => s2 + p.owed, 0)
        const draft = runs.reduce((s2, p) => s2 + p.draft, 0)
        return {
          ...r, runs, owed, draft, total: owed + draft,
          ageDays: r.oldest ? Math.floor((now - r.oldest) / 86400000) : null,
        }
      })
      .filter(r => r.total > 0 || r.noRate > 0)
      .sort((a, b) => b.owed - a.owed || b.total - a.total)
    // Staff with nothing outstanding — named so "we owe them nothing" is a
    // statement, not an absence. Inactive tutors are only worth naming if they
    // ARE owed (then they appear as a column anyway).
    const owingIds = new Set(unpaidRows.map(r => r.id))
    const allSquare = [
      ...(tutorsRes.data || []).filter(t => t.active !== false),
      ...(dirRes.data || []),
    ].filter(t => !owingIds.has(t.id)).map(t => t.full_name).sort()
    setUnpaidPay({
      rows: unpaidRows,
      allSquare,
      owed:  unpaidRows.reduce((s2, r) => s2 + r.owed, 0),
      draft: unpaidRows.reduce((s2, r) => s2 + r.draft, 0),
    })

    setNoPrice((enrolRes.data || []).length)
    const emailed = new Set((guardRes.data || []).filter(g => g.email).map(g => String(g.student_id)))
    setNoEmailFamilies((studRes.data || []).filter(s => !emailed.has(s.id)).length)
    try { setComplianceDone(JSON.parse(doneRes.data?.value || '{}')) } catch { setComplianceDone({}) }
    setCheckedAt(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)
      load()
    })
  }, [router, load])

  // ── Compliance done-marking ──────────────────────────────────────────────────
  const markComplianceDone = async (label) => {
    const next = { ...complianceDone, [label]: todayIso() }
    setComplianceDone(next)
    await supabase.from('portal_settings').upsert({ key: COMPLIANCE_DONE_KEY, value: JSON.stringify(next), updated_at: new Date().toISOString() })
  }


  // ── The brain: classify everything ───────────────────────────────────────────
  const board = useMemo(() => {
    const nowMs = checkedAt ? checkedAt.getTime() : 0
    const today = checkedAt ? checkedAt.toISOString().slice(0, 10) : '9999-12-31'
    const actNow = [], overdue = [], upcoming = [], missing = [], review = []

    // — Invoices —
    const live = invoices
    const od = live.filter(i => i.delivery_status === 'sent' && i.due_date && i.due_date < today && i.payment_status !== 'paid')
    for (const i of od.sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6)) {
      const days = -daysUntil(i.due_date)
      overdue.push({ key: 'inv-od', severity: 'red', title: `${i.invoice_number || 'Invoice'} unpaid — ${days}d overdue`, detail: `Due ${fmtD(i.due_date)} · follow up with the family`, amount: i.total, href: '/tutor/accounting/invoices' })
    }
    if (od.length > 6) overdue.push({ key: 'inv-od-more', severity: 'red', title: `…and ${od.length - 6} more overdue invoices`, href: '/tutor/accounting/invoices' })

    const approvedUnsent = live.filter(i => i.status === 'approved' && i.delivery_status === 'unsent')
    if (approvedUnsent.length) actNow.push({ key: 'inv-unsent', severity: 'red', title: `${approvedUnsent.length} approved invoice${approvedUnsent.length === 1 ? '' : 's'} not yet sent`, detail: 'Families can’t pay what they haven’t received.', amount: approvedUnsent.reduce((s, i) => s + Number(i.total || 0), 0), href: '/tutor/accounting/invoices' })

    const drafts = live.filter(i => i.status === 'draft' && i.term_id === term?.id)
    if (drafts.length) actNow.push({ key: 'inv-drafts', severity: 'amber', title: `${drafts.length} draft invoices awaiting approval`, detail: 'Approve and send so payment terms start ticking.', amount: drafts.reduce((s, i) => s + Number(i.total || 0), 0), href: '/tutor/accounting/invoices' })

    const staleSent = live.filter(i => i.delivery_status === 'sent' && i.payment_status !== 'paid' && (!i.due_date || i.due_date >= today) && i.created_at && (nowMs - new Date(i.created_at).getTime()) > 14 * 86400000)
    if (staleSent.length) review.push({ key: 'inv-stale', severity: 'amber', title: `${staleSent.length} sent invoice${staleSent.length === 1 ? '' : 's'} with no payment recorded after 14+ days`, detail: 'Reconcile against the bank — mark paid or chase.', href: '/tutor/accounting/invoices' })

    const xeroDrift = live.filter(i => i.xero_invoice_id && i.payment_status === 'paid' && i.xero_status && !['PAID'].includes(String(i.xero_status).toUpperCase()))
    if (xeroDrift.length) review.push({ key: 'xero-drift', severity: 'amber', title: `${xeroDrift.length} invoice${xeroDrift.length === 1 ? '' : 's'} paid locally but not in Xero`, detail: 'Sync or apply payments in Xero so the books match.', href: '/tutor/accounting/invoices' })

    const noNumber = live.filter(i => !i.invoice_number)
    if (noNumber.length) missing.push({ key: 'inv-nonum', severity: 'amber', title: `${noNumber.length} invoice${noNumber.length === 1 ? '' : 's'} without an invoice number`, detail: 'Numberless invoices break the audit trail — fix or void.', href: '/tutor/database' })
    const noDue = live.filter(i => i.status !== 'draft' && !i.due_date)
    if (noDue.length) missing.push({ key: 'inv-nodue', severity: 'amber', title: `${noDue.length} active invoice${noDue.length === 1 ? '' : 's'} missing a due date`, detail: 'No due date = can never become overdue = never chased.', href: '/tutor/accounting/invoices' })

    // — Payroll —
    if (shiftsSubmitted > 0) actNow.push({ key: 'shifts', severity: 'amber', title: `${shiftsSubmitted} shift${shiftsSubmitted === 1 ? '' : 's'} awaiting approval`, detail: 'Approve before the pay run closes.', href: '/tutor/payroll' })
    for (const run of payRuns) {
      if (run.period_end < today && !['paid'].includes(run.status)) {
        const sev = run.status === 'open' ? 'red' : 'amber'
        ;(sev === 'red' ? actNow : review).push({ key: 'payrun', severity: sev, title: `Pay run ${fmtD(run.period_start)}–${fmtD(run.period_end)} is "${run.status}"`, detail: run.status === 'open' ? 'Period has ended — approve and export so tutors are paid on time.' : 'Exported/approved but not marked paid — confirm the transfer went out.', amount: run.total_amount, href: '/tutor/payroll' })
        break // only the most recent problematic run
      }
    }

    // — Compliance calendar (BAS / Super / Tax / ASIC) —
    for (const d of DUE_DATES) {
      if (complianceDone[d.label]) continue
      const days = daysUntil(d.due)
      const item = {
        key: 'comp', dueIso: d.due,
        title: `${d.icon} ${d.label}`,
        detail: `${d.description} · due ${fmtD(d.due)}${d.note ? ` · ${d.note}` : ''}`,
        href: d.ato,   // opens the relevant ATO/ASIC page
        markDone: () => markComplianceDone(d.label),
      }
      if (days < 0)        overdue.push({ ...item, severity: 'red', title: `${item.title} — ${-days}d overdue` })
      else if (days <= 7)  actNow.push({ ...item, severity: 'red', title: `${item.title} — due in ${days}d` })
      else if (days <= 35) upcoming.push({ ...item, severity: 'amber' })
    }

    // — Bookkeeping —
    if (!cashLast || (nowMs - new Date(cashLast + 'T00:00:00').getTime()) > 14 * 86400000) {
      missing.push({ key: 'cash-stale', severity: 'amber', title: cashLast ? `Cash log last updated ${fmtD(cashLast)}` : 'Cash log has no entries', detail: 'Bookkeeping gap — pull wages and log income/expenses so BAS prep isn’t a scramble.', href: '/tutor/accounting/forecast' })
    }
    if (noPrice > 0) missing.push({ key: 'no-price', severity: 'red', title: `${noPrice} active enrolment${noPrice === 1 ? '' : 's'} with no price`, detail: 'These students can’t be invoiced — set prices in the database explorer.', href: '/tutor/database' })
    if (noEmailFamilies > 0) missing.push({ key: 'no-email', severity: 'amber', title: `${noEmailFamilies} active student${noEmailFamilies === 1 ? '' : 's'} with no guardian email`, detail: 'Invoices to these families can’t be delivered.', href: '/tutor/database' })

    const outstanding = live.filter(i => i.delivery_status === 'sent' && i.payment_status !== 'paid').reduce((s, i) => s + Number(i.total || 0), 0)
    const paidInvs = live.filter(i => i.term_id === term?.id && i.payment_status === 'paid')
    const paidTotal = paidInvs.reduce((s, i) => s + Number(i.total || 0), 0)

    return { actNow, overdue, upcoming, missing, review, outstanding, paidTotal, paidCount: paidInvs.length, overdueTotal: od.reduce((s, i) => s + Number(i.total || 0), 0), overdueCount: od.length }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, shiftsSubmitted, payRuns, cashLast, cashTerm, noPrice, noEmailFamilies, complianceDone, term, checkedAt])

  if (!profile) return <div className="min-h-screen bg-[#F0F4FF]" />

  const nextDeadline = DUE_DATES.filter(d => !complianceDone[d.label] && daysUntil(d.due) >= 0).sort((a, b) => a.due.localeCompare(b.due))[0]

  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <TutorNav staffName={profile.full_name} isAdmin />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-5">

        {/* Header + money strip */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">🧮 Accounting Dashboard</h1>
            <p className="text-sm text-[#325099]/60 mt-0.5">
              Daily command centre · {term ? formatTermLabel(term) : ''}
              {checkedAt && <span className="text-[#2A2035]/35"> · checked {checkedAt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</span>}
            </p>
          </div>
          <button onClick={load} disabled={loading} className="text-xs font-semibold text-white bg-[#062E63] px-3.5 py-1.5 rounded-lg hover:bg-[#325099] transition disabled:opacity-50">
            {loading ? 'Checking…' : '↻ Refresh'}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Receivables outstanding', fmtMoney(board.outstanding), 'sent, not yet paid', '#062E63'],
            ['Overdue', `${fmtMoney(board.overdueTotal)}`, `${board.overdueCount} invoice${board.overdueCount === 1 ? '' : 's'} past due`, board.overdueCount ? '#B23A3A' : '#047857'],
            ['Amount paid', fmtMoney(board.paidTotal), `${board.paidCount} invoice${board.paidCount === 1 ? '' : 's'} paid this term`, '#047857'],
            ['Next deadline', nextDeadline ? `${daysUntil(nextDeadline.due)}d` : '—', nextDeadline ? `${nextDeadline.label} · ${fmtD(nextDeadline.due)}` : 'all clear', '#062E63'],
          ].map(([l, v, sub, color]) => (
            <div key={l} className="bg-white border border-[#DEE7FF] rounded-2xl px-4 py-3.5">
              <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">{l}</p>
              <p className="text-xl font-bold mt-0.5" style={{ color }}>{v}</p>
              <p className="text-[10px] text-[#2A2035]/45">{sub}</p>
            </div>
          ))}
        </div>

        {/* Overdue pay — a kanban column per staff member: what we owe them,
            and which pay run each amount comes from */}
        {unpaidPay.rows.length > 0 && (
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-[#062E63]">🧾 Overdue pay</p>
            <Link href="/tutor/payroll" className="text-[11px] font-semibold text-[#325099] hover:underline">Open payroll →</Link>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-1">
            {unpaidPay.rows.map(r => (
              <div key={r.id} className="w-60 shrink-0 rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] flex flex-col">
                {/* Column header: who, and how much we owe them */}
                <div className="px-3.5 pt-3 pb-2.5 border-b border-[#E4EAFB]">
                  <p className="text-xs font-bold text-[#2A2035] truncate">
                    {r.name}
                    {r.noRate > 0 && (
                      <span className="ml-1.5 text-[9px] font-bold text-amber-700" title={`${r.noRate} shift${r.noRate === 1 ? '' : 's'} have no rate set, so they are not costed here`}>
                        ⚠ {r.noRate} unrated
                      </span>
                    )}
                  </p>
                  <p className="text-xl font-bold tabular-nums mt-0.5" style={{ color: r.owed > 0 ? '#B23A3A' : '#2A203555' }}>
                    {fmtMoney(r.owed)}
                  </p>
                  {r.draft > 0 && (
                    <p className="text-[10px] text-[#92400E]">{fmtMoney(r.draft)} not approved</p>
                  )}
                </div>
                {/* One card per pay run the money comes from, oldest first */}
                <div className="p-2 space-y-2">
                  {r.runs.map(p => (
                    <div key={p.key} className="rounded-lg border border-[#E4EAFB] bg-white px-3 py-2">
                      {/* No run-status chip here: a run can be "paid" (its bank
                          side settled in Xero) while this person's cash from it
                          is still owed — which is exactly why they're on the
                          board. The run identifies WHERE the debt is from. */}
                      <p className="text-[11px] font-bold text-[#062E63] truncate" title={p.start ? `${p.start} → ${p.end}` : 'no pay run covers these dates'}>
                        {p.label}
                      </p>
                      <p className="mt-1 text-sm font-bold tabular-nums" style={{ color: p.owed > 0 ? '#B23A3A' : '#2A203555' }}>
                        {fmtMoney(p.owed)}
                      </p>
                      <p className="text-[10px] text-[#2A2035]/45">
                        {p.shifts} shift{p.shifts === 1 ? '' : 's'}
                        {p.retainer > 0 && <> · incl. {fmtMoney(p.retainer)} retainer</>}
                        {p.draft > 0 && <> · <span className="text-[#92400E]">{fmtMoney(p.draft)} not approved</span></>}
                        {p.noRate > 0 && <span className="text-amber-700"> · ⚠ {p.noRate} unrated</span>}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {unpaidPay.allSquare.length > 0 && (
            <p className="mt-3 text-[11px] text-[#2A2035]/45">
              <span className="font-bold text-[#047857]">Nothing owing:</span> {unpaidPay.allSquare.join(' · ')}
            </p>
          )}
        </div>
        )}

        {/* Termly cash snapshot — cash income vs projected cash teacher pay */}
        {(() => {
          // Director retainers: $300 cash each per fortnight, projected across the term.
          const fortnights = term
            ? Math.max(1, Math.round(((new Date(term.end_date + 'T00:00:00') - new Date(term.start_date + 'T00:00:00')) / 86400000 + 1) / 14))
            : 0
          const retainers = CASH_RETAINERS.map(r => ({ ...r, total: r.perFortnight * fortnights }))
          const retainerTotal = retainers.reduce((s, r) => s + r.total, 0)
          const cashExpenses = cashTeacherPay.total + retainerTotal
          return (
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-[#062E63]">💵 Term cash snapshot{term ? ` · ${formatTermLabel(term)}` : ''}</p>
            <Link href="/tutor/accounting/forecast" className="text-[11px] font-semibold text-[#325099] hover:underline">Full forecast →</Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Cash income', fmtMoney(cashIncome), 'cash-marked invoices this term', '#047857'],
              ['Cash expenses', fmtMoney(cashExpenses), 'teacher pay + retainers (cash, full term)', '#B23A3A'],
              ['Net cash', `${cashIncome - cashExpenses < 0 ? '−' : ''}${fmtMoney(cashIncome - cashExpenses)}`, 'income − teacher pay − retainers', cashIncome - cashExpenses >= 0 ? '#047857' : '#B23A3A'],
            ].map(([l, v, sub, color]) => (
              <div key={l} className="rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] px-4 py-3">
                <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">{l}</p>
                <p className="text-xl font-bold mt-0.5" style={{ color }}>{v}</p>
                <p className="text-[10px] text-[#2A2035]/45">{sub}</p>
              </div>
            ))}
          </div>
          {cashInvoices.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#2A2035]/55">
              <span className="font-bold text-[#047857]">Cash income:</span>
              {cashInvoices.map(i => (
                <span key={i.id} title={i.paid ? 'Paid' : 'Not yet paid'}>
                  {i.label}: <strong className="text-[#062E63]">{fmtMoney(i.total)}</strong>{!i.paid && <span className="text-amber-600"> ⏳</span>}
                </span>
              ))}
            </div>
          )}
          {(cashTeacherPay.perTutor.length > 0 || cashTeacherPay.missingRate.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#2A2035]/55">
              <span className="font-bold text-[#B23A3A]">Teacher pay:</span>
              {cashTeacherPay.perTutor.map(t => (
                <span key={t.id}>{(t.name || '').split(' ')[0]}: <strong className="text-[#062E63]">{fmtMoney(t.amount)}</strong></span>
              ))}
              {cashTeacherPay.missingRate.length > 0 && (
                <span className="text-amber-700">⚠ {cashTeacherPay.missingRate.length} cash class{cashTeacherPay.missingRate.length === 1 ? '' : 'es'} missing a rate (excluded)</span>
              )}
            </div>
          )}
          {retainerTotal > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#2A2035]/55">
              <span className="font-bold text-[#B23A3A]">Retainers:</span>
              {retainers.map(r => (
                <span key={r.name} title={`${fmtMoney(r.perFortnight)}/fortnight × ${fortnights} fortnight${fortnights === 1 ? '' : 's'}`}>
                  {r.name}: <strong className="text-[#062E63]">{fmtMoney(r.total)}</strong>
                </span>
              ))}
              <span className="text-[#2A2035]/40">({fmtMoney(CASH_RETAINERS[0].perFortnight)} cash each per fortnight × {fortnights})</span>
            </div>
          )}
          <p className="text-[10px] text-[#2A2035]/40 mt-2">
            Income = invoices marked “cash” for this term. Expenses = projected full-term pay (lesson hours × rate × {LESSONS_PER_TERM} lessons) for tutors paid in cash, plus director retainers; super excluded.
          </p>
        </div>
          )
        })()}


        {/* Compliance calendar — full list (replaces the old Due Dates page) */}
        <Panel icon="📆" title="Compliance calendar" badge={`${DUE_DATES.filter(d => !complianceDone[d.label] && daysUntil(d.due) >= 0).length} upcoming`} badgeCls={SEV.blue.chip}>
          <div className="divide-y divide-[#F0F4FF] max-h-80 overflow-y-auto">
            {DUE_DATES.map(d => ({ ...d, days: daysUntil(d.due), done: !!complianceDone[d.label] }))
              .filter(d => !d.done)   // done items disappear from the calendar entirely
              .sort((a, b) => a.due.localeCompare(b.due))
              .map(d => (
                <div key={d.label} className={`flex items-center gap-3 px-4 py-2.5 ${d.done ? 'opacity-45' : ''}`}>
                  <span className="text-base shrink-0">{d.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-xs font-semibold text-[#2A2035] ${d.done ? 'line-through' : ''}`}>{d.label}</span>
                    <span className="block text-[10px] text-[#2A2035]/45 truncate">{d.description}{d.note ? ` · ${d.note}` : ''}</span>
                  </span>
                  <a href={d.ato} target="_blank" rel="noreferrer" className="text-[9px] font-semibold text-[#325099] hover:underline shrink-0">ATO ↗</a>
                  <span className="text-[11px] text-[#2A2035]/60 tabular-nums w-16 text-right shrink-0">{fmtD(d.due)}</span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full w-20 text-center shrink-0 ${
                    d.done ? 'bg-emerald-100 text-emerald-700'
                    : d.days < 0 ? 'bg-rose-100 text-rose-700'
                    : d.days <= 14 ? 'bg-rose-100 text-rose-700'
                    : d.days <= 35 ? 'bg-amber-100 text-amber-700'
                    : 'bg-[#F0F4FF] text-[#325099]/70'
                  }`}>
                    {d.done ? '✓ done' : d.days < 0 ? `${-d.days}d overdue` : d.days === 0 ? 'today' : `${d.days}d`}
                  </span>
                  {!d.done ? (
                    <button onClick={() => markComplianceDone(d.label)} className="text-[9px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 px-2 py-0.5 rounded-full hover:bg-emerald-100 transition shrink-0">✓ Done</button>
                  ) : <span className="w-12 shrink-0" />}
                </div>
              ))}
          </div>
        </Panel>

      </div>
    </div>
  )
}

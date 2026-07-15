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

/*
 * Accounting Dashboard — /tutor/accounting
 * ─────────────────────────────────────────────────────────────────────────────
 * Daily command centre for directors: everything across invoicing, payroll,
 * tax/compliance, bookkeeping and reconciliation that needs action, is overdue,
 * is coming up, is missing, or needs review — plus an assignable task list
 * (ops_tasks) so nothing relies on memory.
 *
 * Compliance items can be marked done per period (portal_settings
 * 'compliance_done'), and any alert can be turned into an assigned task.
 */

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
  const [tasks, setTasks] = useState([])
  const [directors, setDirectors] = useState([])

  // task form
  const [taskDraft, setTaskDraft] = useState({ title: '', assignee: '', due_date: '' })
  const [taskSaving, setTaskSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const allTerms = await fetchAllTerms()
    setTerms(allTerms)
    const cur = getEnrolmentTerm(allTerms)
    setTerm(cur)

    const [invRes, shiftsRes, runsRes, cashRes, cashTermRes, enrolRes, studRes, guardRes, doneRes, tasksRes, dirRes, classesRes, tutorsRes, ratesRes, coursesRes] = await Promise.all([
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
      supabase.from('ops_tasks').select('*').order('status').order('due_date', { ascending: true, nullsFirst: false }).order('created_at'),
      supabase.from('directors').select('id, full_name, pay_method'),
      cur ? supabase.from('classes').select('id, class_name, teacher, start_time, end_time, course_id, term_id').eq('term_id', cur.id) : { data: [] },
      supabase.from('tutors').select('id, full_name, pay_method'),
      supabase.from('current_tutor_rates').select('tutor_id, year_band, mode, hourly_rate'),
      supabase.from('courses').select('id, delivery_mode'),
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

    setNoPrice((enrolRes.data || []).length)
    const emailed = new Set((guardRes.data || []).filter(g => g.email).map(g => String(g.student_id)))
    setNoEmailFamilies((studRes.data || []).filter(s => !emailed.has(s.id)).length)
    try { setComplianceDone(JSON.parse(doneRes.data?.value || '{}')) } catch { setComplianceDone({}) }
    setTasks(tasksRes.data || [])
    setDirectors((dirRes.data || []).map(d => (d.full_name || '').split(' ')[0]).filter(Boolean))
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

  // ── Task CRUD ────────────────────────────────────────────────────────────────
  const addTask = async (draft) => {
    if (!draft.title?.trim()) return
    setTaskSaving(true)
    const { data } = await supabase.from('ops_tasks').insert({
      title: draft.title.trim(),
      assignee: draft.assignee || null,
      due_date: draft.due_date || null,
      source: draft.source || 'manual',
      created_by: profile?.full_name || null,
    }).select('*').single()
    if (data) setTasks(prev => [data, ...prev])
    setTaskDraft({ title: '', assignee: '', due_date: '' })
    setTaskSaving(false)
  }
  const toggleTask = async (t) => {
    const done = t.status !== 'done'
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null } : x))
    await supabase.from('ops_tasks').update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null }).eq('id', t.id)
  }
  const deleteTask = async (t) => {
    setTasks(prev => prev.filter(x => x.id !== t.id))
    await supabase.from('ops_tasks').delete().eq('id', t.id)
  }
  const taskFromAlert = (item) => addTask({ title: item.title, assignee: '', due_date: item.dueIso || '', source: 'auto:' + (item.key || 'alert') })

  // ── The brain: classify everything ───────────────────────────────────────────
  const board = useMemo(() => {
    const nowMs = checkedAt ? checkedAt.getTime() : 0
    const today = checkedAt ? checkedAt.toISOString().slice(0, 10) : '9999-12-31'
    const actNow = [], overdue = [], upcoming = [], missing = [], review = [], recs = []

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

    // — Recommendations —
    const outstanding = live.filter(i => i.delivery_status === 'sent' && i.payment_status !== 'paid').reduce((s, i) => s + Number(i.total || 0), 0)
    if (outstanding > 0) recs.push({ key: 'rec-receivables', severity: od.length ? 'amber' : 'blue', title: `${fmtMoney(outstanding)} in receivables outstanding`, detail: `${od.length} overdue. A fixed weekly 10-minute chase (same day each week) keeps this near zero.`, href: '/tutor/accounting/invoices' })
    const net = cashTerm.inflow - cashTerm.outflow
    if (cashTerm.inflow || cashTerm.outflow) recs.push({ key: 'rec-cash', severity: net < 0 ? 'amber' : 'blue', title: `Term cash position: ${net < 0 ? '−' : '+'}${fmtMoney(net)}`, detail: `${fmtMoney(cashTerm.inflow)} in · ${fmtMoney(cashTerm.outflow)} out (cash log). See Forecast → Overview for the full analyst view.`, href: '/tutor/accounting/forecast' })
    recs.push({ key: 'rec-routine', severity: 'blue', title: 'Suggested weekly routine', detail: 'Mon: approve drafts + send. Wed: chase overdue. Fri: approve shifts + log cash. Term week 2: discount email. Quarter end: BAS + super together.' })

    return { actNow, overdue, upcoming, missing, review, recs, outstanding, overdueTotal: od.reduce((s, i) => s + Number(i.total || 0), 0), overdueCount: od.length }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, shiftsSubmitted, payRuns, cashLast, cashTerm, noPrice, noEmailFamilies, complianceDone, term, checkedAt])

  if (!profile) return <div className="min-h-screen bg-[#F0F4FF]" />

  const openTasks = tasks.filter(t => t.status === 'open')
  const doneTasks = tasks.filter(t => t.status === 'done').slice(0, 5)
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
            ['Needs action now', String(board.actNow.length + board.overdue.length), 'items in red panels', board.actNow.length + board.overdue.length ? '#B23A3A' : '#047857'],
            ['Next deadline', nextDeadline ? `${daysUntil(nextDeadline.due)}d` : '—', nextDeadline ? `${nextDeadline.label} · ${fmtD(nextDeadline.due)}` : 'all clear', '#062E63'],
          ].map(([l, v, sub, color]) => (
            <div key={l} className="bg-white border border-[#DEE7FF] rounded-2xl px-4 py-3.5">
              <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">{l}</p>
              <p className="text-xl font-bold mt-0.5" style={{ color }}>{v}</p>
              <p className="text-[10px] text-[#2A2035]/45">{sub}</p>
            </div>
          ))}
        </div>

        {/* Termly cash snapshot — cash income vs projected cash teacher pay */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-[#062E63]">💵 Term cash snapshot{term ? ` · ${formatTermLabel(term)}` : ''}</p>
            <Link href="/tutor/accounting/forecast" className="text-[11px] font-semibold text-[#325099] hover:underline">Full forecast →</Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Cash income', fmtMoney(cashIncome), 'cash-marked invoices this term', '#047857'],
              ['Cash expenses', fmtMoney(cashTeacherPay.total), 'est. teacher pay (cash, full term)', '#B23A3A'],
              ['Net cash', `${cashIncome - cashTeacherPay.total < 0 ? '−' : ''}${fmtMoney(cashIncome - cashTeacherPay.total)}`, 'income − teacher pay', cashIncome - cashTeacherPay.total >= 0 ? '#047857' : '#B23A3A'],
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
          <p className="text-[10px] text-[#2A2035]/40 mt-2">
            Income = invoices marked “cash” for this term. Expenses = projected full-term pay (lesson hours × rate × {LESSONS_PER_TERM} lessons) for tutors paid in cash; super excluded.
          </p>
        </div>


        {/* Row 2: missing / review */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <Panel icon="🧩" title="Missing or incomplete" badge={board.missing.length || '✓'} badgeCls={board.missing.length ? SEV.amber.chip : 'bg-emerald-100 text-emerald-700 border-emerald-200'}>
            {board.missing.length === 0 ? <Empty msg="Records are complete — invoicing can run cleanly." /> :
              <div className="divide-y divide-[#F0F4FF]">{board.missing.map((it, i) => <AlertRow key={i} item={it} onTask={taskFromAlert} />)}</div>}
          </Panel>
          <Panel icon="🔍" title="Needs review" badge={board.review.length || '✓'} badgeCls={board.review.length ? SEV.amber.chip : 'bg-emerald-100 text-emerald-700 border-emerald-200'}>
            {board.review.length === 0 ? <Empty msg="Nothing waiting on a judgement call." /> :
              <div className="divide-y divide-[#F0F4FF]">{board.review.map((it, i) => <AlertRow key={i} item={it} onTask={taskFromAlert} />)}</div>}
          </Panel>
        </div>

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

        {/* Row 3: recommendations / director tasks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <Panel icon="💡" title="Recommendations">
            <div className="divide-y divide-[#F0F4FF]">{board.recs.map((it, i) => <AlertRow key={i} item={it} />)}</div>
          </Panel>

          <Panel icon="✅" title="Director tasks" badge={openTasks.length ? `${openTasks.length} open` : '✓'} badgeCls={openTasks.length ? SEV.blue.chip : 'bg-emerald-100 text-emerald-700 border-emerald-200'}
            footer={
              <div className="border-t border-[#F0F4FF] px-4 py-3 flex flex-wrap items-center gap-2">
                <input value={taskDraft.title} onChange={e => setTaskDraft(d => ({ ...d, title: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addTask(taskDraft) }}
                  placeholder="Add a task… (Enter to save)"
                  className="flex-1 min-w-[160px] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
                <select value={taskDraft.assignee} onChange={e => setTaskDraft(d => ({ ...d, assignee: e.target.value }))}
                  className="border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                  <option value="">Anyone</option>
                  {directors.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <input type="date" value={taskDraft.due_date} onChange={e => setTaskDraft(d => ({ ...d, due_date: e.target.value }))}
                  className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs bg-white focus:outline-none" />
                <button onClick={() => addTask(taskDraft)} disabled={taskSaving || !taskDraft.title.trim()}
                  className="text-xs font-semibold text-white bg-[#325099] px-3 py-1.5 rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">Add</button>
              </div>
            }>
            {openTasks.length === 0 && doneTasks.length === 0 ? <Empty msg="No tasks yet — add one below, or use “+ Task” on any alert." /> : (
              <div className="divide-y divide-[#F0F4FF]">
                {openTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2.5 px-4 py-2.5 group">
                    <button onClick={() => toggleTask(t)} className="w-4 h-4 rounded border-2 border-[#BACBFF] hover:border-[#325099] transition shrink-0" title="Mark done" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold text-[#2A2035] truncate">{t.title}</span>
                      <span className="block text-[10px] text-[#2A2035]/45">
                        {t.assignee ? `→ ${t.assignee}` : 'unassigned'}{t.due_date ? ` · due ${fmtD(t.due_date)}` : ''}
                        {t.due_date && t.due_date < todayIso() && <span className="text-rose-600 font-bold"> · overdue</span>}
                      </span>
                    </span>
                    <button onClick={() => deleteTask(t)} className="text-[#2A2035]/25 hover:text-rose-500 text-xs opacity-0 group-hover:opacity-100 transition shrink-0">✕</button>
                  </div>
                ))}
                {doneTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2.5 px-4 py-2 opacity-50">
                    <button onClick={() => toggleTask(t)} className="w-4 h-4 rounded bg-emerald-500 text-white text-[9px] font-bold leading-none shrink-0" title="Reopen">✓</button>
                    <span className="text-xs text-[#2A2035]/60 line-through truncate">{t.title}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

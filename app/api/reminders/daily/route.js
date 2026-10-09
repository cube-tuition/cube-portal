import { createClient } from '@supabase/supabase-js'
import { requireCronSecret, requireApiRole } from '../../../../lib/apiAuth'
import { sendPushToAll } from '../../../../lib/push'
import { DUE_DATES } from '../../../../lib/complianceDates'
import { getRunningTerm, isHolidayTerm } from '../../../../lib/terms'
import { normaliseTerms } from '../../../../lib/termDates'

/*
 * GET /api/reminders/daily — Vercel cron, early each morning Sydney time.
 * Pushes the directors (the iPhone app) about what is due tomorrow:
 *
 *   • Bank-transfer payroll — the Monday after each term fortnight (W1–2, W3–4 …),
 *     with the total and how many tutors.
 *   • Cash payroll — each cash-paid teacher's chosen weekday in the fortnight's
 *     last week; one push naming everyone due tomorrow.
 *   • Compliance calendar (BAS, company tax, ASIC — lib/complianceDates.js):
 *     a week before and the day before, unless marked done on the dashboard.
 *   • Term start — the day before a teaching term begins.
 *
 * The payroll arithmetic mirrors lib/payrollAlerts.js (bank = fortnight start
 * + 14 days; cash = fortnight start + 7 + weekday − 1); a holiday break is one
 * pay period (bank on the Monday it ends, cash in its last week). Super has no
 * entry: under Payday Super it is paid with each pay run.
 *
 * Also: ?dry=1 (cron secret) lists what would go out, with ?today= to pretend
 * another date; ?preview=N (a signed-in director) lists the reminders of the
 * next N days for the Accounting dashboard.
 */
export const dynamic = 'force-dynamic'

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const money = (n) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

/** Everything the morning push would say on `today`. `ctx` is the data loaded once by loadContext(). */
function remindersFor(ctx, today, { ignoreDone = false } = {}) {
  const tomorrow = addDays(today, 1), inAWeek = addDays(today, 7)
  const pushes = []
  const payrollDone = ignoreDone ? [] : ctx.payrollDone
  const term = getRunningTerm(ctx.terms, new Date(today + 'T12:00:00+11:00'))
  if (term?.start_date) {
    const amountIn = (ps, pe) => {
      const m = {}
      for (const s of ctx.shifts) if (s.work_date >= ps && s.work_date <= pe) m[s.tutor_id] = (m[s.tutor_id] || 0) + Number(s.amount || 0)
      return m
    }
    const periods = isHolidayTerm(term)
      ? [{ ps: term.start_date, pe: term.end_date, wk: 'Holidays', bankMon: addDays(term.end_date, 1), cashWeekMon: addDays(term.end_date, -6) }]
      : [1, 2, 3, 4, 5].map((idx) => { const ps = addDays(term.start_date, (idx - 1) * 14); return { ps, pe: addDays(ps, 13), wk: `Wk ${idx * 2 - 1}–${idx * 2}`, bankMon: addDays(ps, 14), cashWeekMon: addDays(ps, 7) } })
    for (const { ps, pe, wk, bankMon, cashWeekMon } of periods) {
      const amount = amountIn(ps, pe)
      if (bankMon === tomorrow && !payrollDone.includes(`bank:${ps}`)) {
        const bank = ctx.staff.filter(t => (t.pay_method || '').toLowerCase().startsWith('bank') && (amount[t.id] || 0) > 0)
        const total = bank.reduce((a, t) => a + amount[t.id], 0)
        if (total > 0) pushes.push({ title: 'Bank payroll due tomorrow', body: `${wk}: ${money(total)} across ${bank.length} tutor${bank.length === 1 ? '' : 's'}. Send the transfers on ${fmtDay(bankMon)}.`, url: '/tutor/payroll', tag: `payroll-bank-${ps}` })
      }
      const dueTomorrow = ctx.staff.filter(t => (t.pay_method || '').toLowerCase() === 'cash' && t.cash_pay_weekday && addDays(cashWeekMon, t.cash_pay_weekday - 1) === tomorrow
        && (amount[t.id] || 0) > 0 && !payrollDone.includes(`cash:${t.id}:${ps}`))
      if (dueTomorrow.length) {
        pushes.push({ title: 'Cash payroll tomorrow', body: `${wk}: ${dueTomorrow.map(t => `${t.full_name.split(' ')[0]} ${money(amount[t.id])}`).join(', ')}.`, url: '/tutor/payroll', tag: `payroll-cash-${ps}-${tomorrow}` })
      }
    }
  }
  for (const t of ctx.terms) {
    if (t.start_date === tomorrow && !isHolidayTerm(t)) pushes.push({ title: `Term ${t.term_number} starts tomorrow`, body: `First day is ${fmtDay(t.start_date)}. Check the timetable and class lists today.`, url: '/tutor/admin/timetable', tag: `term-start-${t.start_date}` })
  }
  for (const d of DUE_DATES) {
    if (ctx.complianceDone[d.label]) continue
    if (d.due === tomorrow) pushes.push({ title: `${d.icon} ${d.label} due tomorrow`, body: `${d.description}. Due ${fmtDay(d.due)}.`, url: '/tutor/accounting', tag: `compliance-${d.due}-${d.label}` })
    else if (d.due === inAWeek) pushes.push({ title: `${d.icon} ${d.label} due in a week`, body: `${d.description}. Due ${fmtDay(d.due)}.`, url: '/tutor/accounting', tag: `compliance-${d.due}-${d.label}` })
  }
  return pushes
}

/** The data every reminder draws on, loaded once per request. */
async function loadContext(admin, from, to) {
  const [{ data: termRows }, { data: tutors }, { data: directors }, { data: doneRow }, { data: compRow }] = await Promise.all([
    admin.from('terms').select('*'),
    admin.from('tutors').select('id, full_name, pay_method, cash_pay_weekday, system'),
    admin.from('directors').select('id, full_name, pay_method, cash_pay_weekday'),
    admin.from('portal_settings').select('value').eq('key', 'payroll_alerts_done').maybeSingle(),
    admin.from('portal_settings').select('value').eq('key', 'compliance_done').maybeSingle(),
  ])
  // Shifts across the whole window the reminders may look at (a term either side).
  const { data: shifts } = await admin.from('pay_run_shifts').select('tutor_id, amount, work_date').gte('work_date', addDays(from, -120)).lte('work_date', addDays(to, 120))
  let payrollDone = [], complianceDone = {}
  try { payrollDone = JSON.parse(doneRow?.value || '[]') } catch { /* none marked */ }
  try { complianceDone = JSON.parse(compRow?.value || '{}') } catch { /* none marked */ }
  return {
    terms: normaliseTerms(termRows || []),
    staff: [...(directors || []), ...(tutors || []).filter(t => !t.system)],
    shifts: shifts || [], payrollDone, complianceDone,
  }
}

export async function GET(request) {
  const params = new URL(request.url).searchParams
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // A director previewing the coming weeks (the Accounting dashboard's list).
  const preview = Number(params.get('preview') || 0)
  if (preview > 0) {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    const today = sydneyToday(), days = Math.min(120, preview)
    const ctx = await loadContext(admin, today, addDays(today, days))
    const upcoming = []
    for (let i = 0; i < days; i++) {
      const day = addDays(today, i)
      for (const p of remindersFor(ctx, day)) upcoming.push({ date: day, title: p.title, body: p.body, url: p.url })
    }
    return Response.json({ today, upcoming })
  }

  // The cron (or a dry run with the same secret).
  const auth = requireCronSecret(request)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const dry = !!params.get('dry')
  const today = (dry && /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '')) ? params.get('today') : sydneyToday()
  const ctx = await loadContext(admin, today, today)
  const pushes = remindersFor(ctx, today, { ignoreDone: dry && !!params.get('ignoreDone') })
  if (dry) return Response.json({ today, reminders: pushes })
  let sent = 0
  for (const p of pushes) {
    try { const r = await sendPushToAll(p); sent += r?.sent || 0 } catch (e) { console.error('[reminders]', p.title, e?.message) }
  }
  return Response.json({ today, reminders: pushes.map(p => p.title), sent })
}

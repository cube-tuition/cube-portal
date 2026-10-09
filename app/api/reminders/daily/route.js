import { createClient } from '@supabase/supabase-js'
import { requireCronSecret } from '../../../../lib/apiAuth'
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
 * + 14 days; cash = fortnight start + 7 + weekday − 1). Super has no entry:
 * under Payday Super it is paid with each pay run.
 */
export const dynamic = 'force-dynamic'

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const money = (n) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })

export async function GET(request) {
  const auth = requireCronSecret(request)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // "Today" in Sydney, whatever the server's clock zone.
  const params = new URL(request.url).searchParams
  const dry = !!params.get('dry')   // list what would be sent, send nothing; may also pretend it is another day
  const today = (dry && /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '')) ? params.get('today')
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const tomorrow = addDays(today, 1), inAWeek = addDays(today, 7)
  const pushes = []   // { title, body, url, tag }

  // ── Payroll ────────────────────────────────────────────────────────────────
  const [{ data: termRows }, { data: tutors }, { data: directors }, { data: doneRow }] = await Promise.all([
    admin.from('terms').select('*'),
    admin.from('tutors').select('id, full_name, pay_method, cash_pay_weekday, system'),
    admin.from('directors').select('id, full_name, pay_method, cash_pay_weekday'),
    admin.from('portal_settings').select('value').eq('key', 'payroll_alerts_done').maybeSingle(),
  ])
  let payrollDone = []
  try { payrollDone = JSON.parse(doneRow?.value || '[]') } catch { /* none marked */ }
  if (dry && params.get('ignoreDone')) payrollDone = []   // testing: show reminders even for fortnights marked paid
  const term = getRunningTerm(normaliseTerms(termRows || []), new Date(today + 'T12:00:00+11:00'))
  const staff = [...(directors || []), ...(tutors || []).filter(t => !t.system)]
  if (term?.start_date) {
    const { data: shifts } = await admin.from('pay_run_shifts').select('tutor_id, amount, work_date').gte('work_date', term.start_date).lte('work_date', term.end_date)
    const amountIn = (ps, pe) => {
      const m = {}
      for (const s of shifts || []) if (s.work_date >= ps && s.work_date <= pe) m[s.tutor_id] = (m[s.tutor_id] || 0) + Number(s.amount || 0)
      return m
    }
    // Pay periods: five fortnights in a teaching term; a holiday break is paid as
    // one period (bank on the Monday it ends, cash in its last week).
    const periods = isHolidayTerm(term)
      ? [{ ps: term.start_date, pe: term.end_date, wk: 'Holidays', bankMon: addDays(term.end_date, 1), cashWeekMon: addDays(term.end_date, -6) }]
      : [1, 2, 3, 4, 5].map((idx) => { const ps = addDays(term.start_date, (idx - 1) * 14); return { ps, pe: addDays(ps, 13), wk: `Wk ${idx * 2 - 1}–${idx * 2}`, bankMon: addDays(ps, 14), cashWeekMon: addDays(ps, 7) } })
    for (const { ps, pe, wk, bankMon, cashWeekMon } of periods) {
      if (bankMon === tomorrow && !payrollDone.includes(`bank:${ps}`)) {
        const amount = amountIn(ps, pe)
        const bank = staff.filter(t => (t.pay_method || '').toLowerCase().startsWith('bank') && (amount[t.id] || 0) > 0)
        const total = bank.reduce((a, t) => a + amount[t.id], 0)
        if (total > 0) pushes.push({ title: 'Bank payroll due tomorrow', body: `${wk}: ${money(total)} across ${bank.length} tutor${bank.length === 1 ? '' : 's'}. Send the transfers on ${fmtDay(bankMon)}.`, url: '/tutor/payroll', tag: `payroll-bank-${ps}` })
      }
      // Cash: each teacher's weekday in the period's last week.
      const amount = amountIn(ps, pe)
      const dueTomorrow = staff.filter(t => (t.pay_method || '').toLowerCase() === 'cash' && t.cash_pay_weekday && addDays(cashWeekMon, t.cash_pay_weekday - 1) === tomorrow
        && (amount[t.id] || 0) > 0 && !payrollDone.includes(`cash:${t.id}:${ps}`))
      if (dueTomorrow.length) {
        pushes.push({ title: 'Cash payroll tomorrow', body: `${wk}: ${dueTomorrow.map(t => `${t.full_name.split(' ')[0]} ${money(amount[t.id])}`).join(', ')}.`, url: '/tutor/payroll', tag: `payroll-cash-${ps}-${tomorrow}` })
      }
    }
    // Term start: the day before a teaching term begins.
    for (const t of normaliseTerms(termRows || [])) {
      if (t.start_date === tomorrow && !isHolidayTerm(t)) pushes.push({ title: `Term ${t.term_number} starts tomorrow`, body: `First day is ${fmtDay(t.start_date)}. Check the timetable and class lists today.`, url: '/tutor/admin/timetable', tag: `term-start-${t.start_date}` })
    }
  }

  // ── Compliance calendar ────────────────────────────────────────────────────
  const { data: compRow } = await admin.from('portal_settings').select('value').eq('key', 'compliance_done').maybeSingle()
  let compDone = {}
  try { compDone = JSON.parse(compRow?.value || '{}') } catch { /* none */ }
  for (const d of DUE_DATES) {
    if (compDone[d.label]) continue
    if (d.due === tomorrow) pushes.push({ title: `${d.icon} ${d.label} due tomorrow`, body: `${d.description}. Due ${fmtDay(d.due)}.`, url: '/tutor/accounting', tag: `compliance-${d.due}-${d.label}` })
    else if (d.due === inAWeek) pushes.push({ title: `${d.icon} ${d.label} due in a week`, body: `${d.description}. Due ${fmtDay(d.due)}.`, url: '/tutor/accounting', tag: `compliance-${d.due}-${d.label}` })
  }

  // ?dry=1 lists what would be sent without sending (for checking the maths).
  if (dry) return Response.json({ today, tomorrow, term: term?.name || null, reminders: pushes })
  let sent = 0
  for (const p of pushes) {
    try { const r = await sendPushToAll(p); sent += r?.sent || r?.native || 0 } catch (e) { console.error('[reminders]', p.title, e?.message) }
  }
  return Response.json({ today, reminders: pushes.map(p => p.title), sent })
}

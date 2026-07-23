import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../../lib/apiAuth'
import { listPayRuns, getPayRun, createDraftPayRun, setPayslipHours, PayrollScopeError } from '../../../../../lib/xeroPayroll'

function adminSb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * POST /api/xero/payroll/push
 * Fill Xero Payroll's current DRAFT pay run with approved portal hours.
 * body: { periodStart?, periodEnd? } — the portal fortnight being viewed,
 * used only for an informational note when it differs from Xero's period.
 *
 * Xero pay calendars are CONTINUOUS (fortnights roll straight through term
 * holidays and the API can only open the calendar's next period), while the
 * portal's periods are term-aligned with a variable holiday gap. So the Xero
 * draft's own period defines the window: we sum EVERY approved shift dated
 * inside it — term or holiday — and write each matched teacher's total onto
 * their draft payslip. Idempotent (a re-push overwrites with the same totals),
 * and two portal runs sharing one Xero fortnight combine instead of clobbering.
 *
 * Never posts the pay run — a human posts in Xero, which is what files STP.
 */
export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { periodStart, periodEnd } = await req.json()

    const sb = adminSb()
    const { data: settings } = await sb.from('xero_payroll_settings').select('*').eq('id', 1).maybeSingle()
    if (!settings?.payroll_calendar_id || !settings?.earnings_rate_id) {
      return NextResponse.json({ error: 'Configure the Xero pay calendar and earnings rate first (⚙ Xero Payroll setup).' }, { status: 400 })
    }

    const { data: mapRows } = await sb.from('xero_employee_map').select('*')
    const empByStaff = Object.fromEntries((mapRows || []).map(m => [m.staff_id, m]))

    // Find an existing DRAFT pay run on this calendar, else create one. Its
    // period is Xero's to choose — it defines the shift window below.
    let payRun
    const runs = await listPayRuns()
    payRun = runs.find(r => r.calendarId === settings.payroll_calendar_id && r.status === 'DRAFT')
    if (payRun) payRun = await getPayRun(payRun.id)      // re-fetch to get payslip stubs
    else payRun = await createDraftPayRun(settings.payroll_calendar_id)
    if (!payRun.periodStart || !payRun.periodEnd) {
      throw new Error('Xero did not return the draft pay run period')
    }

    // Candidate hours: everything approved from the payroll cutover date up to
    // the END of Xero's draft window. Hours dated before the window start are
    // CATCH-UP pay (e.g. the term holidays predate the calendar's first
    // period — Xero can't open past periods, so arrears ride the current run).
    // Double-pay guard: each pushed shift is stamped with the Xero run id, and
    // a shift is dropped only once its stamped run is POSTED in Xero. Stamps
    // pointing at the current draft (re-push) or a deleted run are re-swept.
    const payrollFrom = settings.payroll_from || payRun.periodStart
    const { data: shifts, error: shiftErr } = await sb
      .from('shifts')
      .select('id, tutor_id, hours, rate_snapshot, work_date, xero_pay_run_id')
      .in('status', ['approved', 'paid'])
      .gte('work_date', payrollFrom)
      .lte('work_date', payRun.periodEnd)
    if (shiftErr) throw shiftErr

    const postedRunIds = new Set(runs.filter(r => r.status === 'POSTED').map(r => r.id))
    const eligible = (shifts || []).filter(s =>
      !s.xero_pay_run_id || s.xero_pay_run_id === payRun.id || !postedRunIds.has(s.xero_pay_run_id))

    // Cash-paid staff are handled outside Xero Payroll (cash schedule + cash
    // log) — their hours/amounts must NOT be pushed.
    const [{ data: tRows }, { data: dRows }] = await Promise.all([
      sb.from('tutors').select('id, full_name, pay_method'),
      sb.from('directors').select('id, full_name, pay_method'),
    ])
    const staffById = {}
    for (const r of [...(tRows || []), ...(dRows || [])]) staffById[r.id] = r

    const byTutor = {}
    const excludedCash = []
    for (const s of eligible) {
      const person = staffById[s.tutor_id]
      if ((person?.pay_method || 'bank') === 'cash') {
        const x = excludedCash.find(e => e.staffId === s.tutor_id)
          || excludedCash[excludedCash.push({ staffId: s.tutor_id, name: person?.full_name || s.tutor_id, hours: 0, amount: 0 }) - 1]
        x.hours += Number(s.hours || 0)
        x.amount += Number(s.hours || 0) * Number(s.rate_snapshot || 0)
        continue
      }
      const t = (byTutor[s.tutor_id] ||= { hours: 0, rates: new Set(), shiftIds: [], catchupHours: 0 })
      t.hours += Number(s.hours || 0)
      t.shiftIds.push(s.id)
      if (s.work_date < payRun.periodStart) t.catchupHours += Number(s.hours || 0)
      if (s.rate_snapshot != null) t.rates.add(Number(s.rate_snapshot))
    }
    if (!Object.keys(byTutor).length) {
      const cashNote = excludedCash.length
        ? ` (${excludedCash.length} cash-paid teacher${excludedCash.length === 1 ? '' : 's'} excluded)`
        : ''
      return NextResponse.json({
        error: `No approved, unpushed bank-paid hours between ${payrollFrom} and ${payRun.periodEnd} (Xero draft period ${payRun.periodStart} – ${payRun.periodEnd})${cashNote}. ` +
          `Hours already in a POSTED Xero pay run are never re-pushed.`,
      }, { status: 400 })
    }

    const payslipByEmp = Object.fromEntries((payRun.payslips || []).map(p => [p.employeeId, p]))

    const pushed = [], skipped = []
    for (const [staffId, agg] of Object.entries(byTutor)) {
      const hours = Math.round(agg.hours * 100) / 100
      if (hours <= 0) continue
      const map = empByStaff[staffId]
      if (!map) { skipped.push({ staffId, reason: 'not matched to a Xero employee' }); continue }
      const slip = payslipByEmp[map.xero_employee_id]
      if (!slip) { skipped.push({ name: map.xero_name || staffId, reason: 'no payslip in the Xero pay run (is the employee on this pay calendar?)' }); continue }
      const ratePerUnit = settings.send_rate && agg.rates.size === 1 ? [...agg.rates][0] : undefined
      try {
        await setPayslipHours(slip.payslipId, { earningsRateId: settings.earnings_rate_id, hours, ratePerUnit })
        // Stamp the shifts with this Xero run so they drop out of future
        // pushes once the run is posted.
        await sb.from('shifts').update({ xero_pay_run_id: payRun.id }).in('id', agg.shiftIds)
        pushed.push({
          name: slip.name || map.xero_name, hours, rate: ratePerUnit ?? null,
          catchupHours: Math.round(agg.catchupHours * 100) / 100 || 0,
        })
      } catch (e) {
        skipped.push({ name: slip.name || map.xero_name, reason: e.message })
      }
    }

    // Informational: does Xero's window line up with the portal fortnight the
    // admin is looking at? Differences are normal (holidays, calendar drift) —
    // the hours are still correct because selection is window-based.
    const windowDiffers = !!(periodStart && periodEnd &&
      (payRun.periodStart !== periodStart || payRun.periodEnd !== periodEnd))

    return NextResponse.json({
      success: true,
      payRun: { id: payRun.id, periodStart: payRun.periodStart, periodEnd: payRun.periodEnd, status: payRun.status },
      windowDiffers,
      portalPeriod: windowDiffers ? [periodStart, periodEnd] : null,
      pushed, skipped,
      excludedCash: excludedCash.map(x => ({
        name: x.name,
        hours: Math.round(x.hours * 100) / 100,
        amount: Math.round(x.amount * 100) / 100,
      })),
    })
  } catch (err) {
    if (err instanceof PayrollScopeError || err.scope) {
      return NextResponse.json({ needsReconnect: true, error: err.message }, { status: 200 })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

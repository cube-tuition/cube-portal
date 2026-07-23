import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../../lib/apiAuth'
import { listPayRuns, getPayRun, createDraftPayRun, setPayslipHours, PayrollScopeError } from '../../../../../lib/xeroPayroll'

function adminSb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * POST /api/xero/payroll/push
 * Push an approved fortnight into Xero Payroll as a DRAFT pay run.
 * body: { payRunId, periodStart, periodEnd }
 *
 * Sums each mapped teacher's hours for the run and writes them onto their
 * payslip in a draft Xero pay run. Never posts the pay run — a human does that
 * in Xero, which is what files STP. Returns a per-teacher report.
 */
export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { payRunId, periodStart, periodEnd } = await req.json()
    if (!payRunId) return NextResponse.json({ error: 'Missing payRunId' }, { status: 400 })

    const sb = adminSb()
    const { data: settings } = await sb.from('xero_payroll_settings').select('*').eq('id', 1).maybeSingle()
    if (!settings?.payroll_calendar_id || !settings?.earnings_rate_id) {
      return NextResponse.json({ error: 'Configure the Xero pay calendar and earnings rate first (⚙ Xero Payroll setup).' }, { status: 400 })
    }

    const { data: mapRows } = await sb.from('xero_employee_map').select('*')
    const empByStaff = Object.fromEntries((mapRows || []).map(m => [m.staff_id, m]))

    // Sum this run's hours per teacher (and track rate uniformity for optional $/h push).
    const { data: shifts, error: shiftErr } = await sb
      .from('shifts').select('tutor_id, hours, rate_snapshot').eq('pay_run_id', payRunId)
    if (shiftErr) throw shiftErr
    const byTutor = {}
    for (const s of shifts || []) {
      const t = (byTutor[s.tutor_id] ||= { hours: 0, rates: new Set() })
      t.hours += Number(s.hours || 0)
      if (s.rate_snapshot != null) t.rates.add(Number(s.rate_snapshot))
    }
    if (!Object.keys(byTutor).length) {
      return NextResponse.json({ error: 'No shifts on this pay run to push.' }, { status: 400 })
    }

    // Find an existing DRAFT pay run on this calendar, else create one. Xero owns
    // the period, so we surface a warning if it doesn't line up with the fortnight.
    let payRun
    const runs = await listPayRuns()
    payRun = runs.find(r => r.calendarId === settings.payroll_calendar_id && r.status === 'DRAFT')
    if (payRun) payRun = await getPayRun(payRun.id)      // re-fetch to get payslip stubs
    else payRun = await createDraftPayRun(settings.payroll_calendar_id)

    const periodMismatch = periodStart && periodEnd && payRun.periodStart && payRun.periodEnd &&
      (payRun.periodStart !== periodStart || payRun.periodEnd !== periodEnd)

    const payslipByEmp = Object.fromEntries((payRun.payslips || []).map(p => [p.employeeId, p]))

    const pushed = [], skipped = []
    for (const [staffId, agg] of Object.entries(byTutor)) {
      const map = empByStaff[staffId]
      if (!map) { skipped.push({ staffId, reason: 'not matched to a Xero employee' }); continue }
      const slip = payslipByEmp[map.xero_employee_id]
      if (!slip) { skipped.push({ name: map.xero_name || staffId, reason: 'no payslip in the Xero pay run (is the employee on this pay calendar?)' }); continue }
      const hours = Math.round(agg.hours * 100) / 100
      const ratePerUnit = settings.send_rate && agg.rates.size === 1 ? [...agg.rates][0] : undefined
      try {
        await setPayslipHours(slip.payslipId, { earningsRateId: settings.earnings_rate_id, hours, ratePerUnit })
        pushed.push({ name: slip.name || map.xero_name, hours, rate: ratePerUnit ?? null })
      } catch (e) {
        skipped.push({ name: slip.name || map.xero_name, reason: e.message })
      }
    }

    return NextResponse.json({
      success: true,
      payRun: { id: payRun.id, periodStart: payRun.periodStart, periodEnd: payRun.periodEnd, status: payRun.status },
      periodMismatch: periodMismatch ? { xero: [payRun.periodStart, payRun.periodEnd], portal: [periodStart, periodEnd] } : null,
      pushed, skipped,
    })
  } catch (err) {
    if (err instanceof PayrollScopeError || err.scope) {
      return NextResponse.json({ needsReconnect: true, error: err.message }, { status: 200 })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

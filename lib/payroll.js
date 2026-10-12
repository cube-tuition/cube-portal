/*
 * Payroll money rules for the Xero push — which approved hours go onto which
 * payslip, at which rates. Pure functions: no database, no Xero.
 *
 * /api/xero/payroll/push loads the shifts, staff and Xero runs, then calls
 * planPayslips; tests/payroll.test.mjs pins the behaviour. (Shift creation,
 * rates and pay-run approval live in the database — tests/payroll.db.test.mjs.)
 */

const round2 = (n) => Math.round(n * 100) / 100

/*
 * The real pay day for a Xero run: the day after its period ends — or today,
 * when pushing later than that. Dates are YYYY-MM-DD strings.
 */
export function payRunPaymentDate(periodEnd, todaySydney) {
  const dayAfterEnd = new Date(periodEnd + 'T00:00:00Z')
  dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1)
  return [dayAfterEnd.toISOString().slice(0, 10), todaySydney].sort().pop()
}

/*
 * Double-pay guard. Each pushed shift is stamped with the Xero run it went
 * into; it drops out only once that run is POSTED. A stamp pointing at the
 * current draft (a re-push) or at a deleted run is swept again.
 */
export function isPushable(shift, draftRunId, postedRunIds) {
  return !shift.xero_pay_run_id || shift.xero_pay_run_id === draftRunId || !postedRunIds.has(shift.xero_pay_run_id)
}

/*
 * Group approved shifts into payslips.
 *
 *   shifts        approved/paid shifts up to the draft's period end
 *                 [{ id, tutor_id, hours, rate_snapshot, work_date, xero_pay_run_id }]
 *   staffById     { id → { full_name, pay_method } } (tutors and directors)
 *   payRun        the Xero draft: { id, periodStart }
 *   postedRunIds  Set of Xero run ids already POSTED
 *
 * Returns
 *   teachers      [{ staffId, hours, catchupHours, shiftIds, lines }] — bank-paid
 *                 staff, in first-shift order. `lines` is one earnings line per
 *                 $/h, highest first (a fortnight often mixes rates; a single
 *                 blended line must never reach Xero). Unpriced hours (rate
 *                 null) sort last and take the employee's Xero template rate.
 *                 catchupHours are hours dated before the draft's period —
 *                 arrears that ride this run.
 *   excludedCash  [{ name, hours, amount }] — cash-paid staff are paid outside
 *                 Xero Payroll, so their hours are reported, never pushed.
 */
export function planPayslips({ shifts, staffById = {}, payRun, postedRunIds = new Set() }) {
  const byTutor = new Map()
  const excludedCash = []
  for (const s of shifts || []) {
    if (!isPushable(s, payRun.id, postedRunIds)) continue
    const person = staffById[s.tutor_id]
    const hrs = Number(s.hours || 0)
    if ((person?.pay_method || 'bank') === 'cash') {
      let x = excludedCash.find(e => e.staffId === s.tutor_id)
      if (!x) excludedCash.push(x = { staffId: s.tutor_id, name: person?.full_name || s.tutor_id, hours: 0, amount: 0 })
      x.hours += hrs
      x.amount += hrs * Number(s.rate_snapshot || 0)
      continue
    }
    let t = byTutor.get(s.tutor_id)
    if (!t) byTutor.set(s.tutor_id, t = { hours: 0, byRate: new Map(), shiftIds: [], catchupHours: 0 })
    t.hours += hrs
    t.shiftIds.push(s.id)
    if (s.work_date < payRun.periodStart) t.catchupHours += hrs
    const rate = s.rate_snapshot != null ? Number(s.rate_snapshot) : null
    t.byRate.set(rate, (t.byRate.get(rate) || 0) + hrs)
  }

  const teachers = [...byTutor.entries()].map(([staffId, t]) => ({
    staffId,
    hours: round2(t.hours),
    catchupHours: round2(t.catchupHours) || 0,
    shiftIds: t.shiftIds,
    lines: [...t.byRate.entries()]
      .map(([rate, hrs]) => ({ rate, hours: round2(hrs) }))
      .filter(l => l.hours > 0)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)),
  }))

  return {
    teachers,
    excludedCash: excludedCash.map(x => ({ name: x.name, hours: round2(x.hours), amount: round2(x.amount) })),
  }
}

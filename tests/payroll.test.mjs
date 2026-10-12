/*
 * The Xero payroll push — lib/payroll.js. Which approved hours land on which
 * payslip, at which rates, and which are never pushed. Pure functions only.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { planPayslips, payRunPaymentDate, isPushable } from '../lib/payroll.js'

const staffById = {
  monica: { full_name: 'Monica Chen', pay_method: 'bank' },
  james:  { full_name: 'James Wu' },                         // no method → bank
  sam:    { full_name: 'Sam Lee', pay_method: 'cash' },
}
const payRun = { id: 'xr-draft', periodStart: '2026-10-12' }
let n = 0
const shift = (tutor_id, hours, rate_snapshot, work_date = '2026-10-14', xero_pay_run_id = null) =>
  ({ id: `s${++n}`, tutor_id, hours, rate_snapshot, work_date, xero_pay_run_id })
const plan = (shifts, postedRunIds = new Set()) => planPayslips({ shifts, staffById, payRun, postedRunIds })

describe('payslip lines', () => {
  test('one teacher, one rate: one earnings line', () => {
    const { teachers } = plan([shift('monica', 2, 40), shift('monica', 1.5, 40)])
    assert.deepEqual(teachers.map(({ shiftIds, ...t }) => t), [
      { staffId: 'monica', hours: 3.5, catchupHours: 0, lines: [{ rate: 40, hours: 3.5 }] },
    ])
  })

  test('mixed rates: one line per rate, highest first — never a blended rate', () => {
    const { teachers } = plan([shift('monica', 2, 40), shift('monica', 1, 55), shift('monica', 2, 45), shift('monica', 1, 40)])
    assert.deepEqual(teachers[0].lines, [{ rate: 55, hours: 1 }, { rate: 45, hours: 2 }, { rate: 40, hours: 3 }])
    assert.equal(teachers[0].hours, 6)
  })

  test('unpriced hours get their own line, last, for the Xero template rate', () => {
    const { teachers } = plan([shift('james', 2, null), shift('james', 1, 30)])
    assert.deepEqual(teachers[0].lines, [{ rate: 30, hours: 1 }, { rate: null, hours: 2 }])
  })

  test('rates arriving as strings (numeric columns) bucket together', () => {
    const { teachers } = plan([shift('monica', 1, '40.00'), shift('monica', 1, 40)])
    assert.deepEqual(teachers[0].lines, [{ rate: 40, hours: 2 }])
  })

  test('hours are rounded to the cent of an hour, without float drift', () => {
    const { teachers } = plan([shift('monica', 0.1, 40), shift('monica', 0.2, 40)])
    assert.equal(teachers[0].hours, 0.3)
    assert.deepEqual(teachers[0].lines, [{ rate: 40, hours: 0.3 }])
  })

  test('each teacher gets their own payslip, with the shift ids to stamp', () => {
    const a = shift('monica', 2, 40), b = shift('james', 1, 30), c = shift('monica', 1, 40)
    const { teachers } = plan([a, b, c])
    assert.deepEqual(teachers.map(t => [t.staffId, t.shiftIds]), [['monica', [a.id, c.id]], ['james', [b.id]]])
  })

  test('hours from before the Xero period are counted and flagged as catch-up', () => {
    const { teachers } = plan([shift('monica', 2, 40, '2026-09-30'), shift('monica', 2, 40, '2026-10-12')])
    assert.equal(teachers[0].hours, 4)
    assert.equal(teachers[0].catchupHours, 2)
  })
})

describe('cash-paid staff', () => {
  test('are never pushed to Xero, but are reported with what they are owed', () => {
    const { teachers, excludedCash } = plan([shift('sam', 2, 40), shift('sam', 1.5, 30), shift('monica', 1, 40)])
    assert.deepEqual(teachers.map(t => t.staffId), ['monica'])
    assert.deepEqual(excludedCash, [{ name: 'Sam Lee', hours: 3.5, amount: 125 }])
  })

  test('an unpriced cash shift counts its hours but adds no money', () => {
    const { excludedCash } = plan([shift('sam', 2, null)])
    assert.deepEqual(excludedCash, [{ name: 'Sam Lee', hours: 2, amount: 0 }])
  })

  test('only cash staff → nothing to push', () => {
    const { teachers, excludedCash } = plan([shift('sam', 2, 40)])
    assert.deepEqual(teachers, [])
    assert.equal(excludedCash.length, 1)
  })
})

describe('double-pay guard', () => {
  const posted = new Set(['xr-posted'])

  test('hours already in a POSTED Xero run are never pushed again', () => {
    const { teachers } = plan([shift('monica', 2, 40, '2026-10-01', 'xr-posted'), shift('monica', 1, 40)], posted)
    assert.equal(teachers[0].hours, 1)
  })

  test('a re-push of the same draft includes its hours again (overwrite, not add)', () => {
    const { teachers } = plan([shift('monica', 2, 40, '2026-10-14', 'xr-draft')], posted)
    assert.equal(teachers[0].hours, 2)
  })

  test('hours stamped with a deleted (unposted) run are swept back in', () => {
    const { teachers } = plan([shift('monica', 2, 40, '2026-10-14', 'xr-deleted')], posted)
    assert.equal(teachers[0].hours, 2)
  })

  test('a cash teacher\'s posted hours are not reported again either', () => {
    const { excludedCash } = plan([shift('sam', 2, 40, '2026-10-01', 'xr-posted')], posted)
    assert.deepEqual(excludedCash, [])
  })

  test('isPushable on its own', () => {
    assert.equal(isPushable({ xero_pay_run_id: null }, 'd', posted), true)
    assert.equal(isPushable({ xero_pay_run_id: 'xr-posted' }, 'd', posted), false)
    assert.equal(isPushable({ xero_pay_run_id: 'xr-posted' }, 'xr-posted', posted), true)
  })
})

describe('pay date', () => {
  test('the day after the period ends', () => {
    assert.equal(payRunPaymentDate('2026-10-25', '2026-10-20'), '2026-10-26')
  })
  test('today, when pushing after that', () => {
    assert.equal(payRunPaymentDate('2026-10-25', '2026-10-29'), '2026-10-29')
  })
  test('across month and year ends, and leap days', () => {
    assert.equal(payRunPaymentDate('2026-10-31', '2026-10-01'), '2026-11-01')
    assert.equal(payRunPaymentDate('2026-12-31', '2026-12-01'), '2027-01-01')
    assert.equal(payRunPaymentDate('2028-02-28', '2028-02-01'), '2028-02-29')
  })
})

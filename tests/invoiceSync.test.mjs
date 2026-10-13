/*
 * Refresh as a plan (lib/billing planInvoiceRefresh / describeRefresh) and the
 * automatic draft sync built on it (lib/invoiceSync). Pure functions only.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildInvoiceLines, planInvoiceRefresh, describeRefresh, pairKey } from '../lib/billing.js'
import { pairsByInvoice, syncPatch } from '../lib/invoiceSync.js'

const cls = {
  1: { class_name: 'Y8 Maths',   day_of_week: 'Monday',  start_time: '16:00', courses: { course_price: 600 } },
  2: { class_name: 'Y8 Science', day_of_week: 'Tuesday', start_time: '16:00', courses: { course_price: 600 } },
  3: { class_name: 'Y9 Maths 1:1', day_of_week: 'Friday', start_time: '17:00', courses: { course_price: null } },
}
const names = { kim: 'Kim Lee', ana: 'Ana Lee' }
// A generated invoice for these enrolments.
const invoiceFor = (enrolments, extra = {}) => {
  const { lineItems, siblingDiscount, multiCourseDiscount } = buildInvoiceLines({
    enrolments, classMap: cls, studentMap: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, { full_name: v }])),
  })
  const total = lineItems.reduce((s, l) => s + l.amount, 0)
  return { id: 1, term_id: 'T4', family_id: 7, student_id: null, status: 'draft', line_items: lineItems,
    total, subtotal: total, sibling_discount: siblingDiscount, multi_course_discount: multiCourseDiscount, payment_method: 'bank', ...extra }
}
const enr = (student_id, class_id, price = null, status = 'active') => ({ student_id, class_id, price, status, classes: cls[class_id] })
const rows = (list) => list.map(e => ({ student_id: e.student_id, class_id: e.class_id, price: e.price, classes: { courses: cls[e.class_id].courses } }))
const plan = (invoice, termEnrolments, opts = {}) => planInvoiceRefresh({
  invoice, memberIds: ['kim', 'ana'], nameOf: names, termEnrolments,
  enrolmentRows: rows(opts.allEnrolments || termEnrolments), paymentMethodOf: opts.pay || {}, onlyPairs: opts.only || null,
})
const classes = (p) => p.lineItems.filter(l => l.type === 'enrolment').map(l => `${l.student_id}:${l.class_id}:${l.amount}`)

describe('Refresh as a plan', () => {
  test('in step: changes nothing and describes nothing', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }])
    const p = plan(inv, [enr('kim', 1)])
    assert.deepEqual(p.lineItems, inv.line_items)
    assert.deepEqual(describeRefresh(inv, p), [])
  })

  test('a class added after generation is billed, with its discount', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }])
    const p = plan(inv, [enr('kim', 1), enr('kim', 2)])
    assert.deepEqual(classes(p), ['kim:1:600', 'kim:2:600'])
    assert.equal(p.total, 1100)
    assert.deepEqual(describeRefresh(inv, p), [
      'not billed: Kim – Y8 Science ($600)', 'multi-course discount needs recalculating', 'total $600 → $1,100',
    ])
  })

  test('a new enrolment price flows through', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1, price: 600 }])
    const p = plan(inv, [enr('kim', 1, 650)])
    assert.deepEqual(classes(p), ['kim:1:650'])
    assert.deepEqual(describeRefresh(inv, p), ['Kim – Y8 Maths: invoice $600, enrolment $650', 'total $600 → $650'])
  })

  test('an enrolment with no price anywhere keeps the invoice price — never wiped to $0', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 3, price: 1050 }])     // typed onto the invoice
    const p = plan(inv, [enr('kim', 3, null)])
    assert.deepEqual(classes(p), ['kim:3:1050'])
    assert.equal(p.updated, 0)
    assert.deepEqual(describeRefresh(inv, p), ['Kim – Y9 Maths 1:1: the enrolment has no price (invoice says $1,050) — set it on the enrolment'])
  })

  test('a $0 enrolment price is a real price (a free class), not "unknown"', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1, price: 600 }])
    assert.deepEqual(classes(plan(inv, [enr('kim', 1, 0)])), ['kim:1:0'])
  })

  test('a family switching to cash gets the 10% line; the plan says so', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }])
    const p = plan(inv, [enr('kim', 1)], { pay: { kim: 'cash' } })
    assert.equal(p.isCash, true)
    assert.equal(p.total, 540)
    assert.deepEqual(describeRefresh(inv, p), ['cash payer: the 10% cash discount is missing', 'total $600 → $540'])
  })

  test('a total that drifted from its own lines is reported on its own', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }], { total: 2100 })
    assert.deepEqual(describeRefresh(inv, plan(inv, [enr('kim', 1)])), ["total $2,100 doesn't match its lines ($600)"])
  })
})

describe('scoped to the enrolments that changed (the automatic sync)', () => {
  test('a hand-edited price on another line is not undone', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }])
    inv.line_items[0] = { ...inv.line_items[0], unit_price: 500, amount: 500 }    // staff gave Kim $100 off
    const p = plan(inv, [enr('kim', 1), enr('ana', 2)], { only: new Set([pairKey('ana', 2)]) })
    assert.deepEqual(classes(p), ['kim:1:500', 'ana:2:600'])
  })

  test('a class line staff removed by hand is not put back by an unrelated change', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }])                 // Kim's Y8 Science removed by hand
    const p = plan(inv, [enr('kim', 1), enr('kim', 2), enr('ana', 1, 700)], { only: new Set([pairKey('ana', 1)]) })
    assert.deepEqual(classes(p), ['kim:1:600', 'ana:1:700'])
  })

  test('a line with no enrolment behind it is only removed when its own enrolment changed', () => {
    // Kim's Y8 Science has no live enrolment (it ended before the queue existed,
    // or the line was added by hand); Ana's new class must not sweep it away.
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }, { student_id: 'kim', class_id: 2 }])
    const p = plan(inv, [enr('kim', 1), enr('ana', 1)], { only: new Set([pairKey('ana', 1)]) })
    assert.deepEqual(classes(p), ['kim:1:600', 'kim:2:600', 'ana:1:600'])
    assert.deepEqual(p.removedNames, [])
  })

  test('the changed enrolment itself is brought in line: added, re-priced or removed', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }, { student_id: 'kim', class_id: 2 }])
    const dropped = plan(inv, [enr('kim', 1)], { only: new Set([pairKey('kim', 2)]), allEnrolments: [enr('kim', 1), enr('kim', 2, null, 'disenrol')] })
    assert.deepEqual(classes(dropped), ['kim:1:600'])
    assert.deepEqual(dropped.removedNames, ['Kim – Y8 Science'])
    const repriced = plan(inv, [enr('kim', 1, 650), enr('kim', 2)], { only: new Set([pairKey('kim', 1)]) })
    assert.deepEqual(classes(repriced), ['kim:1:650', 'kim:2:600'])
  })

  test('the applied wording says what was done', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }])
    const p = plan(inv, [enr('kim', 1, 650), enr('kim', 2)], { only: new Set([pairKey('kim', 1), pairKey('kim', 2)]) })
    assert.deepEqual(describeRefresh(inv, p, { done: true }), ['Kim – Y8 Maths now $650', 'added Kim – Y8 Science ($600)', 'total $600 → $1,150'])
  })
})

describe('which drafts a queued change belongs to', () => {
  const drafts = [
    { id: 1, term_id: 'T4', family_id: 7, line_items: [] },
    { id: 2, term_id: 'T3', family_id: 7, line_items: [] },                      // last term's
    { id: 3, term_id: 'T4', family_id: null, student_id: 'solo', line_items: [] },
    { id: 4, term_id: 'T4', family_id: 9, line_items: [{ type: 'enrolment', student_id: 'kim', class_id: 1 }] },
  ]
  test("the family's draft for that class's term — and any draft already billing that class", () => {
    const m = pairsByInvoice({ queue: [{ student_id: 'kim', class_id: 1 }], drafts, familyOf: { kim: 7 }, termOf: { 1: 'T4' } })
    assert.deepEqual([...m.keys()], [1, 4])
  })
  test("a student without a family: their own draft only", () => {
    const m = pairsByInvoice({ queue: [{ student_id: 'solo', class_id: 2 }], drafts, familyOf: { solo: null }, termOf: { 2: 'T4' } })
    assert.deepEqual([...m.keys()], [3])
  })
  test('a class in a term with no draft touches nothing', () => {
    const m = pairsByInvoice({ queue: [{ student_id: 'kim', class_id: 5 }], drafts, familyOf: { kim: 7 }, termOf: { 5: 'T1' } })
    assert.equal(m.size, 0)
  })
})

describe('the saved patch', () => {
  test('nothing to save when the plan changes nothing', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }])
    assert.equal(syncPatch(inv, plan(inv, [enr('kim', 1)])), null)
  })
  test('lines, totals, discount columns and payment method move together', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }])
    const patch = syncPatch(inv, plan(inv, [enr('kim', 1), enr('kim', 2)], { pay: { kim: 'cash' } }))
    assert.equal(patch.total, 990)                                                // (1200 − 100) × 0.9
    assert.equal(patch.subtotal, 990)
    assert.equal(patch.multi_course_discount, 100)
    assert.equal(patch.payment_method, 'cash')
  })
  test('a stored total that drifted is corrected even if the lines are right', () => {
    const inv = invoiceFor([{ student_id: 'kim', class_id: 1 }], { total: 2100 })
    assert.equal(syncPatch(inv, plan(inv, [enr('kim', 1)])).total, 600)
  })
})

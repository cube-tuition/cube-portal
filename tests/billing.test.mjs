/*
 * Invoice money rules — lib/billing.js and lib/cashDiscount.js.
 * Run with `npm test`. Pure functions only: no database, no network.
 *
 * Each test pins a rule that has either broken before or that a family would
 * notice on their bill. When a rule changes on purpose, change the test with it.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  enrolmentFee, buildInvoiceLines, reconcileEnrolmentLines, discountTotals, creditLine,
} from '../lib/billing.js'
import {
  syncCashDiscountLines, totalFromLineItems, invoiceTotalsPatch, markCashLineManual,
  CASH_DISCOUNT_REASON,
} from '../lib/cashDiscount.js'

// ── Fixtures ────────────────────────────────────────────────────────────────
const classMap = {
  1: { class_name: 'Y5 Maths',      day_of_week: 'Saturday', start_time: '13:00', courses: { course_price: 600 } },
  2: { class_name: 'Y5 English',    day_of_week: 'Saturday', start_time: '15:00', courses: { course_price: 600 } },
  3: { class_name: 'Y8 Maths',      day_of_week: 'Monday',   start_time: '17:00', courses: { course_price: 700 } },
  4: { class_name: 'Y8 Science',    day_of_week: 'Tuesday',  start_time: '17:00', courses: { course_price: 700 } },
}
const studentMap = { ana: { full_name: 'Ana Lee' }, ben: { full_name: 'Ben Lee' } }
const reasons = (lines) => lines.map(l => l.reason || `${l.student_id}:${l.class_id}`)
const total = (lines) => totalFromLineItems(lines)

// A term enrolment as /api/refresh-invoice loads it.
const termEnrol = (student_id, class_id, price = null, status = 'active') =>
  ({ student_id, class_id, price, status, classes: classMap[class_id] })

// ── Fees ────────────────────────────────────────────────────────────────────
describe('enrolment fee', () => {
  test('the enrolment price wins over the course price', () => {
    assert.equal(enrolmentFee(550, 600), 550)
    assert.equal(enrolmentFee('550.50', 600), 550.5)
  })
  test('a blank enrolment price falls back to the course price', () => {
    assert.equal(enrolmentFee(null, 600), 600)
    assert.equal(enrolmentFee(undefined, '600'), 600)
  })
  test('a $0 enrolment price is kept (a free class), not replaced by the course price', () => {
    assert.equal(enrolmentFee(0, 600), 0)
    assert.equal(enrolmentFee('0', 600), 0)
  })
  test('no price anywhere is $0, never NaN', () => {
    assert.equal(enrolmentFee(null, null), 0)
    assert.equal(enrolmentFee(null, undefined), 0)
  })
})

// ── Generation ──────────────────────────────────────────────────────────────
describe('generating a new invoice', () => {
  test('one student, one class: one line, no discounts', () => {
    const r = buildInvoiceLines({ enrolments: [{ student_id: 'ana', class_id: 1, price: null }], classMap, studentMap })
    assert.equal(r.lineItems.length, 1)
    assert.deepEqual(r.lineItems[0], {
      student_id: 'ana', student_name: 'Ana Lee', class_id: 1, class_name: 'Y5 Maths',
      day: 'Saturday', start_time: '13:00', unit_price: 600, quantity: 1, amount: 600, type: 'enrolment',
    })
    assert.equal(r.siblingDiscount, 0)
    assert.equal(r.multiCourseDiscount, 0)
    assert.equal(total(r.lineItems), 600)
  })

  test('two siblings: $50 off per student', () => {
    const r = buildInvoiceLines({
      enrolments: [{ student_id: 'ana', class_id: 1 }, { student_id: 'ben', class_id: 3 }], classMap, studentMap,
    })
    assert.deepEqual(reasons(r.lineItems), ['ana:1', 'ben:3', 'Sibling discount (2 students)'])
    assert.equal(r.siblingDiscount, 100)
    assert.equal(total(r.lineItems), 600 + 700 - 100)
  })

  test('one student in three classes: $50 off per class', () => {
    const r = buildInvoiceLines({
      enrolments: [1, 2, 3].map(c => ({ student_id: 'ana', class_id: c })), classMap, studentMap,
    })
    assert.deepEqual(reasons(r.lineItems).slice(3), ['Multi-course discount (Ana, 3 courses)'])
    assert.equal(r.multiCourseDiscount, 150)
    assert.equal(total(r.lineItems), 1900 - 150)
  })

  test('siblings who are both multi-course: sibling line first, then one multi line per student', () => {
    const r = buildInvoiceLines({
      enrolments: [
        { student_id: 'ana', class_id: 1 }, { student_id: 'ana', class_id: 2 },
        { student_id: 'ben', class_id: 3 }, { student_id: 'ben', class_id: 4 },
      ],
      classMap, studentMap,
    })
    assert.deepEqual(reasons(r.lineItems).slice(4), [
      'Sibling discount (2 students)',
      'Multi-course discount (Ana, 2 courses)',
      'Multi-course discount (Ben, 2 courses)',
    ])
    assert.equal(r.siblingDiscount, 100)
    assert.equal(r.multiCourseDiscount, 200)
    assert.equal(total(r.lineItems), 2600 - 300)
  })

  test('a student with no name still gets a readable discount line', () => {
    const r = buildInvoiceLines({
      enrolments: [{ student_id: 'x', class_id: 1 }, { student_id: 'x', class_id: 2 }], classMap, studentMap: {},
    })
    assert.equal(r.lineItems[0].student_name, '—')
    assert.equal(r.lineItems[2].reason, 'Multi-course discount (student, 2 courses)')
  })

  test('discount totals are 0, never -0', () => {
    const r = buildInvoiceLines({ enrolments: [{ student_id: 'ana', class_id: 1 }], classMap, studentMap })
    assert.ok(Object.is(r.siblingDiscount, 0))
    assert.ok(Object.is(r.multiCourseDiscount, 0))
  })
})

// ── Credits ─────────────────────────────────────────────────────────────────
describe('held credits', () => {
  test('a referral is a discount line; an absence is a credit line', () => {
    assert.deepEqual(creditLine({ amount: '50', reason: 'referral_referred', notes: '' }),
      { type: 'discount', reason: 'Referral discount', amount: -50 })
    assert.deepEqual(creditLine({ amount: 35.5, reason: 'missed_lesson', notes: null }),
      { type: 'credit', reason: 'missed lesson', amount: -35.5 })
    assert.deepEqual(creditLine({ amount: 60, reason: 'Absence', notes: 'Absence — Y8 Maths, Week 3' }),
      { type: 'credit', reason: 'Absence — Y8 Maths, Week 3', amount: -60 })
  })

  test('credits go after the discounts and are reported so they can be linked once', () => {
    const r = buildInvoiceLines({
      enrolments: [{ student_id: 'ana', class_id: 1 }, { student_id: 'ben', class_id: 3 }],
      classMap, studentMap,
      credits: {
        ana: [{ id: 'c1', amount: 50, reason: 'referral_referred' }],
        ben: [{ id: 'c2', amount: 40, reason: 'Absence', notes: 'Absence — Week 2' }],
      },
    })
    assert.deepEqual(reasons(r.lineItems), ['ana:1', 'ben:3', 'Sibling discount (2 students)', 'Referral discount', 'Absence — Week 2'])
    assert.deepEqual(r.appliedCreditIds, ['c1', 'c2'])
    assert.equal(total(r.lineItems), 1300 - 100 - 50 - 40)
  })

  test('a student in two classes has their credit applied once, not once per class', () => {
    const r = buildInvoiceLines({
      enrolments: [{ student_id: 'ana', class_id: 1 }, { student_id: 'ana', class_id: 2 }],
      classMap, studentMap,
      credits: { ana: [{ id: 'c1', amount: 30, reason: 'Absence' }] },
    })
    assert.equal(r.lineItems.filter(l => l.type === 'credit').length, 1)
    assert.deepEqual(r.appliedCreditIds, ['c1'])
  })

  test("another family's credits are not applied", () => {
    const r = buildInvoiceLines({
      enrolments: [{ student_id: 'ana', class_id: 1 }], classMap, studentMap,
      credits: { someoneElse: [{ id: 'c9', amount: 30, reason: 'Absence' }] },
    })
    assert.equal(r.lineItems.length, 1)
    assert.deepEqual(r.appliedCreditIds, [])
  })
})

// ── Cash discount ───────────────────────────────────────────────────────────
describe('cash discount', () => {
  test('10% of the total AFTER every other discount and credit, on the last line', () => {
    const r = buildInvoiceLines({
      enrolments: [{ student_id: 'ana', class_id: 1 }, { student_id: 'ana', class_id: 2 }],
      classMap, studentMap, cash: true,
      credits: { ana: [{ id: 'c1', amount: 50, reason: 'referral_referred' }] },
    })
    const last = r.lineItems.at(-1)
    assert.equal(last.reason, CASH_DISCOUNT_REASON)
    // 1200 − 100 multi − 50 referral = 1050 → 10% = 105
    assert.equal(last.amount, -105)
    assert.equal(total(r.lineItems), 945)
  })

  test('a bank family gets no cash line', () => {
    const r = buildInvoiceLines({ enrolments: [{ student_id: 'ana', class_id: 1 }], classMap, studentMap })
    assert.ok(!r.lineItems.some(l => l.cash))
  })

  test('rounds to the cent', () => {
    const { lineItems } = syncCashDiscountLines([{ type: 'enrolment', amount: 333.33 }], true)
    assert.equal(lineItems.at(-1).amount, -33.33)
  })

  test('switching bank → cash adds the line; cash → bank removes it', () => {
    const base = [{ type: 'enrolment', amount: 600 }]
    const toCash = syncCashDiscountLines(base, true)
    assert.equal(toCash.changed, true)
    assert.equal(total(toCash.lineItems), 540)
    const toBank = syncCashDiscountLines(toCash.lineItems, false)
    assert.equal(toBank.changed, true)
    assert.deepEqual(toBank.lineItems, base)
  })

  test('re-running is stable: the cash line never counts toward its own base', () => {
    const once = syncCashDiscountLines([{ type: 'enrolment', amount: 600 }], true).lineItems
    const twice = syncCashDiscountLines(once, true)
    assert.equal(twice.changed, false)
    assert.deepEqual(twice.lineItems, once)
  })

  test('a price change re-prices the existing cash line in place', () => {
    const once = syncCashDiscountLines([{ type: 'enrolment', amount: 600 }], true).lineItems
    const repriced = syncCashDiscountLines([{ type: 'enrolment', amount: 700 }, once[1]], true)
    assert.equal(repriced.changed, true)
    assert.equal(repriced.lineItems.length, 2)
    assert.equal(repriced.lineItems[1].amount, -70)
  })

  test('a hand-set (manual) cash line survives re-pricing, but not a switch to bank', () => {
    const pinned = [{ type: 'enrolment', amount: 700 }, markCashLineManual({ type: 'discount', reason: CASH_DISCOUNT_REASON, amount: -50 })]
    assert.equal(syncCashDiscountLines(pinned, true).changed, false)
    assert.equal(invoiceTotalsPatch(pinned).total, 650)
    assert.equal(syncCashDiscountLines(pinned, false).lineItems.length, 1)
  })

  test('a fully credited invoice: cash line is 0 (not −0) and the total never goes negative', () => {
    const { lineItems } = syncCashDiscountLines([{ type: 'enrolment', amount: 100 }, { type: 'credit', amount: -150 }], true)
    assert.ok(Object.is(lineItems.at(-1).amount, 0))
    assert.equal(total(lineItems), 0)
  })

  test('invoiceTotalsPatch re-prices an existing cash line but never grants one', () => {
    const cashInv = syncCashDiscountLines([{ type: 'enrolment', amount: 600 }], true).lineItems
    const withCredit = [...cashInv.slice(0, 1), { type: 'credit', amount: -100 }, cashInv[1]]
    assert.deepEqual(invoiceTotalsPatch(withCredit).total, 450)                // (600−100) × 0.9
    assert.equal(invoiceTotalsPatch([{ type: 'enrolment', amount: 600 }]).total, 600)
  })
})

// ── Refresh ─────────────────────────────────────────────────────────────────
describe('refreshing an existing invoice', () => {
  const generated = (enrolments, opts = {}) =>
    buildInvoiceLines({ enrolments, classMap, studentMap, ...opts }).lineItems
  const refresh = (lineItems, termEnrolments, memberIds = ['ana', 'ben']) =>
    reconcileEnrolmentLines({ lineItems, termEnrolments, memberIds, nameOf: { ana: 'Ana Lee', ben: 'Ben Lee' } })

  test('nothing changed: the invoice is left exactly as it was', () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }])
    const r = refresh(inv, [termEnrol('ana', 1)])
    assert.deepEqual(r.lineItems, inv)
    assert.equal(r.added, 0)
    assert.deepEqual(r.removedNames, [])
    assert.deepEqual(r.notes, [])
  })

  test('a class added after generation is added, and the multi-course discount appears', () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }])
    const r = refresh(inv, [termEnrol('ana', 1), termEnrol('ana', 2, 550)])
    assert.equal(r.added, 1)
    assert.deepEqual(reasons(r.lineItems), ['ana:1', 'ana:2', 'Multi-course discount (Ana, 2 courses)'])
    assert.equal(r.lineItems[1].amount, 550)
    assert.equal(total(r.lineItems), 600 + 550 - 100)
  })

  test("a sibling's new class goes with the class lines and brings the sibling discount", () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }])
    const r = refresh(inv, [termEnrol('ana', 1), termEnrol('ben', 3)])
    assert.deepEqual(reasons(r.lineItems), ['ana:1', 'ben:3', 'Sibling discount (2 students)'])
  })

  test('a trial enrolment is not added (only active ones are billed)', () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }])
    const r = refresh(inv, [termEnrol('ana', 1), termEnrol('ana', 2, null, 'trial')])
    assert.equal(r.added, 0)
    assert.deepEqual(r.lineItems, inv)
  })

  test('a dropped class is removed and the multi-course discount goes with it', () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }, { student_id: 'ana', class_id: 2 }])
    const r = refresh(inv, [termEnrol('ana', 1)])
    assert.deepEqual(r.removedNames, ['Ana – Y5 English'])
    assert.deepEqual(reasons(r.lineItems), ['ana:1'])
    assert.equal(total(r.lineItems), 600)
  })

  test('a class line is kept while its enrolment is a trial', () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }, { student_id: 'ana', class_id: 2 }])
    const r = refresh(inv, [termEnrol('ana', 1), termEnrol('ana', 2, null, 'trial')])
    assert.deepEqual(r.lineItems, inv)
  })

  test('a class re-created under a new id is swapped, discounts unchanged', () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }, { student_id: 'ana', class_id: 2 }])
    const r = refresh(inv, [termEnrol('ana', 1), termEnrol('ana', 4)])
    assert.equal(r.added, 1)
    assert.deepEqual(r.removedNames, ['Ana – Y5 English'])
    assert.deepEqual(reasons(r.lineItems), ['ana:1', 'ana:4', 'Multi-course discount (Ana, 2 courses)'])
    assert.deepEqual(r.notes, [])
  })

  test('never empties the invoice: with nothing live it says to void instead', () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }])
    const r = refresh(inv, [])
    assert.deepEqual(r.lineItems, inv)
    assert.match(r.notes[0], /void it/)
  })

  test('a hand-edited discount is left alone and flagged', () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }, { student_id: 'ana', class_id: 2 }])
    inv[2] = { ...inv[2], amount: -80 }                                 // staff changed $100 → $80
    const r = refresh(inv, [termEnrol('ana', 1), termEnrol('ana', 2), termEnrol('ana', 3)])
    assert.equal(r.added, 1)
    assert.equal(r.lineItems.find(l => /^Multi-course/.test(l.reason)).amount, -80)
    assert.match(r.notes[0], /multi-course discount was edited by hand/)
  })

  test('hand-added lines (credits, referral, adjustments) are never touched', () => {
    const inv = [
      ...generated([{ student_id: 'ana', class_id: 1 }]),
      { type: 'discount', reason: 'Referral discount', amount: -50 },
      { type: 'credit', reason: 'Absence — Week 3', amount: -60 },
    ]
    const r = refresh(inv, [termEnrol('ana', 1), termEnrol('ana', 2)])
    // The new discount goes where the generator puts it: straight after the classes.
    assert.deepEqual(reasons(r.lineItems), [
      'ana:1', 'ana:2', 'Multi-course discount (Ana, 2 courses)', 'Referral discount', 'Absence — Week 3',
    ])
    assert.deepEqual(r.lineItems.slice(3), inv.slice(1))
  })

  test("lines for someone outside the family, or without a class, stay put", () => {
    const inv = [
      ...generated([{ student_id: 'ana', class_id: 1 }]),
      { type: 'enrolment', student_id: 'cousin', class_id: 3, amount: 700 },
      { type: 'enrolment', student_id: 'ana', class_id: null, class_name: 'Holiday workshop', amount: 200 },
    ]
    const r = refresh(inv, [termEnrol('ana', 1)], ['ana'])
    assert.deepEqual(r.lineItems, inv)
  })

  test('refresh then cash sync: cash line stays last and is re-priced', () => {
    const inv = generated([{ student_id: 'ana', class_id: 1 }], { cash: true })
    const r = refresh(inv, [termEnrol('ana', 1), termEnrol('ana', 2)])
    const synced = syncCashDiscountLines(r.lineItems, true).lineItems
    assert.equal(synced.at(-1).reason, CASH_DISCOUNT_REASON)
    assert.equal(synced.at(-1).amount, -110)                             // (1200 − 100) × 10%
    assert.equal(total(synced), 990)
  })

  test('discount totals for the invoice columns', () => {
    const inv = generated([
      { student_id: 'ana', class_id: 1 }, { student_id: 'ana', class_id: 2 }, { student_id: 'ben', class_id: 3 },
    ], { cash: true })
    assert.deepEqual(discountTotals(inv), { siblingDiscount: 100, multiCourseDiscount: 100 })
    assert.deepEqual(discountTotals([]), { siblingDiscount: 0, multiCourseDiscount: 0 })
  })
})

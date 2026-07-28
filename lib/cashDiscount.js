/*
 * Cash-payment discount — families who pay in cash get 10% off their tuition.
 *
 * The discount is 10% of the TUITION (enrolment) lines only, calculated before
 * flat discounts and credits, so it stacks independently with the sibling /
 * multi-course discounts and referral or absence credits.
 *
 * GST note (CUBE is GST-registered): prices are GST-inclusive and the invoice
 * PDF derives GST as total ÷ 11, so the discount automatically reduces the GST
 * component proportionally. The GST breakdown stays on cash invoices — payment
 * method never changes whether a supply is taxable.
 */

export const CASH_DISCOUNT_RATE = 0.10
export const CASH_DISCOUNT_REASON = 'Cash discount (10%) — cash payment'

export const CASH_PAYMENT_INSTRUCTIONS =
`Cash payment:
Please pay in cash at the CUBE Tuition front desk.
A 10% cash discount has been applied to this invoice.`

const round2 = (n) => Math.round(n * 100) / 100

// The discount line for a given tuition subtotal (inc-GST). Marked with
// cash:true so refresh/backfill can find and recompute it reliably.
export function cashDiscountLine(tuitionTotal) {
  return { type: 'discount', cash: true, reason: CASH_DISCOUNT_REASON, amount: -round2((Number(tuitionTotal) || 0) * CASH_DISCOUNT_RATE) }
}

export function isCashDiscountLine(l) {
  return l?.type === 'discount' && (l.cash === true || /^Cash discount/i.test(l.reason || ''))
}

// 10% of the enrolment lines in an existing line_items array.
export function cashDiscountFor(lineItems) {
  const tuition = (lineItems || []).filter(l => l.type === 'enrolment')
    .reduce((s, l) => s + (Number(l.amount) || 0), 0)
  return cashDiscountLine(tuition)
}

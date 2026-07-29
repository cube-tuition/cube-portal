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

export const BANK_PAYMENT_INSTRUCTIONS =
`Bank Transfer:
Account name: CUBE Tuition
BSB: 067-873  |  Account: 1616 0459
Reference: [Reference]`

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

/*
 * Bring an invoice's line items in line with a family's current payment method:
 * add the 10% line, recompute it if the tuition has changed, or drop it if they
 * have moved back to bank. Returns the new array and whether anything moved.
 *
 * This is the single definition of what the cash discount does to an invoice —
 * both the Refresh action and the payment-method switch go through it, so the
 * two can't drift apart.
 */
export function syncCashDiscountLines(lineItems, isCash) {
  const items = lineItems || []
  const hasCashLine = items.some(isCashDiscountLine)

  if (!isCash) {
    return hasCashLine
      ? { lineItems: items.filter(l => !isCashDiscountLine(l)), changed: true }
      : { lineItems: items, changed: false }
  }

  // The cash line is a discount, so it never counts toward its own base.
  const fresh = cashDiscountFor(items)
  if (!hasCashLine) return { lineItems: [...items, fresh], changed: true }

  let changed = false
  const next = items.map(l => {
    if (!isCashDiscountLine(l) || l.amount === fresh.amount) return l
    changed = true
    return { ...l, ...fresh }
  })
  return { lineItems: next, changed }
}

// Invoice total from its line items (inc-GST; discounts/credits are negative).
export function totalFromLineItems(lineItems) {
  return Math.max(0, (lineItems || []).reduce((s, l) => s + (Number(l.amount) || 0), 0))
}

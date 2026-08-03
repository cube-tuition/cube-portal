/*
 * Cash-payment discount — families who pay in cash get 10% off.
 *
 * The 10% comes off LAST: the base is the invoice after every other reduction
 * (sibling, multi-course, referral and absence credits, manual adjustments),
 * not the gross tuition. A family already down $100 in sibling and course
 * discounts saves 10% of what is actually left to pay.
 *
 * Because the base is "everything else on the invoice", the cash line has to be
 * re-priced whenever any other line changes — adding a credit or editing an
 * enrolment moves it. Writers must put their new line array through
 * invoiceTotalsPatch (or repriceLineItems) rather than just re-summing.
 *
 * GST note (CUBE is GST-registered): prices are GST-inclusive and the invoice
 * PDF derives GST as total ÷ 11, so the discount automatically reduces the GST
 * component proportionally. The GST breakdown stays on cash invoices — payment
 * method never changes whether a supply is taxable.
 */

export const CASH_DISCOUNT_RATE = 0.10
export const CASH_DISCOUNT_REASON = 'Cash discount (10% after other discounts)'

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

// The discount line for a given base amount (inc-GST) — the invoice total
// before the cash discount. Marked with cash:true so refresh/backfill can find
// and recompute it reliably.
export function cashDiscountLine(baseAmount) {
  // `|| 0` keeps a fully-credited invoice at 0 rather than -0.
  return { type: 'discount', cash: true, reason: CASH_DISCOUNT_REASON, amount: -round2(Math.max(0, Number(baseAmount) || 0) * CASH_DISCOUNT_RATE) || 0 }
}

export function isCashDiscountLine(l) {
  return l?.type === 'discount' && (l.cash === true || /^Cash discount/i.test(l.reason || ''))
}

/*
 * A cash line staff typed an amount into. Auto-repricing leaves it alone —
 * otherwise the next credit, price change or Refresh would silently undo the
 * override, which is exactly what a hand-set figure is not for. Switching the
 * family back to bank still removes it: no cash payment, no cash discount.
 */
export function isManualCashLine(l) {
  return isCashDiscountLine(l) && l.manual === true
}

// Pin a cash line to a hand-typed amount (staff edited it in the invoice UI).
export function markCashLineManual(l) {
  return { ...l, cash: true, manual: true }
}

// Hand it back to the automatic 10%.
export function clearCashLineManual(l) {
  const next = { ...l }
  delete next.manual
  return next
}

// 10% of everything else on the invoice: the cash line is excluded from its own
// base, so this is stable no matter how many times it is re-run.
export function cashDiscountFor(lineItems) {
  const base = (lineItems || []).filter(l => !isCashDiscountLine(l))
    .reduce((s, l) => s + (Number(l.amount) || 0), 0)
  return cashDiscountLine(base)
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

  // A hand-set amount wins over the formula until staff reset it.
  if (items.some(isManualCashLine)) return { lineItems: items, changed: false }

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

/*
 * Re-price an existing cash discount after the other lines changed — adding a
 * credit, editing an enrolment, removing a discount. Keyed off whether the
 * invoice already carries a cash line, so it never grants the discount to a
 * bank-paying family; use syncCashDiscountLines for that.
 */
export function repriceLineItems(lineItems) {
  const items = lineItems || []
  return items.some(isCashDiscountLine) ? syncCashDiscountLines(items, true).lineItems : items
}

/*
 * The invoices patch for a changed set of lines: re-prices the cash discount,
 * then totals. Every writer that edits line_items should save this, so the cash
 * discount and the total can never drift apart.
 *
 * (subtotal mirrors total — the column is net of everything, historically.)
 */
export function invoiceTotalsPatch(lineItems) {
  const items = repriceLineItems(lineItems)
  const total = totalFromLineItems(items)
  return { line_items: items, subtotal: total, total }
}

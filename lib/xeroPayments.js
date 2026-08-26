/**
 * lib/xeroPayments.js — keeping "paid" in step between the portal and Xero.
 * ────────────────────────────────────────────────────────────────────────
 * Xero has no flag that means "this invoice is paid". An invoice is PAID when
 * the payments applied to it cover its total, so marking paid in the portal
 * means creating a Payment in Xero, and un-marking means deleting it again.
 *
 * Called from two places, which is why it lives here rather than in a route:
 *   • /api/update-invoice-status — the moment a staff member flips paid/unpaid
 *   • /api/xero/push             — a sweep, so an invoice that could not be
 *                                  paid at the time (still a draft in Xero,
 *                                  Xero down, payments not configured yet)
 *                                  is picked up on the next sync instead of
 *                                  being stranded.
 */
import { createXeroPayment, deleteXeroPayment } from './xero'

/**
 * Reconcile one invoice's paid state into Xero.
 *
 * `xeroInvoice` is the invoice as Xero currently has it (from
 * fetchXeroInvoicesByIds), or undefined if Xero no longer knows the id.
 * Returns a short human-readable verdict — every caller reports it rather than
 * throwing, because failing to reach Xero must never undo the portal's own
 * record of the payment.
 */
export async function syncInvoicePayment(sb, inv, { accountCode, xeroInvoice }) {
  // Cash invoices are never pushed, so they have no link and nothing to do.
  if (!inv.xero_invoice_id) return 'not in Xero'

  const isPaid = inv.payment_status === 'paid'

  if (!isPaid) {
    // Un-marking paid: reverse only the payment WE created. A payment entered
    // by hand in Xero, or one reconciled against a bank feed, is somebody
    // else's record and must not be deleted from under them.
    if (!inv.xero_payment_id) return 'nothing to reverse'
    if (!accountCode) return 'no payment account set'
    await deleteXeroPayment(inv.xero_payment_id)
    await sb.from('invoices').update({ xero_payment_id: null }).eq('id', inv.id)
    return 'payment removed in Xero'
  }

  if (!accountCode) return 'no payment account set'
  if (!xeroInvoice)  return 'no longer in Xero'

  // Xero rejects payments against a draft, and the user's Xero workflow is to
  // approve invoices there by hand — so say what is needed rather than
  // authorising an invoice on their behalf.
  if (xeroInvoice.Status === 'DRAFT' || xeroInvoice.Status === 'SUBMITTED') {
    return 'still a draft in Xero — approve it there first'
  }
  if (xeroInvoice.Status === 'VOIDED' || xeroInvoice.Status === 'DELETED') {
    return `${xeroInvoice.Status.toLowerCase()} in Xero`
  }

  // Drive off what Xero actually owes, not off our stored payment id: if that
  // payment was later deleted in Xero the invoice is owing again and should be
  // paid again, and if someone paid it by hand there is nothing left to do.
  const due = Number(xeroInvoice.AmountDue)
  if (!(due > 0)) {
    // Xero considers it settled; drop a stale id so it stops looking pending.
    if (inv.xero_payment_id && xeroInvoice.Status === 'PAID') return 'already paid in Xero'
    return 'already paid in Xero'
  }

  const paymentId = await createXeroPayment({
    invoiceId:   inv.xero_invoice_id,
    accountCode,
    amount:      due,
    date:        inv.paid_date || new Date().toISOString().slice(0, 10),
    reference:   inv.invoice_number ? `Portal ${inv.invoice_number}` : undefined,
  })
  await sb.from('invoices').update({ xero_payment_id: paymentId }).eq('id', inv.id)
  return 'marked paid in Xero'
}

/** Verdicts that mean the invoice's paid state now matches Xero. */
export const SETTLED_VERDICTS = new Set([
  'marked paid in Xero', 'already paid in Xero', 'payment removed in Xero',
])

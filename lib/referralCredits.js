import { supabase } from './supabase'
import { invoiceTotalsPatch } from './cashDiscount'

/*
 * Referral credits — one place for the "$50 to both families" rules, used by
 * the invoices page's Log-referral modal AND the trial pipeline's convert step.
 *
 * Logs the referral, then:
 *  • Referred family:  $50 off their current unpaid invoice if one exists,
 *    otherwise held (invoice_id null) for their next invoice.
 *  • Referring family: $50 off their current DRAFT invoice if one exists,
 *    otherwise held for their next invoice.
 *
 * Both land as DISCOUNT lines — a referral is revenue forgone. student_credits
 * still records them, since that is the ledger for amounts held to next term.
 */

/*
 * $50 off an invoice as its own DISCOUNT line. A referral is money we chose not
 * to charge, not money we owe back — "credit" is reserved for absences and
 * cancellations, and the two post to different accounts in Xero.
 *
 * invoiceTotalsPatch re-prices the cash discount too, so on a cash invoice the
 * 10% comes off after this reduction.
 */
async function applyToInvoice(inv, label) {
  const patch = invoiceTotalsPatch([...(inv.line_items || []), { type: 'discount', reason: label, amount: -50 }])
  await supabase.from('invoices').update(patch).eq('id', inv.id)
}

/**
 * Log a referral and apply the $50 credits to both sides.
 * Skips (returns { skipped: true }) if this referred student already has a
 * logged referral, so converting twice can't double-credit.
 * Returns { skipped, referredApplied, referringApplied } — "applied" false
 * means the credit is held for that family's next invoice.
 */
export async function logReferralWithCredits({ referringStudentId, referredStudentId, referredFirstName, referringFirstName }) {
  const { data: existing } = await supabase
    .from('referrals').select('id').eq('referred_student_id', referredStudentId).limit(1)
  if (existing?.length) return { skipped: true }

  const { error: refErr } = await supabase.from('referrals').insert({
    referring_student_id: referringStudentId, referred_student_id: referredStudentId,
  })
  if (refErr) throw new Error('Failed to log referral: ' + refErr.message)

  // Referred family: $50 off their current (unpaid, non-voided) invoice now.
  const { data: referredInv } = await supabase.from('invoices')
    .select('id, total, line_items').eq('student_id', referredStudentId)
    .not('status', 'in', '(paid,voided)')
    .order('id', { ascending: false }).limit(1).maybeSingle()
  // Both sides print in the same "Referral Discount: <detail>" shape staff get
  // from the + Add line picker, so a referral reads the same however it was
  // entered — and the detail says which family it was.
  const referredLabel = referringFirstName
    ? `Referral Discount: referred by ${referringFirstName}`
    : 'Referral Discount: welcome'
  await supabase.from('student_credits').insert({
    student_id: referredStudentId, amount: 50, reason: 'referral_referred',
    notes: referredLabel, invoice_id: referredInv?.id ?? null,
  })
  if (referredInv) await applyToInvoice(referredInv, referredLabel)

  // Referring family: draft invoice now, otherwise hold for the next one.
  const rewardLabel = referredFirstName
    ? `Referral Discount: referred ${referredFirstName}`
    : 'Referral Discount: thank you'
  const { data: referringInv } = await supabase.from('invoices')
    .select('id, total, line_items').eq('student_id', referringStudentId)
    .eq('status', 'draft')
    .order('id', { ascending: false }).limit(1).maybeSingle()
  await supabase.from('student_credits').insert({
    student_id: referringStudentId, amount: 50, reason: 'referral_referring',
    notes: rewardLabel, invoice_id: referringInv?.id ?? null,
  })
  if (referringInv) await applyToInvoice(referringInv, rewardLabel)

  return { skipped: false, referredApplied: !!referredInv, referringApplied: !!referringInv }
}

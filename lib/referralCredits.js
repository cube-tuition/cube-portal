import { supabase } from './supabase'
import { invoiceTotalsPatch } from './cashDiscount'

/*
 * Referral credits — one place for the "$50 to both families" rules, used by
 * the invoices page's Log-referral modal AND the trial pipeline's convert step.
 *
 * Logs the referral, then:
 *  • Referred family:  $50 credit; applied to their current unpaid invoice if
 *    one exists, otherwise held (invoice_id null) for their next invoice.
 *  • Referring family: $50 credit; applied to their current DRAFT invoice if
 *    one exists, otherwise held for their next invoice.
 */

// $50 off an invoice as its own credit line. invoiceTotalsPatch re-prices the
// cash discount too — on a cash invoice the 10% comes off after this credit.
async function applyToInvoice(inv, label) {
  const patch = invoiceTotalsPatch([...(inv.line_items || []), { type: 'credit', reason: label, amount: -50 }])
  await supabase.from('invoices').update(patch).eq('id', inv.id)
}

/**
 * Log a referral and apply the $50 credits to both sides.
 * Skips (returns { skipped: true }) if this referred student already has a
 * logged referral, so converting twice can't double-credit.
 * Returns { skipped, referredApplied, referringApplied } — "applied" false
 * means the credit is held for that family's next invoice.
 */
export async function logReferralWithCredits({ referringStudentId, referredStudentId, referredFirstName }) {
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
  await supabase.from('student_credits').insert({
    student_id: referredStudentId, amount: 50, reason: 'referral_referred',
    notes: 'Referral discount — welcome credit', invoice_id: referredInv?.id ?? null,
  })
  if (referredInv) await applyToInvoice(referredInv, 'Referral discount — welcome credit')

  // Referring family: draft invoice now, otherwise hold for the next one.
  const rewardLabel = referredFirstName
    ? `Referral reward — thanks for referring ${referredFirstName}!`
    : 'Referral reward — thank you!'
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

import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'
import {
  syncCashDiscountLines, totalFromLineItems,
  CASH_PAYMENT_INSTRUCTIONS, BANK_PAYMENT_INSTRUCTIONS,
} from '../../../lib/cashDiscount'

/*
 * POST /api/set-payment-method
 *
 * Body: { student_ids: string[], method: 'cash' | 'bank' }
 *
 * Sets how a family pays AND re-prices the invoices it affects.
 *
 * Writing students.payment_method alone isn't enough: a database trigger syncs
 * the flag onto their invoices, but nothing touches the money, so an invoice
 * ends up labelled "cash" while still priced — and its payment instructions
 * still worded — for bank transfer. Every path that changes the method comes
 * through here so the 10% line, the total and the instructions move with it.
 *
 * Only live, unpaid invoices are re-priced. A paid invoice is settled: the
 * discount belongs on the family's next one, not retroactively on money that
 * has already changed hands.
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { student_ids, method } = await request.json()
    if (!Array.isArray(student_ids) || !student_ids.length) {
      return Response.json({ error: 'Missing student_ids' }, { status: 400 })
    }
    if (method !== 'cash' && method !== 'bank') {
      return Response.json({ error: "method must be 'cash' or 'bank'" }, { status: 400 })
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const { error: studErr } = await sb
      .from('students').update({ payment_method: method }).in('id', student_ids)
    if (studErr) return Response.json({ error: studErr.message }, { status: 500 })

    // Invoices to re-price: the family's own, plus any solo invoice for these
    // students. family_id is read after the update so a newly linked sibling is
    // included.
    const { data: students } = await sb
      .from('students').select('id, family_id').in('id', student_ids)
    const familyIds = [...new Set((students || []).map(s => s.family_id).filter(v => v != null))]

    const { data: invoices } = await sb
      .from('invoices')
      .select('id, student_id, family_id, line_items, payment_status')
      .neq('status', 'voided')
      .neq('payment_status', 'paid')
    const affected = (invoices || []).filter(i =>
      (i.family_id != null && familyIds.includes(i.family_id)) || student_ids.includes(i.student_id))

    const repriced = []
    for (const inv of affected) {
      // Same rule the generator uses: any cash member makes the invoice cash.
      // Read it from the students actually billed, not just the ones edited.
      const billed = [...new Set((inv.line_items || [])
        .filter(l => l.type === 'enrolment').map(l => l.student_id).filter(Boolean))]
      const { data: billedStudents } = billed.length
        ? await sb.from('students').select('id, payment_method').in('id', billed)
        : { data: [] }
      const isCash = billed.length
        ? (billedStudents || []).some(s => s.payment_method === 'cash')
        : method === 'cash'

      const { lineItems, changed } = syncCashDiscountLines(inv.line_items, isCash)
      const total = totalFromLineItems(lineItems)
      const { error: upErr } = await sb.from('invoices').update({
        line_items: lineItems,
        subtotal: total,
        total,
        payment_method: isCash ? 'cash' : 'bank',
        payment_instructions: isCash ? CASH_PAYMENT_INSTRUCTIONS : BANK_PAYMENT_INSTRUCTIONS,
      }).eq('id', inv.id)
      if (upErr) return Response.json({ error: upErr.message }, { status: 500 })
      if (changed) repriced.push({ id: inv.id, total })
    }

    return Response.json({
      students: student_ids.length,
      invoices_checked: affected.length,
      repriced: repriced.length,
      details: repriced,
    })
  } catch (err) {
    console.error('[set-payment-method]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

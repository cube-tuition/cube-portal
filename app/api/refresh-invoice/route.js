import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'
import { CASH_PAYMENT_INSTRUCTIONS, BANK_PAYMENT_INSTRUCTIONS } from '../../../lib/cashDiscount'
import { planInvoiceRefresh } from '../../../lib/billing'


/**
 * POST /api/refresh-invoice
 * Body: { invoice_id }
 *
 * Makes a draft (or approved, unsynced) invoice match reality:
 *  - adds a line for any ACTIVE enrolment the family has in the invoice's term
 *    that is not on the invoice yet (e.g. a class added after generation —
 *    Generate skips families that already have an invoice, so this is the only
 *    way such an enrolment reaches the bill);
 *  - removes class lines with no live (active/trial) enrolment behind them —
 *    a dropped or deleted class, or a student who left — but never empties
 *    the invoice;
 *  - re-prices every enrolment line from the enrolments table;
 *  - recalculates the sibling and multi-course discounts when classes were
 *    added or removed, unless those lines were edited by hand (then they are
 *    kept and the response says so);
 *  - keeps every hand-added line (credits, referral/other discounts, adjustments);
 *  - re-syncs the cash discount, then subtotal and total.
 */

export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { invoice_id } = await req.json()
    if (!invoice_id) return Response.json({ error: 'Missing invoice_id' }, { status: 400 })

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // Load the invoice
    const { data: inv, error: invErr } = await sb
      .from('invoices').select('*').eq('id', invoice_id).single()
    if (invErr || !inv) return Response.json({ error: 'Invoice not found' }, { status: 404 })
    // Approved-but-not-synced invoices may be refreshed too (e.g. a family
    // flips to cash after approval); anything already in Xero or paid is locked.
    if (!['draft', 'approved'].includes(inv.status)) {
      return Response.json({ error: 'Can only refresh draft or approved invoices' }, { status: 400 })
    }
    if (inv.payment_status === 'paid') return Response.json({ error: 'Invoice already paid' }, { status: 400 })

    // Everything Refresh reads, then lib/billing works out the change.
    const { data: members, error: memErr } = !inv.term_id ? { data: [] } : inv.family_id != null
      ? await sb.from('students').select('id, full_name').eq('family_id', inv.family_id)
      : inv.student_id
        ? await sb.from('students').select('id, full_name').eq('id', inv.student_id)
        : { data: [] }
    if (memErr) return Response.json({ error: `Could not load the family: ${memErr.message}` }, { status: 500 })
    const memberIds = (members || []).map(m => m.id)

    let termEnrolments = []
    if (memberIds.length) {
      // Trial enrolments count as live (a line is never dropped mid-trial).
      const { data, error: teErr } = await sb.from('enrolments')
        .select('student_id, class_id, price, status, classes!inner(id, class_name, day_of_week, start_time, term_id, courses(course_price))')
        .in('student_id', memberIds).in('status', ['active', 'trial']).eq('classes.term_id', inv.term_id)
      if (teErr) return Response.json({ error: `Could not load enrolments: ${teErr.message}` }, { status: 500 })
      termEnrolments = data || []
    }

    // Prices and payment methods for everyone the invoice may bill: the family
    // plus anyone already on a line.
    const studentIds = [...new Set([
      ...memberIds,
      ...(inv.line_items || []).filter(l => l.type === 'enrolment' && l.student_id).map(l => l.student_id),
    ])]
    const [{ data: enrolmentRows, error: enrolErr }, { data: payers, error: payErr }] = studentIds.length
      ? await Promise.all([
          sb.from('enrolments').select('student_id, class_id, price, classes(courses(course_price))').in('student_id', studentIds),
          sb.from('students').select('id, payment_method').in('id', studentIds),
        ])
      : [{ data: [] }, { data: [] }]
    // Surface a lookup failure instead of silently reporting "nothing changed".
    if (enrolErr) return Response.json({ error: `Could not load enrolment prices: ${enrolErr.message}` }, { status: 500 })
    if (payErr) return Response.json({ error: `Could not load payment methods: ${payErr.message}` }, { status: 500 })

    const plan = planInvoiceRefresh({
      invoice: inv, memberIds,
      nameOf: Object.fromEntries((members || []).map(m => [m.id, m.full_name])),
      termEnrolments, enrolmentRows: enrolmentRows || [],
      paymentMethodOf: Object.fromEntries((payers || []).map(s => [s.id, s.payment_method])),
    })
    if (plan.noop) return Response.json({ updated: 0, message: plan.noop })

    // A kept hand-edited discount whose label names a percentage can drift
    // from that percentage when class lines change (e.g. "Director discount
    // (50%)" written against one course, still $X after a second course is
    // added). Refresh never rewrites hand lines — but it should say so.
    const enrolSum = plan.lineItems.filter(l => l.type === 'enrolment')
      .reduce((s, l) => s + (Number(l.amount) || 0), 0)
    for (const l of plan.lineItems) {
      if (l.type !== 'discount') continue
      const label = String(l.reason || l.description || '')
      const pct = label.match(/(\d{1,3}(?:\.\d+)?)\s*%/)
      if (!pct || /multi-course|sibling|cash/i.test(label)) continue
      const expected = Math.round(Number(pct[1]) * enrolSum) / 100
      const actual = Math.abs(Number(l.amount) || 0)
      if (Math.abs(expected - actual) > 1) {
        plan.notes.push(`"${label}" is $${actual} but ${pct[1]}% of the current class lines would be $${expected} — check this hand-edited discount.`)
      }
    }

    // The family already has a copy of this invoice: flag it so the list says
    // "changed since sent" until it is re-sent.
    const updatedSinceSent = inv.delivery_status === 'sent'
    const { error: updateErr } = await sb.from('invoices')
      .update({
        line_items: plan.lineItems, subtotal: plan.total, total: plan.total,
        sibling_discount: plan.siblingDiscount, multi_course_discount: plan.multiCourseDiscount,
        payment_method: plan.isCash ? 'cash' : 'bank',
        payment_instructions: plan.isCash ? CASH_PAYMENT_INSTRUCTIONS : BANK_PAYMENT_INSTRUCTIONS,
        ...(updatedSinceSent ? { updated_since_sent: true } : {}),
      })
      .eq('id', invoice_id)

    if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })

    return Response.json({
      updated: plan.updated, added: plan.added, removed: plan.removedNames, notes: plan.notes,
      total: plan.total, line_items: plan.lineItems, updated_since_sent: updatedSinceSent,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

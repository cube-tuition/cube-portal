import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'
import { syncCashDiscountLines, totalFromLineItems, CASH_PAYMENT_INSTRUCTIONS, BANK_PAYMENT_INSTRUCTIONS } from '../../../lib/cashDiscount'
import { reconcileEnrolmentLines, discountTotals } from '../../../lib/billing'


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

    let lineItems = inv.line_items || []
    const notes = []

    // ── Match the class lines to this term's enrolments (lib/billing) ──
    // Adds classes the family is enrolled in but not billed for, removes class
    // lines whose enrolment has ended, and recalculates the sibling and
    // multi-course discounts — the same rules the generator uses.
    let added = 0
    let removedNames = []
    if (inv.term_id && (inv.family_id != null || inv.student_id)) {
      const { data: members, error: memErr } = inv.family_id != null
        ? await sb.from('students').select('id, full_name').eq('family_id', inv.family_id)
        : await sb.from('students').select('id, full_name').eq('id', inv.student_id)
      if (memErr) return Response.json({ error: `Could not load the family: ${memErr.message}` }, { status: 500 })
      const memberIds = (members || []).map(m => m.id)
      if (memberIds.length) {
        // Trial enrolments count as live (a line is never dropped mid-trial).
        const { data: termEnrolments, error: teErr } = await sb.from('enrolments')
          .select('student_id, class_id, price, status, classes!inner(id, class_name, day_of_week, start_time, term_id, courses(course_price))')
          .in('student_id', memberIds).in('status', ['active', 'trial']).eq('classes.term_id', inv.term_id)
        if (teErr) return Response.json({ error: `Could not load enrolments: ${teErr.message}` }, { status: 500 })
        const r = reconcileEnrolmentLines({
          lineItems, termEnrolments, memberIds,
          nameOf: Object.fromEntries((members || []).map(m => [m.id, m.full_name])),
        })
        lineItems = r.lineItems
        added = r.added
        removedNames = r.removedNames
        notes.push(...r.notes)
      }
    }

    const enrolLines = lineItems.filter(l => l.type === 'enrolment')

    if (!enrolLines.length) return Response.json({ updated: 0, message: 'No enrolment lines to refresh' })

    // Fetch current prices from enrolments table.
    //
    // .or() takes PostgREST's filter DSL, NOT raw SQL. This used to build
    // "(student_id = '<uuid>' AND class_id = 12)", which PostgREST rejects with
    // PGRST100 ("failed to parse logic tree"). The error was never checked, so
    // the request silently returned no rows, the price map came back empty and
    // every line was left exactly as it was — Refresh reported "0 updated" and
    // re-priced nothing. Each pair must be and(field.eq.value,…).
    const pairs = enrolLines
      .filter(l => l.student_id && l.class_id != null)
      .map(l => `and(student_id.eq.${l.student_id},class_id.eq.${l.class_id})`)
    if (!pairs.length) return Response.json({ updated: 0, message: 'No enrolment lines to refresh' })
    const { data: enrolments, error: enrolErr } = await sb
      .from('enrolments')
      .select('student_id, class_id, price, classes(courses(course_price))')
      .or(pairs.join(','))
    // Surface a lookup failure instead of silently reporting "nothing changed".
    if (enrolErr) return Response.json({ error: `Could not load enrolment prices: ${enrolErr.message}` }, { status: 500 })

    // Build lookup: "studentId__classId" → price. Fall back to the class's
    // course price when the enrolment has none (matches invoice generation).
    const priceMap = {}
    for (const e of enrolments || []) {
      priceMap[`${e.student_id}__${e.class_id}`] =
        (e.price != null ? parseFloat(e.price) : parseFloat(e.classes?.courses?.course_price)) || 0
    }

    let updated = 0
    let newLineItems = lineItems.map(l => {
      if (l.type !== 'enrolment') return l
      const key = `${l.student_id}__${l.class_id}`
      const currentPrice = priceMap[key]
      if (currentPrice === undefined) return l          // enrolment not found — leave as-is
      if (currentPrice === l.unit_price) return l       // no change needed
      updated++
      return { ...l, unit_price: currentPrice, amount: currentPrice }
    })

    // ── Cash-discount sync — refresh is the "make it match reality" action ──
    // Look up the CURRENT payment method of the students on the invoice: any
    // cash-flagged student makes it a cash family. Then add, recompute, or
    // remove the 10% line so the invoice always reflects the live flag.
    const lineStudentIds = [...new Set(enrolLines.map(l => l.student_id).filter(Boolean))]
    const { data: lineStudents } = await sb
      .from('students').select('id, payment_method').in('id', lineStudentIds)
    const isCashFamily = (lineStudents || []).some(s => s.payment_method === 'cash')

    const cashSync = syncCashDiscountLines(newLineItems, isCashFamily)
    newLineItems = cashSync.lineItems
    if (cashSync.changed) updated++

    // Recalculate total = sum of all line item amounts (inc-GST, discounts already negative)
    const newTotal = totalFromLineItems(newLineItems)

    const { siblingDiscount, multiCourseDiscount } = discountTotals(newLineItems)
    const { error: updateErr } = await sb.from('invoices')
      .update({
        line_items: newLineItems, subtotal: newTotal, total: newTotal,
        sibling_discount: siblingDiscount, multi_course_discount: multiCourseDiscount,
        payment_method: isCashFamily ? 'cash' : 'bank',
        payment_instructions: isCashFamily ? CASH_PAYMENT_INSTRUCTIONS : BANK_PAYMENT_INSTRUCTIONS,
      })
      .eq('id', invoice_id)

    if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })

    return Response.json({ updated, added, removed: removedNames, notes, total: newTotal, line_items: newLineItems })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

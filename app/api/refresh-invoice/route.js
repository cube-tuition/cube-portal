import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'

/**
 * POST /api/refresh-invoice
 * Body: { invoice_id }
 *
 * Re-syncs every enrolment line item with the current price from the
 * enrolments table, then recalculates subtotal and total.
 * Only works on draft invoices — approved/synced ones are left untouched.
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
    if (inv.status !== 'draft') return Response.json({ error: 'Can only refresh draft invoices' }, { status: 400 })

    const lineItems = inv.line_items || []
    const enrolLines = lineItems.filter(l => l.type === 'enrolment')

    if (!enrolLines.length) return Response.json({ updated: 0, message: 'No enrolment lines to refresh' })

    // Fetch current prices from enrolments table
    const pairs = enrolLines.map(l => `(student_id = '${l.student_id}' AND class_id = ${l.class_id})`)
    const { data: enrolments } = await sb
      .from('enrolments')
      .select('student_id, class_id, price, classes(courses(course_price))')
      .or(pairs.join(','))

    // Build lookup: "studentId__classId" → price. Fall back to the class's
    // course price when the enrolment has none (matches invoice generation).
    const priceMap = {}
    for (const e of enrolments || []) {
      priceMap[`${e.student_id}__${e.class_id}`] =
        (e.price != null ? parseFloat(e.price) : parseFloat(e.classes?.courses?.course_price)) || 0
    }

    let updated = 0
    const newLineItems = lineItems.map(l => {
      if (l.type !== 'enrolment') return l
      const key = `${l.student_id}__${l.class_id}`
      const currentPrice = priceMap[key]
      if (currentPrice === undefined) return l          // enrolment not found — leave as-is
      if (currentPrice === l.unit_price) return l       // no change needed
      updated++
      return { ...l, unit_price: currentPrice, amount: currentPrice }
    })

    // Recalculate total = sum of all line item amounts (inc-GST, discounts already negative)
    const newTotal = Math.max(0, newLineItems.reduce((s, l) => s + (Number(l.amount) || 0), 0))

    const { error: updateErr } = await sb.from('invoices')
      .update({ line_items: newLineItems, subtotal: newTotal, total: newTotal })
      .eq('id', invoice_id)

    if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })

    return Response.json({ updated, total: newTotal, line_items: newLineItems })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

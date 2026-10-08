import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'
import { syncCashDiscountLines, totalFromLineItems, CASH_PAYMENT_INSTRUCTIONS, BANK_PAYMENT_INSTRUCTIONS } from '../../../lib/cashDiscount'

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

// Same rules as /api/generate-draft-invoices.
const siblingLines = (enrolLines) => {
  const n = new Set(enrolLines.map(l => l.student_id)).size
  return n >= 2 ? [{ type: 'discount', reason: `Sibling discount (${n} students)`, amount: -(n * 50) }] : []
}
const multiCourseLines = (enrolLines) => {
  const byStudent = {}
  for (const l of enrolLines) (byStudent[l.student_id] ||= { n: 0, name: l.student_name }).n++
  return Object.values(byStudent).filter(s => s.n >= 2).map(s => ({
    type: 'discount',
    reason: `Multi-course discount (${String(s.name || 'student').split(' ')[0]}, ${s.n} courses)`,
    amount: -(s.n * 50),
  }))
}
const isSiblingLine = (l) => l.type === 'discount' && /^Sibling discount/i.test(l.reason || '')
const isMultiLine = (l) => l.type === 'discount' && /^Multi-course discount/i.test(l.reason || '')
const sameLines = (a, b) => a.length === b.length
  && a.every((x, i) => x.reason === b[i].reason && Number(x.amount) === Number(b[i].amount))

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

    // ── Match the class lines to this term's enrolments ──
    // Adds classes the family is enrolled in but not billed for, and removes
    // class lines whose enrolment has ended. Lines added by hand (credits,
    // referral and other discounts, adjustments) are never touched.
    let added = 0
    const removedNames = []
    if (inv.term_id && (inv.family_id != null || inv.student_id)) {
      const { data: members, error: memErr } = inv.family_id != null
        ? await sb.from('students').select('id, full_name').eq('family_id', inv.family_id)
        : await sb.from('students').select('id, full_name').eq('id', inv.student_id)
      if (memErr) return Response.json({ error: `Could not load the family: ${memErr.message}` }, { status: 500 })
      const memberIds = (members || []).map(m => m.id)
      const nameOf = Object.fromEntries((members || []).map(m => [m.id, m.full_name]))
      if (memberIds.length) {
        // Trial enrolments count as live (as the invoice page treats them) so a
        // line is never dropped mid-trial — but only active ones are added,
        // as the generator does.
        const { data: termEnrols, error: teErr } = await sb.from('enrolments')
          .select('student_id, class_id, price, status, classes!inner(id, class_name, day_of_week, start_time, term_id, courses(course_price))')
          .in('student_id', memberIds).in('status', ['active', 'trial']).eq('classes.term_id', inv.term_id)
        if (teErr) return Response.json({ error: `Could not load enrolments: ${teErr.message}` }, { status: 500 })
        const pairKey = (sid, cid) => `${sid}__${cid}`
        const live = new Set((termEnrols || []).map(e => pairKey(e.student_id, e.class_id)))
        const oldEnrolLines = lineItems.filter(l => l.type === 'enrolment')
        const onInvoice = new Set(oldEnrolLines.map(l => pairKey(l.student_id, l.class_id)))

        // Lines to drop: a class line for a family member with no live
        // enrolment behind it (dropped class, deleted class, student left).
        // Lines without a class, or for someone outside the family, are left.
        const memberSet = new Set(memberIds)
        const isDead = (l) => l.type === 'enrolment' && l.class_id != null
          && memberSet.has(l.student_id) && !live.has(pairKey(l.student_id, l.class_id))

        const newLines = []
        for (const e of termEnrols || []) {
          if (e.status !== 'active' || onInvoice.has(pairKey(e.student_id, e.class_id))) continue
          const cls = e.classes
          const fee = (e.price != null ? parseFloat(e.price) : parseFloat(cls?.courses?.course_price)) || 0
          newLines.push({
            student_id: e.student_id, student_name: nameOf[e.student_id] || '—',
            class_id: e.class_id, class_name: cls?.class_name || '—',
            day: cls?.day_of_week || '', start_time: cls?.start_time || '',
            unit_price: fee, quantity: 1, amount: fee, type: 'enrolment',
          })
        }

        let dead = oldEnrolLines.filter(isDead)
        // Never empty an invoice: with nothing live left it should be voided,
        // which is a decision for a person, not for Refresh.
        if (dead.length && dead.length === oldEnrolLines.length && !newLines.length) {
          notes.push('None of the classes on this invoice are current enrolments any more — void it if the family has left.')
          dead = []
        }

        if (newLines.length || dead.length) {
          added = newLines.length
          for (const l of dead) removedNames.push(`${String(l.student_name || 'student').split(' ')[0]} – ${l.class_name || `class #${l.class_id}`}`)
          const deadSet = new Set(dead)
          lineItems = lineItems.filter(l => !deadSet.has(l))
          // Enrolment lines stay together at the top, as the generator writes them.
          const lastEnrol = lineItems.map(l => l.type).lastIndexOf('enrolment')
          lineItems = [...lineItems.slice(0, lastEnrol + 1), ...newLines, ...lineItems.slice(lastEnrol + 1)]
          const allEnrol = lineItems.filter(l => l.type === 'enrolment')

          // Discounts follow the enrolments — but only replace lines that still
          // hold what the generator would have written (not hand-edited ones).
          // A line that is new goes where the generator puts it: enrolments,
          // then sibling, then multi-course (`after` says which lines precede it).
          const swap = (isLine, oldExpected, next, label, after) => {
            const current = lineItems.filter(isLine)
            if (!sameLines(current, oldExpected)) {
              if (!sameLines(current, next)) notes.push(`${label} was edited by hand, so it was left as is — check it.`)
              return
            }
            const at = lineItems.findIndex(isLine)
            const rest = lineItems.filter(l => !isLine(l))
            const insertAt = at >= 0 ? at : rest.map(after).lastIndexOf(true) + 1
            lineItems = [...rest.slice(0, insertAt), ...next, ...rest.slice(insertAt)]
          }
          const isEnrol = (l) => l.type === 'enrolment'
          swap(isSiblingLine, siblingLines(oldEnrolLines), siblingLines(allEnrol), 'The sibling discount', isEnrol)
          swap(isMultiLine, multiCourseLines(oldEnrolLines), multiCourseLines(allEnrol), 'The multi-course discount',
            (l) => isEnrol(l) || isSiblingLine(l))
        }
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

    const sumOf = (pred) => -newLineItems.filter(pred).reduce((s, l) => s + (Number(l.amount) || 0), 0)
    const { error: updateErr } = await sb.from('invoices')
      .update({
        line_items: newLineItems, subtotal: newTotal, total: newTotal,
        sibling_discount: sumOf(isSiblingLine), multi_course_discount: sumOf(isMultiLine),
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

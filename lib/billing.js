/*
 * Invoice money rules — the ONE definition of how an invoice's lines are built.
 *
 * Pure functions: no database, no network. /api/generate-draft-invoices builds
 * a new invoice with buildInvoiceLines; /api/refresh-invoice brings an existing
 * one back in line with the timetable with reconcileEnrolmentLines. Before
 * this file each route carried its own copy of the sibling / multi-course
 * rules, free to drift apart. tests/billing.test.mjs pins the behaviour.
 *
 * Amounts are inc-GST dollars; discounts and credits are negative lines.
 * Line order on a generated invoice: enrolments, sibling discount,
 * multi-course discount(s), held credits, then the cash discount LAST (its
 * base is everything above it — see lib/cashDiscount).
 */
import { cashDiscountFor } from './cashDiscount.js'

export const SIBLING_DISCOUNT_PER_STUDENT = 50
export const MULTI_COURSE_DISCOUNT_PER_COURSE = 50

// The enrolment's own price; the class's course price when it has none (never
// a $0 line just because the enrolment price was left blank).
export function enrolmentFee(price, coursePrice) {
  return (price != null ? parseFloat(price) : parseFloat(coursePrice)) || 0
}

// One class line on an invoice. Key order matches what has always been stored.
export function enrolmentLine({ studentId, studentName, classId, cls, fee }) {
  return {
    student_id:   studentId,
    student_name: studentName || '—',
    class_id:     classId,
    class_name:   cls?.class_name || '—',
    day:          cls?.day_of_week || '',
    start_time:   cls?.start_time || '',
    unit_price:   fee,
    quantity:     1,
    amount:       fee,
    type:         'enrolment',
  }
}

const firstName = (name) => {
  const f = String(name || '').trim().split(' ')[0]
  return f && f !== '—' ? f : 'student'
}

// Sibling discount: two or more different students on the invoice → $50 each.
export function siblingDiscountLines(enrolLines) {
  const n = new Set((enrolLines || []).map(l => l.student_id)).size
  return n >= 2
    ? [{ type: 'discount', reason: `Sibling discount (${n} students)`, amount: -(n * SIBLING_DISCOUNT_PER_STUDENT) }]
    : []
}

// Multi-course discount: a student in two or more classes → $50 per class,
// one line per such student, in the order the students first appear.
export function multiCourseDiscountLines(enrolLines) {
  const byStudent = new Map()
  for (const l of enrolLines || []) {
    const s = byStudent.get(l.student_id) || { n: 0, name: l.student_name }
    s.n++
    byStudent.set(l.student_id, s)
  }
  return [...byStudent.values()].filter(s => s.n >= 2).map(s => ({
    type: 'discount',
    reason: `Multi-course discount (${firstName(s.name)}, ${s.n} courses)`,
    amount: -(s.n * MULTI_COURSE_DISCOUNT_PER_COURSE),
  }))
}

export const isSiblingLine = (l) => l?.type === 'discount' && /^Sibling discount/i.test(l.reason || '')
export const isMultiCourseLine = (l) => l?.type === 'discount' && /^Multi-course discount/i.test(l.reason || '')

/*
 * A held credit (student_credits row) as an invoice line. A referral is revenue
 * forgone, so it lands as a DISCOUNT line; absence and cancellation credits are
 * money owed back and stay CREDIT lines — the two post to different Xero
 * accounts. `reason` is a machine key for some sources ('referral_referred',
 * 'missed_lesson'); `notes` carries the human wording when there is any.
 */
export function creditLine(credit) {
  const amt = parseFloat(credit.amount) || 0
  const isReferral = /^referral/i.test(credit.reason || '')
  const label = (credit.notes || '').trim()
    || (isReferral ? 'Referral discount' : String(credit.reason || 'Credit').replace(/_/g, ' '))
  return { type: isReferral ? 'discount' : 'credit', reason: label, amount: -amt }
}

/*
 * Every line of a NEW invoice for one family (or one unlinked student).
 *
 *   enrolments   [{ student_id, class_id, price }] — the family's active
 *                enrolments this term, in display order
 *   classMap     { class_id → { class_name, day_of_week, start_time, courses: { course_price } } }
 *   studentMap   { student_id → { full_name } }
 *   credits      { student_id → [held credit rows] } (unapplied ones)
 *   cash         the family pays in cash → the 10% line goes on last
 *
 * Returns the lines plus the discount totals and the credit ids the invoice
 * now uses (the caller links them so they can never be applied twice).
 */
export function buildInvoiceLines({ enrolments, classMap = {}, studentMap = {}, credits = {}, cash = false }) {
  const enrolLines = (enrolments || []).map(e => enrolmentLine({
    studentId: e.student_id,
    studentName: studentMap[e.student_id]?.full_name,
    classId: e.class_id,
    cls: classMap[e.class_id],
    fee: enrolmentFee(e.price, classMap[e.class_id]?.courses?.course_price),
  }))
  const sibling = siblingDiscountLines(enrolLines)
  const multi = multiCourseDiscountLines(enrolLines)

  const creditLines = []
  const appliedCreditIds = []
  for (const sid of new Set((enrolments || []).map(e => e.student_id))) {
    for (const c of credits[sid] || []) {
      creditLines.push(creditLine(c))
      if (c.id) appliedCreditIds.push(c.id)
    }
  }

  const lineItems = [...enrolLines, ...sibling, ...multi, ...creditLines]
  if (cash) lineItems.push(cashDiscountFor(lineItems))

  const sum = (ls) => -ls.reduce((s, l) => s + l.amount, 0) || 0
  return { lineItems, siblingDiscount: sum(sibling), multiCourseDiscount: sum(multi), appliedCreditIds }
}

const sameLines = (a, b) => a.length === b.length
  && a.every((x, i) => x.reason === b[i].reason && Number(x.amount) === Number(b[i].amount))

/*
 * Bring an EXISTING invoice's class lines in line with this term's enrolments
 * (the Refresh action):
 *   • adds a line for each ACTIVE enrolment not on the invoice yet (a class
 *     added after generation — Generate skips families that already have one);
 *   • removes class lines with no live (active/trial) enrolment behind them —
 *     a dropped or deleted class, or a student who left — but never empties
 *     the invoice;
 *   • when classes were added or removed, recalculates the sibling and
 *     multi-course discounts, unless those lines were edited by hand (they are
 *     then kept and a note says so).
 * Lines added by hand (credits, referral/other discounts, adjustments) are
 * never touched. Prices of existing lines are NOT changed here.
 *
 *   lineItems       the invoice's current line items
 *   termEnrolments  [{ student_id, class_id, price, status, classes: { class_name, day_of_week, start_time, courses: { course_price } } }]
 *                   — the family's active + trial enrolments in the invoice's term
 *   memberIds       the family's student ids (lines for anyone else are left alone)
 *   nameOf          { student_id → full name }
 */
export function reconcileEnrolmentLines({ lineItems, termEnrolments, memberIds, nameOf = {} }) {
  let items = lineItems || []
  const notes = []
  const removedNames = []
  const pairKey = (sid, cid) => `${sid}__${cid}`
  const live = new Set((termEnrolments || []).map(e => pairKey(e.student_id, e.class_id)))
  const oldEnrolLines = items.filter(l => l.type === 'enrolment')
  const onInvoice = new Set(oldEnrolLines.map(l => pairKey(l.student_id, l.class_id)))

  // Lines to drop: a class line for a family member with no live enrolment
  // behind it. Lines without a class, or for someone outside the family, stay.
  const memberSet = new Set(memberIds || [])
  const isDead = (l) => l.type === 'enrolment' && l.class_id != null
    && memberSet.has(l.student_id) && !live.has(pairKey(l.student_id, l.class_id))

  // Trial enrolments count as live (a line is never dropped mid-trial), but
  // only active ones are added, as the generator does.
  const newLines = []
  for (const e of termEnrolments || []) {
    if (e.status !== 'active' || onInvoice.has(pairKey(e.student_id, e.class_id))) continue
    newLines.push(enrolmentLine({
      studentId: e.student_id, studentName: nameOf[e.student_id], classId: e.class_id,
      cls: e.classes, fee: enrolmentFee(e.price, e.classes?.courses?.course_price),
    }))
  }

  let dead = oldEnrolLines.filter(isDead)
  // Never empty an invoice: with nothing live left it should be voided, which
  // is a decision for a person, not for Refresh.
  if (dead.length && dead.length === oldEnrolLines.length && !newLines.length) {
    notes.push('None of the classes on this invoice are current enrolments any more — void it if the family has left.')
    dead = []
  }

  if (newLines.length || dead.length) {
    for (const l of dead) removedNames.push(`${String(l.student_name || 'student').split(' ')[0]} – ${l.class_name || `class #${l.class_id}`}`)
    const deadSet = new Set(dead)
    items = items.filter(l => !deadSet.has(l))
    // Class lines stay together at the top, as the generator writes them.
    const lastEnrol = items.map(l => l.type).lastIndexOf('enrolment')
    items = [...items.slice(0, lastEnrol + 1), ...newLines, ...items.slice(lastEnrol + 1)]
    const allEnrol = items.filter(l => l.type === 'enrolment')

    // Discounts follow the classes — but only replace lines that still hold
    // what the generator would have written. A line that is new goes where the
    // generator puts it: classes, then sibling, then multi-course (`after`
    // says which lines precede it).
    const swap = (isLine, oldExpected, next, label, after) => {
      const current = items.filter(isLine)
      if (!sameLines(current, oldExpected)) {
        if (!sameLines(current, next)) notes.push(`${label} was edited by hand, so it was left as is — check it.`)
        return
      }
      const at = items.findIndex(isLine)
      const rest = items.filter(l => !isLine(l))
      const insertAt = at >= 0 ? at : rest.map(after).lastIndexOf(true) + 1
      items = [...rest.slice(0, insertAt), ...next, ...rest.slice(insertAt)]
    }
    const isEnrol = (l) => l.type === 'enrolment'
    swap(isSiblingLine, siblingDiscountLines(oldEnrolLines), siblingDiscountLines(allEnrol), 'The sibling discount', isEnrol)
    swap(isMultiCourseLine, multiCourseDiscountLines(oldEnrolLines), multiCourseDiscountLines(allEnrol), 'The multi-course discount',
      (l) => isEnrol(l) || isSiblingLine(l))
  }

  return { lineItems: items, added: newLines.length, removedNames, notes }
}

// Discount totals for the invoice's sibling_discount / multi_course_discount columns.
export function discountTotals(lineItems) {
  const sumOf = (pred) => -(lineItems || []).filter(pred).reduce((s, l) => s + (Number(l.amount) || 0), 0) || 0
  return { siblingDiscount: sumOf(isSiblingLine), multiCourseDiscount: sumOf(isMultiCourseLine) }
}

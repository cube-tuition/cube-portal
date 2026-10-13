/*
 * Draft invoices follow enrolment changes.
 *
 * Every enrolment change queues the (student, class) pair it touched
 * (migrations/20261013_invoice_sync_queue.sql). syncQueuedInvoices — run when
 * the invoices page opens, and by the daily cron — brings each affected DRAFT
 * invoice in line with the shared billing rules (lib/billing), touching only
 * the lines of the enrolments that changed: a class added after generation is
 * billed, a dropped class comes off, a new price flows through, and the
 * discounts, cash discount and total follow. A price or removal staff made by
 * hand on another line is never undone.
 *
 * Approved invoices are never changed here — they may already be with the
 * family; the invoices page flags them as out of step instead.
 */
import { planInvoiceRefresh, describeRefresh, pairKey } from './billing.js'
import { loadRefreshInputs } from './invoiceDrift.js'
import { CASH_PAYMENT_INSTRUCTIONS, BANK_PAYMENT_INSTRUCTIONS } from './cashDiscount.js'

/*
 * Which queued enrolments belong to which draft invoice: the family's (or the
 * solo student's) draft for the class's term, and any draft already billing
 * that exact class. Returns Map(invoiceId → Set of pairKey()s).
 */
export function pairsByInvoice({ queue, drafts, familyOf = {}, termOf = {} }) {
  const out = new Map()
  for (const q of queue) {
    const key = pairKey(q.student_id, q.class_id)
    const term = termOf[q.class_id]
    const fam = familyOf[q.student_id]
    for (const inv of drafts) {
      const owns = term && inv.term_id === term && (fam != null
        ? inv.family_id === fam
        : inv.family_id == null && inv.student_id === q.student_id)
      const bills = (inv.line_items || []).some(l => l.type === 'enrolment' && pairKey(l.student_id, l.class_id) === key)
      if (!owns && !bills) continue
      if (!out.has(inv.id)) out.set(inv.id, new Set())
      out.get(inv.id).add(key)
    }
  }
  return out
}

// The invoice columns a plan sets — or null when it changes nothing.
export function syncPatch(inv, plan) {
  if (!plan || plan.noop) return null
  const patch = {
    line_items: plan.lineItems, subtotal: plan.total, total: plan.total,
    sibling_discount: plan.siblingDiscount, multi_course_discount: plan.multiCourseDiscount,
    payment_method: plan.isCash ? 'cash' : 'bank',
    payment_instructions: plan.isCash ? CASH_PAYMENT_INSTRUCTIONS : BANK_PAYMENT_INSTRUCTIONS,
  }
  const same = JSON.stringify(inv.line_items || []) === JSON.stringify(patch.line_items)
    && Number(inv.total) === patch.total && Number(inv.subtotal) === patch.subtotal
    && Number(inv.sibling_discount || 0) === patch.sibling_discount
    && Number(inv.multi_course_discount || 0) === patch.multi_course_discount
    && (inv.payment_method || 'bank') === patch.payment_method
  return same ? null : patch
}

/*
 * Work through the queue. `sb` must be a service-role client (the queue is
 * closed to everyone else). Returns { processed, updated: [{ id, invoice_number, changes }] }.
 */
export async function syncQueuedInvoices(sb, { batch = 500 } = {}) {
  const result = { processed: 0, updated: [] }
  for (;;) {
    // Claim a batch: delete … returning hands each row to exactly one run,
    // even if two run at once.
    const { data: head, error: headErr } = await sb.from('invoice_sync_queue').select('id').order('id').limit(batch)
    if (headErr) throw headErr
    if (!head?.length) return result
    const { data: claimed, error: claimErr } = await sb.from('invoice_sync_queue')
      .delete().in('id', head.map(r => r.id)).select('student_id, class_id')
    if (claimErr) throw claimErr
    if (!claimed?.length) continue
    try {
      result.updated.push(...await syncPairs(sb, claimed))
      result.processed += claimed.length
    } catch (e) {
      // Put the work back for the next run rather than lose it.
      await sb.from('invoice_sync_queue').insert(claimed.map(({ student_id, class_id }) => ({ student_id, class_id })))
      throw e
    }
    if (head.length < batch) return result
  }
}

async function syncPairs(sb, queue) {
  const studentIds = [...new Set(queue.map(q => q.student_id))]
  const classIds = [...new Set(queue.map(q => q.class_id))]
  const [{ data: studs, error: sErr }, { data: classes, error: cErr }] = await Promise.all([
    sb.from('students').select('id, family_id').in('id', studentIds),
    sb.from('classes').select('id, term_id').in('id', classIds),
  ])
  if (sErr) throw sErr
  if (cErr) throw cErr
  const familyOf = Object.fromEntries((studs || []).map(s => [s.id, s.family_id]))
  const termOf = Object.fromEntries((classes || []).map(c => [c.id, c.term_id]))
  const termIds = [...new Set(Object.values(termOf).filter(Boolean))]
  if (!termIds.length) return []

  // Drafts that could hold these enrolments: the families' and the students' own.
  const familyIds = [...new Set(Object.values(familyOf).filter(v => v != null))]
  const drafts = new Map()
  const add = (rows) => { for (const r of rows || []) drafts.set(r.id, r) }
  const base = () => sb.from('invoices').select('*').eq('status', 'draft').in('term_id', termIds)
  if (familyIds.length) {
    const { data, error } = await base().in('family_id', familyIds)
    if (error) throw error
    add(data)
  }
  const { data: solo, error: soloErr } = await base().in('student_id', studentIds)
  if (soloErr) throw soloErr
  add(solo)
  const draftList = [...drafts.values()].filter(i => i.payment_status !== 'paid')

  const scope = pairsByInvoice({ queue, drafts: draftList, familyOf, termOf })
  const updated = []
  for (const termId of termIds) {
    const invs = draftList.filter(i => i.term_id === termId && scope.has(i.id))
    if (!invs.length) continue
    const inputsFor = await loadRefreshInputs(sb, termId, invs)
    for (const inv of invs) {
      const plan = planInvoiceRefresh({ ...inputsFor(inv), onlyPairs: scope.get(inv.id) })
      const patch = syncPatch(inv, plan)
      if (!patch) continue
      // Only while it is still a draft: never race an approval.
      const { data, error } = await sb.from('invoices').update(patch).eq('id', inv.id).eq('status', 'draft').select('id')
      if (error) throw error
      if (data?.length) updated.push({ id: inv.id, invoice_number: inv.invoice_number, changes: describeRefresh(inv, plan, { done: true }) })
    }
  }
  return updated
}

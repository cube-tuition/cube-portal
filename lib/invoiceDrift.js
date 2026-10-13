/*
 * Is each invoice still in step with the enrolments behind it?
 *
 * Runs Refresh as a dry run (lib/billing planInvoiceRefresh) for many
 * invoices at once, with a few batched queries instead of several per
 * invoice. Works with any Supabase client: the invoices page uses the
 * signed-in staff client; the server sync uses the service role.
 */
import { planInvoiceRefresh, describeRefresh } from './billing.js'

// Refresh can only touch these (the route refuses the rest): drafts and
// approved invoices not yet in Xero, and never a paid one.
export const isRefreshable = (inv) =>
  ['draft', 'approved'].includes(inv.status) && inv.payment_status !== 'paid'

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

// Every row of a query, past PostgREST's 1000-row page.
async function all(makeQuery) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

/*
 * The inputs planInvoiceRefresh needs, for a set of invoices in one term.
 * Returns a function: invoice → plan inputs.
 */
export async function loadRefreshInputs(sb, termId, invoices) {
  const familyIds = [...new Set(invoices.map(i => i.family_id).filter(v => v != null))]
  const soloIds = [...new Set(invoices.filter(i => i.family_id == null && i.student_id).map(i => i.student_id))]
  const lineIds = invoices.flatMap(i => (i.line_items || []).filter(l => l.type === 'enrolment' && l.student_id).map(l => l.student_id))

  const students = []
  for (const ids of chunk(familyIds, 100)) {
    students.push(...await all(() => sb.from('students').select('id, full_name, family_id, payment_method').in('family_id', ids).order('id')))
  }
  const known = new Set(students.map(s => s.id))
  const others = [...new Set([...soloIds, ...lineIds])].filter(id => !known.has(id))
  for (const ids of chunk(others, 100)) {
    students.push(...await all(() => sb.from('students').select('id, full_name, family_id, payment_method').in('id', ids).order('id')))
  }
  const studentById = Object.fromEntries(students.map(s => [s.id, s]))
  const allIds = Object.keys(studentById)

  const termEnrolments = [], enrolmentRows = []
  for (const ids of chunk(allIds, 100)) {
    termEnrolments.push(...await all(() => sb.from('enrolments')
      .select('student_id, class_id, price, status, classes!inner(id, class_name, day_of_week, start_time, term_id, courses(course_price))')
      .in('student_id', ids).in('status', ['active', 'trial']).eq('classes.term_id', termId).order('id')))
    enrolmentRows.push(...await all(() => sb.from('enrolments')
      .select('student_id, class_id, price, classes(courses(course_price))').in('student_id', ids).order('id')))
  }

  return (inv) => {
    const members = inv.family_id != null
      ? students.filter(s => s.family_id === inv.family_id)
      : (inv.student_id && studentById[inv.student_id] ? [studentById[inv.student_id]] : [])
    const memberIds = inv.term_id === termId ? members.map(m => m.id) : []
    const memberSet = new Set(memberIds)
    const onInvoice = new Set([...memberIds, ...(inv.line_items || []).map(l => l.student_id).filter(Boolean)])
    return {
      invoice: inv,
      memberIds,
      nameOf: Object.fromEntries(members.map(m => [m.id, m.full_name])),
      termEnrolments: termEnrolments.filter(e => memberSet.has(e.student_id)),
      enrolmentRows: enrolmentRows.filter(e => onInvoice.has(e.student_id)),
      paymentMethodOf: Object.fromEntries([...onInvoice].map(id => [id, studentById[id]?.payment_method])),
    }
  }
}

/*
 * { [invoiceId]: [what is out of step, in words] } for the refreshable
 * invoices among `invoices` (all in term `termId`); in-step ones are omitted.
 */
export async function loadInvoiceDrift(sb, termId, invoices) {
  const targets = invoices.filter(i => isRefreshable(i) && (i.line_items || []).length)
  if (!targets.length) return {}
  const inputsFor = await loadRefreshInputs(sb, termId, targets)
  const out = {}
  for (const inv of targets) {
    const changes = describeRefresh(inv, planInvoiceRefresh(inputsFor(inv)))
    if (changes.length) out[inv.id] = changes
  }
  return out
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { upsertXeroContacts, createXeroInvoicesBatch, fetchXeroInvoicesByIds } from '../../../../lib/xero'
import { syncInvoicePayment } from '../../../../lib/xeroPayments'
import { isOneToOneClass } from '../../../../lib/classFormat'

// 2 Xero API calls total (batch contacts + batch invoices) — fast and safe
export const maxDuration = 60

/*
 * Sweep the whole term's paid flags into Xero.
 *
 * Runs on every sync, not just for invoices pushed in this run: an invoice
 * marked paid while it was still a draft in Xero — or while Xero was
 * unreachable — would otherwise stay owing there forever, since marking an
 * already-paid invoice paid again is a no-op that never fires the hook on
 * /api/update-invoice-status.
 *
 * Returns { applied, reversed, pending: [{ invoice_number, reason }] }.
 */
async function reconcilePayments(supabase, termId) {
  const { data: settings } = await supabase.from('xero_settings')
    .select('payment_account_code').eq('id', 1).maybeSingle()
  const accountCode = settings?.payment_account_code || null

  // Anything linked to Xero that is either paid here (and may need a payment)
  // or carries a payment we created (and may need it reversed).
  const { data: rows } = await supabase.from('invoices')
    .select('id, invoice_number, payment_status, paid_date, xero_invoice_id, xero_payment_id')
    .eq('term_id', termId)
    .not('xero_invoice_id', 'is', null)
    .or('payment_status.eq.paid,xero_payment_id.not.is.null')

  const candidates = rows || []
  if (!candidates.length) return { applied: 0, reversed: 0, pending: [] }
  if (!accountCode) {
    return { applied: 0, reversed: 0, pending: [{ invoice_number: null, reason: 'no payment account set — choose a bank account under Account mapping' }] }
  }

  // One bulk read of Xero's current view, so a term of invoices costs a couple
  // of calls rather than one per invoice.
  let xeroById = new Map()
  try {
    xeroById = await fetchXeroInvoicesByIds(candidates.map(i => i.xero_invoice_id))
  } catch (err) {
    return { applied: 0, reversed: 0, pending: [{ invoice_number: null, reason: `could not read invoices from Xero: ${err.message}` }] }
  }

  let applied = 0, reversed = 0
  const pending = []
  for (const inv of candidates) {
    let verdict
    try {
      verdict = await syncInvoicePayment(supabase, inv, {
        accountCode, xeroInvoice: xeroById.get(inv.xero_invoice_id),
      })
    } catch (err) { verdict = `failed: ${err.message}` }

    if (verdict === 'marked paid in Xero')        applied++
    else if (verdict === 'payment removed in Xero') reversed++
    // "already paid" and "nothing to reverse" are the steady state, not news.
    else if (verdict && !['already paid in Xero', 'nothing to reverse', 'not in Xero'].includes(verdict)) {
      pending.push({ invoice_number: inv.invoice_number, reason: verdict })
    }
  }
  return { applied, reversed, pending }
}

/**
 * POST /api/xero/push
 * Body: { term_id, reset_ids?: number[] }
 *
 * Pushes approved portal invoices to Xero using the same line items,
 * amounts, and invoice number as the portal PDF — no discrepancy.
 */
export async function POST(req) {
  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.replace('Bearer ', '')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.app_metadata?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { term_id, reset_ids } = await req.json()
  if (!term_id) return NextResponse.json({ error: 'term_id required' }, { status: 400 })

  if (reset_ids?.length) {
    // Back to 'approved' as well as clearing the Xero ids — the invoice is no
    // longer synced, and only approved invoices are eligible to push, so
    // leaving it 'synced_to_xero' would make a reset invoice unpushable.
    //
    // Scoped to status = 'synced_to_xero' on purpose: an unfiltered update would
    // also flip VOIDED invoices to approved, and the lines below would then push
    // those cancelled bills straight into Xero. See /api/xero/reset, which does
    // the same job for a whole term.
    await supabase.from('invoices').update({
      xero_invoice_id: null,
      xero_contact_id: null,
      xero_pushed_at:  null,
      status:          'approved',
    }).in('id', reset_ids).eq('status', 'synced_to_xero')
  }

  // Candidates: not yet in Xero, with line_items (new format), and never
  // voided. Drafts are fetched only so the count can be reported back.
  const { data: allInvoices, error: invErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('term_id', term_id)
    .is('xero_invoice_id', null)
    .in('status', ['draft', 'approved'])
    .not('line_items', 'is', null)
    .order('id')
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })

  // The query above only sees invoices still eligible to push, so on its own a
  // small "pushed" number looks like a failure — the term's other invoices have
  // simply already gone, or been voided. Count them so the result can say so.
  const [{ count: alreadyInXero }, { count: voidedSkipped }] = await Promise.all([
    supabase.from('invoices').select('id', { count: 'exact', head: true })
      .eq('term_id', term_id).not('xero_invoice_id', 'is', null),
    supabase.from('invoices').select('id', { count: 'exact', head: true })
      .eq('term_id', term_id).eq('status', 'voided').is('xero_invoice_id', null),
  ])
  const termCounts = {
    already_in_xero: alreadyInXero || 0,
    voided_skipped:  voidedSkipped || 0,
  }

  // A draft is still being worked on — approving it is the moment it becomes
  // the family's real bill, so that is the moment it may go to Xero.
  const draftSkipped = (allInvoices || []).filter(i => i.status !== 'approved')
  // Cash invoices never go to Xero — that money is tracked in the portal's cash
  // log instead. Filtered here rather than in the query so nulls (legacy rows,
  // which mean bank) still push, and so the count can be reported back.
  const approved    = (allInvoices || []).filter(i => i.status === 'approved')
  const cashSkipped = approved.filter(i => i.payment_method === 'cash')
  const invoices    = approved.filter(i => i.payment_method !== 'cash')
  if (!invoices.length) {
    const why = [
      cashSkipped.length  ? `${cashSkipped.length} cash invoice${cashSkipped.length === 1 ? '' : 's'} excluded` : null,
      draftSkipped.length ? `${draftSkipped.length} still in draft` : null,
    ].filter(Boolean).join(', ')
    return NextResponse.json({
      pushed: 0, cash_skipped: cashSkipped.length, draft_skipped: draftSkipped.length,
      ...termCounts, no_line_items: 0, errors: [],
      payments: await reconcilePayments(supabase, term_id),
      message: why ? `No new invoices to push — ${why}.` : 'No new invoices to push',
    })
  }

  // ── Load Xero settings + per-course item mappings ────────────────────────────
  const [{ data: xeroSettings }, { data: itemMappings }] = await Promise.all([
    supabase.from('xero_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('xero_item_mappings').select('class_name, item_code'),
  ])
  // Map class_name → Xero item_code for O(1) lookup during line-item building
  const itemCodeByClass = Object.fromEntries(
    (itemMappings || [])
      .filter(m => m.item_code)
      .map(m => [m.class_name, m.item_code])
  )

  // ── 1:1 vs group class, for the split tuition fallback accounts ─────────────
  // CUBE keeps separate revenue accounts in Xero for classes and 1:1s. The
  // signal is courses.delivery_mode via the class, with the class name as the
  // fallback — the same rule the forecast uses (lib/classFormat).
  const [{ data: classRows }, { data: courseRows }] = await Promise.all([
    supabase.from('classes').select('id, class_name, course_id'),
    supabase.from('courses').select('id, delivery_mode'),
  ])
  const deliveryModeByCourse = Object.fromEntries((courseRows || []).map(c => [c.id, c.delivery_mode]))
  const classById = Object.fromEntries((classRows || []).map(c => [c.id, c]))
  // Classes are per-term rows, so a name can appear more than once; 1:1-ness is
  // a property of the course, so any row of that name answers the question.
  const classByName = {}
  for (const c of classRows || []) if (!classByName[c.class_name]) classByName[c.class_name] = c
  const isOneToOneLine = (l) => {
    const cls = classById[l.class_id] || classByName[l.class_name] || { class_name: l.class_name }
    return isOneToOneClass(cls, deliveryModeByCourse)
  }

  // ── Step 1: collect all student IDs to fetch guardians in one query ──────────
  const allStudentIds = [...new Set(invoices.flatMap(inv =>
    (inv.line_items || [])
      .filter(l => l.type === 'enrolment')
      .map(l => l.student_id)
      .filter(Boolean)
  ))]

  const { data: guardians } = allStudentIds.length
    ? await supabase.from('guardians').select('student_id, full_name, email, phone').in('student_id', allStudentIds)
    : { data: [] }
  const guardianMap = Object.fromEntries((guardians || []).map(g => [g.student_id, g]))

  // ── Step 2: build invoice payloads from stored line_items ────────────────────
  const built    = []
  const noLines  = []

  for (const inv of invoices) {
    const enrolLines = (inv.line_items || []).filter(l => l.type === 'enrolment')
    if (!enrolLines.length) { noLines.push(inv.id); continue }

    // Derive contact from the first student's guardian
    const firstStudentId = enrolLines[0]?.student_id
    const guardian       = guardianMap[firstStudentId] || {}

    // Contact name: "First1 & First2 Surname Family" for siblings, or guardian name
    const studentNames = [...new Set(enrolLines.map(l => l.student_name))]
    const contactName  = guardian.full_name
      || (studentNames.length > 1
        ? `${studentNames.map(n => n.split(' ')[0]).join(' & ')} ${enrolLines[0].student_name.split(' ').pop()} Family`
        : enrolLines[0].student_name)

    // Build Xero line items — account codes from settings, no TaxType override.
    // Xero derives tax from each account's own default tax setting, which avoids
    // the "TaxType cannot be used with account code" validation error.
    const xeroLineItems = (inv.line_items || []).map(l => {
      if (l.type === 'enrolment') {
        const description = [
          l.student_name,
          l.class_name,
          l.day ? `${l.day}${l.start_time ? ' ' + l.start_time : ''}` : null,
        ].filter(Boolean).join(' — ')
        const item = { Description: description, Quantity: 1, UnitAmount: Math.abs(Number(l.amount)) }
        // Use a Xero item code if mapped — Xero resolves the account internally.
        // Mappings are keyed by the class's canonical name, so resolve the line's
        // class_id first: a renamed line label ("… (Holiday 6 lessons)") still
        // finds its course's mapping. Fall back to the global account if unmapped.
        const canonicalName = classById[l.class_id]?.class_name || l.class_name
        const itemCode = itemCodeByClass[canonicalName] ?? itemCodeByClass[l.class_name]
        if (itemCode) {
          item.ItemCode = itemCode
        } else {
          // Separate revenue accounts for 1:1s and classes; a blank 1:1 code
          // means "not split yet", so it falls back to the class account.
          const code = isOneToOneLine(l)
            ? (xeroSettings?.enrolment_1on1_account_code || xeroSettings?.enrolment_account_code)
            : xeroSettings?.enrolment_account_code
          if (code) item.AccountCode = code
        }
        return item
      }

      if (l.type === 'discount') {
        const item = { Description: l.reason || 'Discount', Quantity: 1, UnitAmount: -Math.abs(Number(l.amount)) }
        if (xeroSettings?.discount_account_code) item.AccountCode = xeroSettings.discount_account_code
        return item
      }

      if (l.type === 'credit') {
        const item = { Description: l.reason || 'Credit', Quantity: 1, UnitAmount: -Math.abs(Number(l.amount)) }
        if (xeroSettings?.credit_account_code) item.AccountCode = xeroSettings.credit_account_code
        return item
      }

      // Manually added lines ('adjustment') — signed amount as-is: positive
      // charge uses the enrolment account, deduction the discount account.
      if (l.type === 'adjustment') {
        const amt = Number(l.amount) || 0
        const item = { Description: l.reason || 'Adjustment', Quantity: 1, UnitAmount: amt }
        const code = amt < 0 ? xeroSettings?.discount_account_code : xeroSettings?.enrolment_account_code
        if (code) item.AccountCode = code
        return item
      }

      return null
    }).filter(Boolean)

    built.push({
      inv,
      contactKey:    inv.family_id ? `family:${inv.family_id}` : `student:${inv.student_id}`,
      contactName,
      email:         guardian.email  || undefined,
      phone:         guardian.phone  || undefined,
      xeroLineItems,
      invoiceNumber: inv.invoice_number,
      reference:     inv.reference_code || undefined,
      dueDate:       inv.due_date,
    })
  }

  if (!built.length) return NextResponse.json({ pushed: 0, no_line_items: noLines.length, cash_skipped: cashSkipped.length, draft_skipped: draftSkipped.length, ...termCounts, errors: [], payments: await reconcilePayments(supabase, term_id) })

  // ── Step 3: deduplicate contacts, batch-upsert in ONE Xero call ──────────────
  const contactKeyOrder = []
  const contactByKey    = {}
  for (const b of built) {
    if (!contactByKey[b.contactKey]) {
      contactByKey[b.contactKey] = { name: b.contactName, email: b.email, phone: b.phone }
      contactKeyOrder.push(b.contactKey)
    }
  }

  let contactIdByKey = {}
  try {
    const uniqueContacts = contactKeyOrder.map(k => contactByKey[k])
    const contactIds     = await upsertXeroContacts(uniqueContacts)
    contactKeyOrder.forEach((key, i) => { contactIdByKey[key] = contactIds[i] })
  } catch (err) {
    return NextResponse.json({ error: `Xero contacts failed: ${err.message}` }, { status: 502 })
  }

  // ── Step 4: batch-create all invoices in ONE Xero call ───────────────────────
  const invoicePayloads = built.map(b => ({
    contactId:     contactIdByKey[b.contactKey],
    invoiceNumber: b.invoiceNumber,   // e.g. 26T2-0001
    reference:     b.reference,       // e.g. INV0001
    lineItems:     b.xeroLineItems,
    dueDate:       b.dueDate,
  }))

  let xeroInvoices
  try {
    xeroInvoices = await createXeroInvoicesBatch(invoicePayloads)
  } catch (err) {
    return NextResponse.json({ error: `Xero invoices failed: ${err.message}` }, { status: 502 })
  }

  // ── Step 5: save Xero IDs back to Supabase ───────────────────────────────────
  const results = { pushed: 0, no_line_items: noLines.length, cash_skipped: cashSkipped.length, draft_skipped: draftSkipped.length, ...termCounts, errors: [] }
  const now     = new Date().toISOString()

  for (let i = 0; i < built.length; i++) {
    const { inv } = built[i]
    const xeroInv = xeroInvoices[i]
    if (!xeroInv?.InvoiceID) {
      const msg = xeroInv?.ValidationErrors?.map(e => e.Message).join(', ') || 'No InvoiceID returned'
      results.errors.push({ invoice_id: inv.id, error: msg })
      continue
    }
    await supabase.from('invoices').update({
      xero_invoice_id: xeroInv.InvoiceID,
      xero_contact_id: contactIdByKey[built[i].contactKey],
      xero_pushed_at:  now,
      status:          'synced_to_xero',
    }).eq('id', inv.id)
    results.pushed++
  }

  // After the push, so an invoice created in this very run can still be paid
  // in the same sync once it has been approved in Xero.
  results.payments = await reconcilePayments(supabase, term_id)

  return NextResponse.json(results)
}

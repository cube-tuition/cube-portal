import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { upsertXeroContacts, createXeroInvoicesBatch } from '../../../../lib/xero'

// 2 Xero API calls total (batch contacts + batch invoices) — fast and safe
export const maxDuration = 60

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
    await supabase.from('invoices').update({
      xero_invoice_id: null,
      xero_contact_id: null,
      xero_pushed_at:  null,
    }).in('id', reset_ids)
  }

  // Fetch unpushed invoices that have line_items (new format)
  const { data: invoices, error: invErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('term_id', term_id)
    .is('xero_invoice_id', null)
    .not('status', 'eq', 'voided')
    .not('line_items', 'is', null)
    .order('id')
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })
  if (!invoices?.length) return NextResponse.json({ pushed: 0, message: 'No new invoices to push' })

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
  const built   = []
  const skipped = []

  for (const inv of invoices) {
    const enrolLines = (inv.line_items || []).filter(l => l.type === 'enrolment')
    if (!enrolLines.length) { skipped.push(inv.id); continue }

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
        // Fall back to the global enrolment account code if no item mapping exists.
        const itemCode = itemCodeByClass[l.class_name]
        if (itemCode) {
          item.ItemCode = itemCode
        } else if (xeroSettings?.enrolment_account_code) {
          item.AccountCode = xeroSettings.enrolment_account_code
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

  if (!built.length) return NextResponse.json({ pushed: 0, skipped: skipped.length, errors: [] })

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
  const results = { pushed: 0, skipped: skipped.length, errors: [] }
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

  return NextResponse.json(results)
}

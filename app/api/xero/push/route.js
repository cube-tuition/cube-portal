import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { upsertXeroContacts, createXeroInvoicesBatch } from '../../../../lib/xero'

// 2 Xero API calls total (batch contacts + batch invoices) — fast and safe
export const maxDuration = 60

/**
 * POST /api/xero/push
 * Body: { term_id, reset_ids?: number[] }
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

  // Fetch unpushed invoices
  const { data: invoices, error: invErr } = await supabase
    .from('invoices').select('*').eq('term_id', term_id).is('xero_invoice_id', null).order('id')
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })
  if (!invoices?.length) return NextResponse.json({ pushed: 0, message: 'No new invoices to push' })

  // Fetch term
  const { data: term } = await supabase.from('terms').select('name, end_date').eq('id', term_id).single()
  const dueDate  = term?.end_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const termName = term?.name || 'Term'

  // Fetch classes for this term
  const { data: classes } = await supabase
    .from('classes').select('id, class_name, courses(course_name)').eq('term_id', term_id)
  const classMap     = Object.fromEntries((classes || []).map(c => [c.id, c]))
  const termClassIds = (classes || []).map(c => c.id)

  // ── Step 1: build invoice data from Supabase (no Xero calls yet) ─────────────
  const built = []   // { inv, contactKey, contactName, email, phone, lineItems }
  const skipped = []

  for (const inv of invoices) {
    const studentRows = inv.family_id
      ? (await supabase.from('students').select('id, full_name, email, phone').eq('family_id', inv.family_id)).data || []
      : (await supabase.from('students').select('id, full_name, email, phone').eq('id', inv.student_id)).data || []

    if (!studentRows.length) { skipped.push(inv.id); continue }

    const primary     = studentRows[0]
    const contactName = studentRows.length > 1
      ? `${studentRows.map(s => s.full_name.split(' ')[0]).join(' & ')} ${primary.full_name.split(' ').pop()} Family`
      : primary.full_name

    const enrolments = termClassIds.length
      ? (await supabase.from('enrolments').select('student_id, class_id, price')
          .in('student_id', studentRows.map(s => s.id)).in('class_id', termClassIds)).data || []
      : []

    const lineItems = []
    for (const enrol of enrolments) {
      const cls        = classMap[enrol.class_id]
      const courseName = cls?.courses?.course_name || cls?.class_name || 'Tutoring'
      const student    = studentRows.find(s => s.id === enrol.student_id)
      lineItems.push({
        Description: `${courseName}${studentRows.length > 1 ? ` (${student?.full_name?.split(' ')[0]})` : ''} — ${termName}`,
        Quantity:    1,
        UnitAmount:  Number(enrol.price),
      })
    }
    if (Number(inv.sibling_discount) > 0)
      lineItems.push({ Description: 'Sibling discount', Quantity: 1, UnitAmount: -Number(inv.sibling_discount) })
    if (Number(inv.multi_course_discount) > 0)
      lineItems.push({ Description: 'Multi-course discount', Quantity: 1, UnitAmount: -Number(inv.multi_course_discount) })

    if (!lineItems.length) { skipped.push(inv.id); continue }

    built.push({
      inv,
      contactKey:  inv.family_id ? `family:${inv.family_id}` : `student:${inv.student_id}`,
      contactName,
      email: primary.email || undefined,
      phone: primary.phone || undefined,
      lineItems,
      invoiceRef: `CUBE-${inv.id}-${termName.replace(/\s/g, '')}`,
    })
  }

  if (!built.length) return NextResponse.json({ pushed: 0, skipped: skipped.length, errors: [] })

  // ── Step 2: deduplicate contacts, then batch-upsert in ONE Xero call ─────────
  // Build ordered unique contact list
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
    const contactIds     = await upsertXeroContacts(uniqueContacts)   // 1 Xero API call
    contactKeyOrder.forEach((key, i) => { contactIdByKey[key] = contactIds[i] })
  } catch (err) {
    return NextResponse.json({ error: `Xero contacts failed: ${err.message}` }, { status: 502 })
  }

  // ── Step 3: batch-create all invoices in ONE Xero call ───────────────────────
  const invoicePayloads = built.map(b => ({
    contactId:  contactIdByKey[b.contactKey],
    invoiceRef: b.invoiceRef,
    lineItems:  b.lineItems,
    dueDate,
  }))

  let xeroInvoices
  try {
    xeroInvoices = await createXeroInvoicesBatch(invoicePayloads)     // 1 Xero API call
  } catch (err) {
    return NextResponse.json({ error: `Xero invoices failed: ${err.message}` }, { status: 502 })
  }

  // ── Step 4: save results to Supabase ─────────────────────────────────────────
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
    }).eq('id', inv.id)
    results.pushed++
  }

  return NextResponse.json(results)
}

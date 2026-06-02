import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchAllContacts, findOrCreateContactCached, createXeroInvoicesBatch } from '../../../../lib/xero'

// Contacts are fetched sequentially (~1–2 calls each) then invoices are
// created in a single batch call — well within 60s for 30 invoices.
export const maxDuration = 60

/**
 * POST /api/xero/push
 * Body: { term_id, reset_ids?: number[] }
 *
 * Pushes unpushed invoices for the term to Xero as drafts.
 * Pass reset_ids to clear specific invoice xero_invoice_ids before re-pushing.
 */
export async function POST(req) {
  // Verify admin JWT
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

  // Optionally clear xero_invoice_id for specific invoices so they re-push
  if (reset_ids?.length) {
    await supabase.from('invoices').update({
      xero_invoice_id: null,
      xero_contact_id: null,
      xero_pushed_at:  null,
    }).in('id', reset_ids)
  }

  // Fetch unpushed invoices for this term
  const { data: invoices, error: invErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('term_id', term_id)
    .is('xero_invoice_id', null)
    .order('id')
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })
  if (!invoices?.length) return NextResponse.json({ pushed: 0, message: 'No new invoices to push' })

  // Fetch term info for due date
  const { data: term } = await supabase.from('terms').select('name, end_date').eq('id', term_id).single()
  const dueDate  = term?.end_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const termName = term?.name || 'Term'

  // Fetch classes for this term only
  const { data: classes } = await supabase
    .from('classes')
    .select('id, class_name, courses(course_name)')
    .eq('term_id', term_id)
  const classMap     = Object.fromEntries((classes || []).map(c => [c.id, c]))
  const termClassIds = (classes || []).map(c => c.id)

  const results = { pushed: 0, skipped: 0, errors: [] }

  // ── Phase 1: bulk-fetch all existing Xero contacts (1–2 API calls total) ─────
  let contactMaps
  try {
    contactMaps = await fetchAllContacts()
  } catch (err) {
    return NextResponse.json({ error: `Xero contacts fetch failed: ${err.message}` }, { status: 502 })
  }

  const invoicePayloads = []  // { inv, contactId, lineItems }

  for (const inv of invoices) {
    try {
      // Get students on this invoice
      const studentRows = inv.family_id
        ? (await supabase.from('students').select('id, full_name, email, phone').eq('family_id', inv.family_id)).data || []
        : (await supabase.from('students').select('id, full_name, email, phone').eq('id', inv.student_id)).data || []

      if (!studentRows.length) { results.skipped++; continue }

      const primaryStudent = studentRows[0]
      const contactName = studentRows.length > 1
        ? `${studentRows.map(s => s.full_name.split(' ')[0]).join(' & ')} ${primaryStudent.full_name.split(' ').pop()} Family`
        : primaryStudent.full_name

      // Resolve contact using in-memory map — only hits Xero if truly new
      const contactId = await findOrCreateContactCached({
        name:  contactName,
        email: primaryStudent.email || undefined,
        phone: primaryStudent.phone || undefined,
      }, contactMaps)

      // Fetch enrolments for this term's classes only
      const enrolments = termClassIds.length
        ? (await supabase
            .from('enrolments')
            .select('student_id, class_id, price')
            .in('student_id', studentRows.map(s => s.id))
            .in('class_id', termClassIds)).data || []
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

      if (Number(inv.sibling_discount) > 0) {
        lineItems.push({
          Description: 'Sibling discount',
          Quantity:    1,
          UnitAmount:  -Number(inv.sibling_discount),
        })
      }

      if (Number(inv.multi_course_discount) > 0) {
        lineItems.push({
          Description: 'Multi-course discount',
          Quantity:    1,
          UnitAmount:  -Number(inv.multi_course_discount),
        })
      }

      if (!lineItems.length) { results.skipped++; continue }

      invoicePayloads.push({
        inv,
        contactId,
        lineItems,
        invoiceRef: `CUBE-${inv.id}-${termName.replace(/\s/g, '')}`,
      })
    } catch (err) {
      console.error(`Invoice ${inv.id} contact error:`, err.message)
      results.errors.push({ invoice_id: inv.id, error: err.message })
    }
  }

  if (!invoicePayloads.length) return NextResponse.json(results)

  // ── Phase 2: batch-create all invoices in ONE Xero API call ──────────────────
  try {
    const xeroInvoices = await createXeroInvoicesBatch(
      invoicePayloads.map(p => ({
        contactId:  p.contactId,
        invoiceRef: p.invoiceRef,
        lineItems:  p.lineItems,
        dueDate,
      }))
    )

    // xeroInvoices is returned in the same order as the request array
    const now = new Date().toISOString()
    for (let i = 0; i < invoicePayloads.length; i++) {
      const { inv, contactId } = invoicePayloads[i]
      const xeroInv = xeroInvoices[i]

      if (!xeroInv?.InvoiceID) {
        const msg = xeroInv?.ValidationErrors?.map(e => e.Message).join(', ') || 'No InvoiceID returned'
        results.errors.push({ invoice_id: inv.id, error: msg })
        continue
      }

      await supabase.from('invoices').update({
        xero_invoice_id: xeroInv.InvoiceID,
        xero_contact_id: contactId,
        xero_pushed_at:  now,
      }).eq('id', inv.id)

      results.pushed++
    }
  } catch (err) {
    console.error('Batch invoice create error:', err.message)
    // Attribute to all invoices in the batch
    for (const p of invoicePayloads) {
      results.errors.push({ invoice_id: p.inv.id, error: err.message })
    }
  }

  return NextResponse.json(results)
}

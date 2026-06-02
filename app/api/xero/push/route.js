import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { findOrCreateContact, createXeroInvoice } from '../../../../lib/xero'

// Allow up to 60s on Vercel Pro / Hobby extended
export const maxDuration = 60

/**
 * POST /api/xero/push
 * Body: { term_id, reset_ids?: number[] }
 *
 * Pushes unpushed invoices for the term to Xero as drafts.
 * Pass reset_ids to clear specific invoice xero_invoice_ids before pushing.
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
  const dueDate = term?.end_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const termName = term?.name || 'Term'

  // Fetch classes for this term only
  const { data: classes } = await supabase
    .from('classes')
    .select('id, class_name, courses(course_name)')
    .eq('term_id', term_id)
  const classMap = Object.fromEntries((classes || []).map(c => [c.id, c]))
  const termClassIds = (classes || []).map(c => c.id)

  const results = { pushed: 0, skipped: 0, errors: [] }

  for (const inv of invoices) {
    try {
      // Get students on this invoice
      const studentIds = inv.family_id
        ? (await supabase.from('students').select('id, full_name, email, phone').eq('family_id', inv.family_id)).data || []
        : (await supabase.from('students').select('id, full_name, email, phone').eq('id', inv.student_id)).data || []

      if (!studentIds.length) { results.skipped++; continue }

      // Build contact name
      const primaryStudent = studentIds[0]
      const contactName = studentIds.length > 1
        ? `${studentIds.map(s => s.full_name.split(' ')[0]).join(' & ')} ${primaryStudent.full_name.split(' ').pop()} Family`
        : primaryStudent.full_name

      // Find/create Xero contact
      const contactId = await findOrCreateContact({
        name:  contactName,
        email: primaryStudent.email || undefined,
        phone: primaryStudent.phone || undefined,
      })

      // Fetch enrolments for this term's classes only
      const enrolments = termClassIds.length
        ? (await supabase
            .from('enrolments')
            .select('student_id, class_id, price')
            .in('student_id', studentIds.map(s => s.id))
            .in('class_id', termClassIds)).data || []
        : []

      const lineItems = []

      for (const enrol of enrolments) {
        const cls = classMap[enrol.class_id]
        const courseName = cls?.courses?.course_name || cls?.class_name || 'Tutoring'
        const student = studentIds.find(s => s.id === enrol.student_id)
        lineItems.push({
          Description: `${courseName}${studentIds.length > 1 ? ` (${student?.full_name?.split(' ')[0]})` : ''} — ${termName}`,
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

      // Create Xero draft invoice
      const xeroInvoiceId = await createXeroInvoice({
        contactId,
        invoiceRef: `CUBE-${inv.id}-${termName.replace(/\s/g, '')}`,
        lineItems,
        dueDate,
      })

      // Save xero_invoice_id back to DB
      await supabase.from('invoices').update({
        xero_invoice_id: xeroInvoiceId,
        xero_contact_id: contactId,
        xero_pushed_at:  new Date().toISOString(),
      }).eq('id', inv.id)

      results.pushed++
    } catch (err) {
      console.error(`Invoice ${inv.id} push error:`, err.message)
      results.errors.push({ invoice_id: inv.id, error: err.message })
    }
  }

  return NextResponse.json(results)
}

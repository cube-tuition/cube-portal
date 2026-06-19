import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateInvoicePdfBuffer } from '../../../lib/invoicePdf'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/send-payment-confirmation
 * Body: { invoice_id: string }
 *
 * Loads the invoice + guardian contact, generates the PDF as a receipt,
 * and sends a payment confirmation email via Resend.
 */

export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { invoice_id } = await req.json()
    if (!invoice_id) return NextResponse.json({ error: 'Missing invoice_id' }, { status: 400 })

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email not configured (RESEND_API_KEY missing)' }, { status: 500 })
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // ── Load invoice ──────────────────────────────────────────────────────────
    const { data: inv, error: invErr } = await sb
      .from('invoices')
      .select('*')
      .eq('id', invoice_id)
      .single()
    if (invErr || !inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    if (!inv.payment_status || inv.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Invoice is not marked as paid' }, { status: 400 })
    }

    // ── Load term ─────────────────────────────────────────────────────────────
    const { data: term } = inv.term_id
      ? await sb.from('terms').select('name, start_date, end_date').eq('id', inv.term_id).single()
      : { data: null }
    const termName  = term?.name  || ''
    const termDates = term
      ? `${new Date(term.start_date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })} – ${new Date(term.end_date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`
      : ''

    // ── Resolve parent email ──────────────────────────────────────────────────
    // inv already stores parent_name / parent_email from the enriched snapshot,
    // but those are virtual — look up from guardians directly for freshness.
    const studentIds = [...new Set(
      (inv.line_items || []).filter(l => l.type === 'enrolment').map(l => l.student_id).filter(Boolean)
    )]

    let parentEmail = inv.parent_email || null
    let parentName  = inv.parent_name  || 'Parent/Guardian'

    if (!parentEmail && studentIds.length > 0) {
      const { data: guardian } = await sb
        .from('guardians').select('full_name, email')
        .in('student_id', studentIds).limit(1).single()
      if (guardian) { parentEmail = guardian.email; parentName = guardian.full_name }
    }

    if (!parentEmail) {
      return NextResponse.json({ error: 'No email address on file for this family' }, { status: 422 })
    }

    // ── Student names from line items ─────────────────────────────────────────
    const studentNames = [...new Set(
      (inv.line_items || []).filter(l => l.type === 'enrolment').map(l => l.student_name).filter(Boolean)
    )]
    const studentLabel = studentNames.length > 0
      ? studentNames.join(' & ')
      : 'your student(s)'

    // ── Generate PDF receipt ──────────────────────────────────────────────────
    // Build a synthetic inv object with the parent fields the PDF helper needs
    const invForPdf = {
      ...inv,
      parent_name:  parentName,
      parent_email: parentEmail,
    }
    const pdfBuffer = await generateInvoicePdfBuffer(invForPdf, termName, termDates)
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64')
    const pdfFilename = `${inv.invoice_number || `receipt-${inv.id}`}.pdf`

    // ── Compose email ─────────────────────────────────────────────────────────
    const fmtMoney = n => `$${(Number(n) || 0).toFixed(2)}`
    const total    = fmtMoney(inv.total)

    const subject = `Payment Confirmed — ${inv.invoice_number || 'CUBE Tuition'}`

    const bodyText = [
      `Hi ${parentName.split(' ')[0]},`,
      '',
      `Thank you — we've received your payment of ${total} for ${studentLabel}${termName ? ` (${termName})` : ''}.`,
      '',
      'Your receipt is attached to this email for your records.',
      '',
      'If you have any questions, please don\'t hesitate to reach out.',
      '',
      'Warm regards,',
      'CUBE Tuition',
      'admin@cubetuition.com.au',
    ].join('\n')

    const bodyHtml = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.7;max-width:600px">
  <p>Hi ${parentName.split(' ')[0]},</p>
  <p>Thank you — we've received your payment of <strong>${total}</strong> for <strong>${studentLabel}</strong>${termName ? ` (${termName})` : ''}.</p>
  <p>Your receipt is attached to this email for your records.</p>
  <p>If you have any questions, please don't hesitate to reach out.</p>
  <br>
  <p>Warm regards,<br><strong>CUBE Tuition</strong><br><a href="mailto:admin@cubetuition.com.au" style="color:#325099">admin@cubetuition.com.au</a></p>
</div>`

    // ── Send via Resend ───────────────────────────────────────────────────────
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'CUBE Tuition <admin@cubetuition.com.au>',
        to:      [parentEmail],
        subject,
        text:    bodyText,
        html:    bodyHtml,
        attachments: [{
          filename:    pdfFilename,
          content:     pdfBase64,
          type:        'application/pdf',
          disposition: 'attachment',
        }],
      }),
    })

    if (!resendRes.ok) {
      const err = await resendRes.text()
      console.error('[send-payment-confirmation] Resend error:', err)
      return NextResponse.json({ error: 'Email send failed', detail: err }, { status: 500 })
    }

    return NextResponse.json({ success: true, sent_to: parentEmail })

  } catch (err) {
    console.error('[send-payment-confirmation] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

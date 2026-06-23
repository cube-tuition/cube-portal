import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'

export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { invoice_id, email_to, subject, body, pdf_base64, pdf_filename, is_reminder } = await req.json()

    if (!invoice_id || !email_to) {
      return NextResponse.json({ error: 'Missing invoice_id or email_to' }, { status: 400 })
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
    }

    // Build email payload
    const emailPayload = {
      from: 'CUBE Tuition <admin@cubetuition.com.au>',
      to:   [email_to],
      subject: subject || 'Your CUBE Tuition Invoice',
      text: body.replace(/\*\*(.+?)\*\*/g, '$1'), // plain text fallback strips bold markers
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;max-width:600px">${
        body
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>')
      }</div>`,
      attachments: pdf_base64 && pdf_filename ? [
        {
          filename:    pdf_filename,
          content:     pdf_base64,
          type:        'application/pdf',
          disposition: 'attachment',
        }
      ] : undefined,
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    })

    if (!resendRes.ok) {
      const err = await resendRes.text()
      console.error('[send-invoice] Resend error:', err)
      return NextResponse.json({ error: 'Email send failed', detail: err }, { status: 500 })
    }

    // An overdue reminder records the reminder timestamp (the invoice was already
    // delivered); a first send marks the invoice as delivered.
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
    const sentAt = new Date().toISOString()
    await sb.from('invoices')
      .update(is_reminder ? { reminder_sent_at: sentAt } : { delivery_status: 'sent' })
      .eq('id', invoice_id)

    return NextResponse.json({ success: true, reminder_sent_at: is_reminder ? sentAt : undefined })
  } catch (err) {
    console.error('[send-invoice] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

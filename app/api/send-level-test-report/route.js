import { NextResponse } from 'next/server'
import { requireApiRole } from '../../../lib/apiAuth'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'

/*
 * Email a level-test feedback report (PDF) to a student's parent/guardian.
 * Mirrors /api/send-invoice: the client builds the PDF and posts it as base64.
 */
export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director', 'tutor'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { email_to, student_name, test_title, pdf_base64, pdf_filename, test } = await req.json()
    if (!email_to || !pdf_base64) {
      return NextResponse.json({ error: 'Missing email_to or pdf_base64' }, { status: 400 })
    }
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
    }

    const who = student_name ? student_name.split(' ')[0] : 'your child'
    const title = test_title || 'Level Test'
    const subject = `${student_name ? student_name + ' — ' : ''}${title} Feedback Report`
    const body = `Hi,\n\nPlease find attached ${who}'s feedback report for the ${title}. It shows the overall result and a topic-by-topic breakdown, with areas they're doing well in and areas to focus on.\n\nIf you have any questions, just reply to this email.\n\nWarm regards,\nCUBE Tuition`

    const emailPayload = applyEmailTestMode({
      from: 'CUBE Tuition <admin@cubetuition.com.au>',
      to: [email_to],
      bcc: [PORTAL_BCC],
      subject,
      text: body,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;max-width:600px">${
        body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
      }</div>`,
      attachments: [{
        filename: pdf_filename || 'level-test-report.pdf',
        content: pdf_base64,
        type: 'application/pdf',
        disposition: 'attachment',
      }],
    }, test)

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload),
    })
    if (!resendRes.ok) {
      const err = await resendRes.text()
      console.error('[send-level-test-report] Resend error:', err)
      return NextResponse.json({ error: 'Email send failed', detail: err }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[send-level-test-report] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

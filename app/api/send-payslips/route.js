import { Resend } from 'resend'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/send-payslips
 *
 * Body: {
 *   test?: boolean,
 *   payslips: Array<{ name, email, subject, body, pdf_base64, pdf_filename }>
 * }
 *
 * One email per tutor with their payslip PDF attached. The PDF + body are built
 * client-side (lib/payslip). Staff-only — never an anonymous relay.
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { payslips, test } = await request.json()
    if (!payslips?.length) return Response.json({ error: 'No payslips to send' }, { status: 400 })

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

    const results = []
    for (const p of payslips) {
      if (!p.email) { results.push({ name: p.name, email: null, success: false, error: 'No email address' }); continue }
      const { error } = await resend.emails.send(applyEmailTestMode({
        from:    `CUBE Tuition <${fromEmail}>`,
        to:      [p.email],
        bcc:     [PORTAL_BCC],
        subject: p.subject,
        html:    p.body,
        attachments: p.pdf_base64 ? [{ filename: p.pdf_filename || 'payslip.pdf', content: p.pdf_base64 }] : undefined,
      }, test))
      results.push({ name: p.name, email: p.email, success: !error, error: error?.message || null })
    }

    const successCount = results.filter(r => r.success).length
    return Response.json({ results, successCount, total: results.length })
  } catch (err) {
    console.error('[send-payslips]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

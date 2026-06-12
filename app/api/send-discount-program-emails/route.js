import { Resend } from 'resend'
import { buildDiscountEmailHtml } from '../../../lib/discountEmail'

/*
 * POST /api/send-discount-program-emails
 *
 * Body: {
 *   test?:     boolean,                  // true → send only to testEmail
 *   testEmail?: string,
 *   families:  Array<{ parent_name, parent_email }>
 * }
 *
 * Sends the CUBE discount-program marketing email (referral-led, with
 * multi-course + sibling discounts). Content mirrors docs/CUBE Discount
 * Programs PDF. Pure-HTML email, no attachments.
 */

export async function POST(request) {
  try {
    const { families, test, testEmail } = await request.json()

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const subject   = 'Save $50 every time you share CUBE 🎁 — plus sibling & multi-course discounts'

    // ── Test mode: one email to the requesting director ──────────────────────
    if (test) {
      if (!testEmail) return Response.json({ error: 'Missing testEmail' }, { status: 400 })
      const { error } = await resend.emails.send({
        from: `CUBE Tuition <${fromEmail}>`,
        to: [testEmail],
        subject: `[TEST] ${subject}`,
        html: buildDiscountEmailHtml('there'),
      })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ test: true, sent: testEmail })
    }

    if (!families?.length) {
      return Response.json({ error: 'Missing families' }, { status: 400 })
    }

    const results = []
    for (const family of families) {
      if (!family.parent_email) {
        results.push({ family: family.parent_name, email: null, success: false, error: 'No email address' })
        continue
      }
      const { error: sendErr } = await resend.emails.send({
        from: `CUBE Tuition <${fromEmail}>`,
        to: [family.parent_email],
        subject,
        html: buildDiscountEmailHtml(family.parent_name),
      })
      results.push({
        family:  family.parent_name,
        email:   family.parent_email,
        success: !sendErr,
        error:   sendErr?.message || null,
      })
    }

    const successCount = results.filter(r => r.success).length
    return Response.json({ results, successCount, total: results.length })
  } catch (err) {
    console.error('[send-discount-program-emails]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

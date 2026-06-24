import { Resend } from 'resend'
import { buildDiscountEmailHtml, mergeDiscountContent } from '../../../lib/discountEmail'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'

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
    const { families, test, testEmail, intro, content } = await request.json()
    // `content` = full editable-content overrides; `intro` kept for back-compat
    const overrides = content || (intro ? { intro } : {})

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const subject   = mergeDiscountContent(overrides).subject

    // ── Global test mode: one generic sample to the requesting director ──────
    // (Per-family test sends pass `families` + `test` and fall through to the
    // loop below, which redirects each to staff via applyEmailTestMode.)
    if (test && !families?.length) {
      if (!testEmail) return Response.json({ error: 'Missing testEmail' }, { status: 400 })
      const { error } = await resend.emails.send({
        from: `CUBE Tuition <${fromEmail}>`,
        to: [testEmail],
        subject: `[TEST] ${subject}`,
        html: buildDiscountEmailHtml('there', overrides),
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
      const { error: sendErr } = await resend.emails.send(applyEmailTestMode({
        from: `CUBE Tuition <${fromEmail}>`,
        to: [family.parent_email],
        bcc: [PORTAL_BCC],
        subject,
        html: buildDiscountEmailHtml(family.parent_name, overrides),
      }, test))
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

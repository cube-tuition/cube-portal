import { Resend } from 'resend'
import { buildCourseOfferEmailHtml } from '../../../lib/courseOfferEmail'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/send-course-offer-emails
 *
 * Body: {
 *   subject:    string,
 *   body:       string,                 // plain text with {{parent_name}}/{{student_names}}
 *   test?:      boolean,
 *   testEmail?: string,                 // generic sample when no families given
 *   families:   Array<{ parent_name, parent_email, student_names }>
 * }
 *
 * Sends a course-offer marketing email (one per family). Pure HTML, no
 * attachments. Staff-only — never an anonymous relay.
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { subject, body, families, test, testEmail } = await request.json()
    if (!subject || !body) return Response.json({ error: 'Missing subject or body' }, { status: 400 })

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

    // Generic test sample to the requester (no families attached).
    if (test && !families?.length) {
      if (!testEmail) return Response.json({ error: 'Missing testEmail' }, { status: 400 })
      const { error } = await resend.emails.send({
        from: `CUBE Tuition <${fromEmail}>`,
        to: [testEmail],
        subject: `[TEST] ${subject}`,
        html: buildCourseOfferEmailHtml(body, { parentName: 'there', studentNames: 'your child' }),
      })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ test: true, sent: testEmail })
    }

    if (!families?.length) return Response.json({ error: 'Missing families' }, { status: 400 })

    const results = []
    for (const family of families) {
      if (!family.parent_email) {
        results.push({ family: family.parent_name, email: null, success: false, error: 'No email address' })
        continue
      }
      const { error: sendErr } = await resend.emails.send(applyEmailTestMode({
        from: `CUBE Tuition <${fromEmail}>`,
        to:   [family.parent_email],
        bcc:  [PORTAL_BCC],
        subject,
        html: buildCourseOfferEmailHtml(body, { parentName: family.parent_name, studentNames: family.student_names }),
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
    console.error('[send-course-offer-emails]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

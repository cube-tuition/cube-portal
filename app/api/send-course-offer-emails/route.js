import { Resend } from 'resend'
import { buildCourseOfferEmailHtml } from '../../../lib/courseOfferEmail'
import { applyEmailTestMode } from '../../../lib/emailConfig'
import { startCampaign } from '../../../lib/emailLog'
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
 * attachments. Staff-only — never an anonymous relay. Every send is recorded
 * in sent_emails and the office gets one summary per campaign (lib/emailLog).
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { subject, body, highlight, cta, families, test, testEmail } = await request.json()
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
        html: buildCourseOfferEmailHtml(body, { parentName: 'there', studentNames: 'your child' }, highlight, cta),
      })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ test: true, sent: testEmail })
    }

    if (!families?.length) return Response.json({ error: 'Missing families' }, { status: 400 })

    const results = []
    const campaign = startCampaign('course_offer', { subject, sentBy: auth.user.id, isTest: !!test })
    let sampleHtml = ''
    for (const family of families) {
      if (!family.parent_email) {
        results.push({ family: family.parent_name, email: null, success: false, error: 'No email address' })
        campaign.record({ to_name: family.parent_name, status: 'failed', error: 'No email address' })
        continue
      }
      const html = buildCourseOfferEmailHtml(body, { parentName: family.parent_name, studentNames: family.student_names }, highlight, cta)
      const { data: sendData, error: sendErr } = await resend.emails.send(applyEmailTestMode({
        from: `CUBE Tuition <${fromEmail}>`,
        to:   [family.parent_email],
        subject,
        html,
      }, test))
      if (!sendErr && !sampleHtml) sampleHtml = html
      results.push({
        family:  family.parent_name,
        email:   family.parent_email,
        success: !sendErr,
        error:   sendErr?.message || null,
      })
      campaign.record({ to_name: family.parent_name, to_email: family.parent_email, status: sendErr ? 'failed' : 'sent', error: sendErr?.message || null, resend_id: sendData?.id || null, meta: { students: family.student_names || null } })
    }
    await campaign.finish({ resend, fromEmail, sampleHtml })

    const successCount = results.filter(r => r.success).length
    return Response.json({ results, successCount, total: results.length })
  } catch (err) {
    console.error('[send-course-offer-emails]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

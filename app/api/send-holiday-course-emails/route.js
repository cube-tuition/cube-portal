import { Resend } from 'resend'
import { buildHolidayCourseEmailHtml } from '../../../lib/holidayCourseEmail'
import { applyEmailTestMode } from '../../../lib/emailConfig'
import { startCampaign } from '../../../lib/emailLog'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/send-holiday-course-emails
 *
 * Body: {
 *   template:   { email_subject, intro, dates_line, courses, fees, closing, enrol_url, enrol_label, signoff },
 *   test?:      boolean,
 *   testEmail?: string,                 // generic sample when no families given
 *   families:   Array<{ parent_name, parent_email, student_names }>
 * }
 *
 * Sends a holiday-course marketing email (one per family). Pure HTML, no
 * attachments. Staff-only — never an anonymous relay. Every send is recorded
 * in sent_emails and the office gets one summary per campaign (lib/emailLog).
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { template, families, test, testEmail } = await request.json()
    const subject = template?.email_subject?.trim()
    if (!subject || !template?.intro?.trim()) return Response.json({ error: 'Missing subject or intro' }, { status: 400 })
    if (!/^https?:\/\//i.test(template?.enrol_url || '')) return Response.json({ error: 'The enrol button needs a full sign-up form link (https://…)' }, { status: 400 })

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const fill = (s) => s.replace(/\{\{parent_name\}\}/g, 'there').replace(/\{\{student_names\}\}/g, 'your child')

    if (test && !families?.length) {
      if (!testEmail) return Response.json({ error: 'Missing testEmail' }, { status: 400 })
      const { error } = await resend.emails.send({
        from: `CUBE Tuition <${fromEmail}>`,
        to: [testEmail],
        subject: `[TEST] ${fill(subject)}`,
        html: buildHolidayCourseEmailHtml(template, { parentName: 'there', studentNames: 'your child' }),
      })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ test: true, sent: testEmail })
    }

    if (!families?.length) return Response.json({ error: 'Missing families' }, { status: 400 })

    const results = []
    const campaign = startCampaign('holiday_course', { subject: fill(subject), sentBy: auth.user.id, isTest: !!test })
    let sampleHtml = ''
    for (const family of families) {
      if (!family.parent_email) {
        results.push({ family: family.parent_name, email: null, success: false, error: 'No email address' })
        campaign.record({ to_name: family.parent_name, status: 'failed', error: 'No email address' })
        continue
      }
      const vars = { parentName: family.parent_name, studentNames: family.student_names }
      const familySubject = subject.replace(/\{\{parent_name\}\}/g, vars.parentName || 'there').replace(/\{\{student_names\}\}/g, vars.studentNames || 'your child')
      const html = buildHolidayCourseEmailHtml(template, vars)
      const { data: sendData, error: sendErr } = await resend.emails.send(applyEmailTestMode({
        from: `CUBE Tuition <${fromEmail}>`,
        to:   [family.parent_email],
        subject: familySubject,
        html,
      }, test))
      if (!sendErr && !sampleHtml) sampleHtml = html
      results.push({ family: family.parent_name, email: family.parent_email, success: !sendErr, error: sendErr?.message || null })
      campaign.record({ subject: familySubject, to_name: family.parent_name, to_email: family.parent_email, status: sendErr ? 'failed' : 'sent', error: sendErr?.message || null, resend_id: sendData?.id || null, meta: { students: family.student_names || null } })
    }
    await campaign.finish({ resend, fromEmail, sampleHtml })

    const successCount = results.filter(r => r.success).length
    return Response.json({ results, successCount, total: results.length })
  } catch (err) {
    console.error('[send-holiday-course-emails]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

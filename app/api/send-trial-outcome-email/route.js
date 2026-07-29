import { Resend } from 'resend'
import { buildTrialOutcomeEmailHtml, fillTrialVars, mergeTrialOutcomeContent } from '../../../lib/trialOutcomeEmail'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/send-trial-outcome-email
 *
 * Body: {
 *   parentEmail: string,
 *   parentName?: string,
 *   studentName?: string,
 *   groups:      [{ subject, lessons: [{ label, feedback }] }],
 *   content?:    object,   // per-send edits to DEFAULT_TRIAL_OUTCOME_CONTENT
 *   test?:       boolean,  // deliver to staff only (applyEmailTestMode)
 * }
 *
 * Sends one parent the outcome of their child's trial: the tutors' per-lesson
 * feedback plus how to continue. One family per call — this is sent from the
 * trial pipeline after a human has read the feedback, not in bulk.
 * Staff-only; never an anonymous relay.
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { parentEmail, parentName, studentName, groups, content, test } = await request.json()
    if (!parentEmail) return Response.json({ error: 'Missing parentEmail' }, { status: 400 })

    const vars = { parentName, studentName }
    const c = mergeTrialOutcomeContent(content)
    const subject = fillTrialVars(c.subject, vars)

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

    const { error } = await resend.emails.send(applyEmailTestMode({
      from: `CUBE Tuition <${fromEmail}>`,
      to:   [parentEmail],
      bcc:  [PORTAL_BCC],
      subject,
      html: buildTrialOutcomeEmailHtml(vars, groups || [], content),
    }, test))

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, sentTo: test ? 'staff (test)' : parentEmail })
  } catch (err) {
    console.error('[send-trial-outcome-email]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

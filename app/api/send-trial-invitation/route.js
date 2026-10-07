import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { buildTrialInvitationEmailHtml, fillTrialVars, mergeTrialInvitationContent } from '../../../lib/trialInvitationEmail'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/send-trial-invitation
 *
 * Body: {
 *   submissionId: number,       // trial_submissions.id — stamped Contacted on real send
 *   parentEmail:  string,
 *   parentName?:  string,
 *   studentName?: string,
 *   proposal?:     { className, day, time, date },   // display-ready strings
 *   alternatives?: [{ className, day, time, date }],
 *   content?:      object,      // per-send edits to DEFAULT_TRIAL_INVITATION_CONTENT
 *   test?:         boolean,     // deliver to staff only (applyEmailTestMode)
 * }
 *
 * The first email of a trial: welcome + a proposed trial class. One family per
 * call, staff-composed in the pipeline; never an anonymous relay. A real send
 * marks the submission Contacted (status new → contacted, contacted_at set
 * once) so the pipeline reflects the outreach without a manual move.
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { submissionId, parentEmail, parentName, studentName, proposal, alternatives, content, test } = await request.json()
    if (!parentEmail) return Response.json({ error: 'Missing parentEmail' }, { status: 400 })

    const vars = { parentName, studentName }
    const c = mergeTrialInvitationContent(content)
    const subject = fillTrialVars(c.subject, vars)

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

    const { error } = await resend.emails.send(applyEmailTestMode({
      from: `CUBE Tuition <${fromEmail}>`,
      to:   [parentEmail],
      bcc:  [PORTAL_BCC],
      subject,
      html: buildTrialInvitationEmailHtml(vars, proposal || null, alternatives || [], content),
    }, test))
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Real sends move the card: guarded so a concurrent change (or a second
    // send) can't drag a converted/declined card back to Contacted.
    let stamped = false
    if (!test && submissionId != null) {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      const now = new Date().toISOString()
      const { data } = await sb.from('trial_submissions')
        .update({ status: 'contacted', contacted_at: now })
        .eq('id', submissionId).eq('status', 'new')
        .select('id')
      stamped = !!data?.length
      if (!stamped) {
        // Not "new" any more — still record first contact if never stamped.
        await sb.from('trial_submissions')
          .update({ contacted_at: now })
          .eq('id', submissionId).is('contacted_at', null)
      }
    }

    return Response.json({ success: true, sentTo: test ? 'staff (test)' : parentEmail, stamped })
  } catch (err) {
    console.error('[send-trial-invitation]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

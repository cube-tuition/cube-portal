import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { buildTrialOutcomeEmailHtml, fillTrialVars, mergeTrialOutcomeContent, TRIAL_EMAIL_STAGES } from '../../../lib/trialOutcomeEmail'
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
 *   stage?:      'lesson1' | 'outcome',   // which of the two emails (default outcome)
 *   nextLesson?: string,   // lesson1: the next trial lesson, for {{next_lesson}}
 *   content?:    object,   // per-send edits to the stage's default wording
 *   submissionId?: number, // trial_submissions row to date the send on
 *   test?:       boolean,  // deliver to staff only (applyEmailTestMode)
 * }
 *
 * Sends one parent a trial feedback email: after lesson 1 (the tutor's notes
 * and the next trial lesson) or after lesson 2 (the notes and how to
 * continue). One family per call — sent from the trial pipeline after a human
 * has read the feedback, not in bulk. A real send dates the submission's
 * lesson1_feedback_sent_at / outcome_sent_at — from the FIRST send; a resend
 * never shifts it.
 * Staff-only; never an anonymous relay.
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { parentEmail, parentName, studentName, groups, content, test, nextLesson, submissionId, stage: rawStage } = await request.json()
    if (!parentEmail) return Response.json({ error: 'Missing parentEmail' }, { status: 400 })
    const stage = TRIAL_EMAIL_STAGES[rawStage] ? rawStage : 'outcome'

    const vars = { parentName, studentName, nextLesson }
    const c = mergeTrialOutcomeContent(content, stage)
    const subject = fillTrialVars(c.subject, vars)

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

    const { error } = await resend.emails.send(applyEmailTestMode({
      from: `CUBE Tuition <${fromEmail}>`,
      to:   [parentEmail],
      bcc:  [PORTAL_BCC],
      subject,
      html: buildTrialOutcomeEmailHtml(vars, groups || [], content, stage),
    }, test))

    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Date the card from the first real send.
    let sentAt = null
    if (!test && submissionId) {
      const field = TRIAL_EMAIL_STAGES[stage].sentField
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      const now = new Date().toISOString()
      await sb.from('trial_submissions').update({ [field]: now }).eq('id', submissionId).is(field, null)
      const { data } = await sb.from('trial_submissions').select(field).eq('id', submissionId).maybeSingle()
      sentAt = data?.[field] || now
    }
    return Response.json({ success: true, sentTo: test ? 'staff (test)' : parentEmail, stage, sentAt })
  } catch (err) {
    console.error('[send-trial-outcome-email]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

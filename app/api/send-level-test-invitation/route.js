import { Resend } from 'resend'
import { buildLevelTestInvitationEmailHtml, mergeLevelTestInvitationContent, normaliseSlots } from '../../../lib/levelTestInvite'
import { fillTrialVars } from '../../../lib/trialInvitationEmail'
import { serviceClient, newInviteToken, inviteLink } from '../../../lib/levelTestInviteServer'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/send-level-test-invitation — directors only
 *
 * Body: {
 *   submissionId: number,     // the trial enquiry
 *   parentEmail:  string,
 *   parentName?:  string,
 *   studentName?: string,
 *   slots:        [{ date, start, end?, room? }],   // the suggested times
 *   buildIds?:    uuid[],     // the level tests to sit (booklet_builds)
 *   content?:     object,     // per-send edits to DEFAULT_LEVEL_TEST_INVITATION_CONTENT
 *   test?:        boolean,    // deliver to staff only; the button opens a preview of the form
 * }
 *
 * The alternative first email of a trial: invite the student to sit a level
 * test before choosing a class. A real send saves the invite (one per
 * enquiry — a resend updates its times and keeps the same link), stamps
 * level_test_invitation_sent_at on the first send, and moves a New card to
 * Contacted like the trial invitation does.
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { submissionId, parentEmail, parentName, studentName, slots, buildIds, content, test } = await request.json()
    const id = Number(submissionId)
    if (!Number.isFinite(id)) return Response.json({ error: 'Missing submissionId' }, { status: 400 })
    if (!parentEmail) return Response.json({ error: 'Missing parentEmail' }, { status: 400 })
    const times = normaliseSlots(slots)
    if (!times.length) return Response.json({ error: 'Add at least one suggested time' }, { status: 400 })

    const sb = serviceClient()
    const { data: sub } = await sb.from('trial_submissions').select('id, status, converted_student_id, student_name').eq('id', id).maybeSingle()
    if (!sub) return Response.json({ error: 'Trial enquiry not found' }, { status: 404 })

    // A test send links to a preview of the form (nothing can be booked from
    // it) and leaves the saved invite alone.
    let link
    if (test) {
      link = `${inviteLink('preview')}?d=${Buffer.from(JSON.stringify({ s: times })).toString('base64url')}`
    } else {
      const { data: existing } = await sb.from('level_test_invites').select('id, token, lesson_id').eq('submission_id', id).maybeSingle()
      const row = {
        submission_id: id,
        student_id: sub.converted_student_id || null,
        student_name: studentName || sub.student_name || null,
        build_ids: Array.isArray(buildIds) ? buildIds.filter(Boolean) : [],
        slots: times,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // New times answer a "none of these suit" — the card stops flagging it.
        ...(existing && !existing.lesson_id ? { responded_at: null } : {}),
      }
      const token = existing?.token || newInviteToken()
      const { error: saveErr } = existing
        ? await sb.from('level_test_invites').update(row).eq('id', existing.id)
        : await sb.from('level_test_invites').insert({ ...row, token })
      if (saveErr) return Response.json({ error: saveErr.message }, { status: 500 })
      link = inviteLink(token)
    }

    const vars = { parentName, studentName }
    const c = mergeLevelTestInvitationContent(content)
    const resend = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const { error } = await resend.emails.send(applyEmailTestMode({
      from: `CUBE Tuition <${fromEmail}>`,
      to:   [parentEmail],
      bcc:  [PORTAL_BCC],
      subject: fillTrialVars(c.subject, vars),
      html: buildLevelTestInvitationEmailHtml(vars, times, link, content),
    }, test))
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (test) return Response.json({ success: true, sentTo: 'staff (test)' })

    // First contact, as the trial invitation records it — guarded so a card
    // already further along is never dragged back to Contacted.
    const now = new Date().toISOString()
    const { data: moved } = await sb.from('trial_submissions')
      .update({ status: 'contacted', contacted_at: now })
      .eq('id', id).eq('status', 'new').select('id')
    if (!moved?.length) await sb.from('trial_submissions').update({ contacted_at: now }).eq('id', id).is('contacted_at', null)
    await sb.from('trial_submissions').update({ level_test_invitation_sent_at: now }).eq('id', id).is('level_test_invitation_sent_at', null)

    return Response.json({ success: true, sentTo: parentEmail, stamped: !!moved?.length, sentAt: now })
  } catch (err) {
    console.error('[send-level-test-invitation]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

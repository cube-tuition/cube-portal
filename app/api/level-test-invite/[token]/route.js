import { Resend } from 'resend'
import { serviceClient, inviteByToken, inviteLink, sydneyToday } from '../../../../lib/levelTestInviteServer'
import { buildLevelTestBookedEmailHtml, openSlots, planInviteResponse, slotLabel } from '../../../../lib/levelTestInvite'
import { PORTAL_BCC } from '../../../../lib/emailConfig'
import { sendPushToAll } from '../../../../lib/push'

/*
 * /api/level-test-invite/<token> — public: the parent's level test form.
 *
 * No login: the token in the invitation email is the credential.
 *   GET  → the student's first name, the times still open, and the booking
 *          if they've already picked one.
 *   POST { slot: { date, start } } → book the level test at that time (or move
 *          an existing booking to it), and email the parent a confirmation.
 *        { none: true, note } → none of the times suit: record what does
 *          (and drop a booking they no longer want).
 * Either way the directors get a push and the trial card shows the answer.
 */
export const dynamic = 'force-dynamic'

const LESSON_COLS = 'id, lesson_date, start_time, end_time, room, status'
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const bookedView = (l) => (l && l.status !== 'cancelled'
  ? { date: l.lesson_date, start: String(l.start_time || '').slice(0, 5), end: l.end_time ? String(l.end_time).slice(0, 5) : null, room: l.room || null }
  : null)

async function load(sb, token) {
  const invite = await inviteByToken(sb, token)
  if (!invite) return {}
  const [{ data: sub }, { data: lesson }, { count }] = await Promise.all([
    sb.from('trial_submissions').select('id, parent_name, parent_email, student_name, converted_student_id').eq('id', invite.submission_id).maybeSingle(),
    invite.lesson_id ? sb.from('lessons').select(LESSON_COLS).eq('id', invite.lesson_id).maybeSingle() : Promise.resolve({ data: null }),
    invite.lesson_id ? sb.from('level_test_marks').select('id', { count: 'exact', head: true }).eq('lesson_id', invite.lesson_id) : Promise.resolve({ count: 0 }),
  ])
  return { invite, sub, lesson: lesson || null, marked: (count || 0) > 0 }
}

export async function GET(_request, { params }) {
  const { token } = await params
  const sb = serviceClient()
  const { invite, sub, lesson, marked } = await load(sb, token)
  if (!invite) return Response.json({ error: 'This link is not valid. Please contact CUBE for a new one.' }, { status: 404 })
  const today = sydneyToday()
  const booked = bookedView(lesson)
  return Response.json({
    firstName: firstName(invite.student_name || sub?.student_name),
    slots: openSlots(invite.slots, today),
    booked,
    locked: !!booked && (marked || booked.date < today),
    note: invite.parent_note || '',
    responded: !!invite.responded_at,
  })
}

export async function POST(request, { params }) {
  const { token } = await params
  const sb = serviceClient()
  const { invite, sub, lesson, marked } = await load(sb, token)
  if (!invite) return Response.json({ error: 'This link is not valid. Please contact CUBE for a new one.' }, { status: 404 })
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }) }
  const choice = body?.none ? { none: true, note: String(body.note || '').slice(0, 1000) } : { slot: body?.slot }
  const plan = planInviteResponse({ invite, lesson, marked, choice, today: sydneyToday() })
  if (plan.error) return Response.json({ error: plan.error }, { status: 409 })

  const now = new Date().toISOString()
  const studentId = invite.student_id || sub?.converted_student_id || null
  const studentName = invite.student_name || sub?.student_name || null
  const slot = plan.slot
  const at = slot ? { lesson_date: slot.date, start_time: slot.start, end_time: slot.end || null, room: slot.room || null } : null

  if (plan.action === 'book') {
    const { data: l, error } = await sb.from('lessons').insert({
      lesson_type: 'level_test',
      makeup_student_id: studentId,
      student_name: studentName,
      level_test_build_ids: invite.build_ids || [],
      level_test_build_id: invite.build_ids?.[0] || null,
      ...at,
      notes: 'Booked by the parent from the level test invitation',
      scheduled_teacher_id: null,
      is_makeup: false,
      status: 'scheduled',
    }).select('id').single()
    if (error) return Response.json({ error: 'Could not book the level test — please try again.' }, { status: 500 })
    await sb.from('level_test_invites').update({ lesson_id: l.id, chosen_slot: slot, responded_at: now, updated_at: now }).eq('id', invite.id)
  } else if (plan.action === 'move') {
    const { error } = await sb.from('lessons').update(at).eq('id', lesson.id)
    if (error) return Response.json({ error: 'Could not change the time — please try again.' }, { status: 500 })
    await sb.from('level_test_invites').update({ chosen_slot: slot, responded_at: now, updated_at: now }).eq('id', invite.id)
  } else if (plan.action === 'cancel' || plan.action === 'note') {
    if (plan.action === 'cancel') {
      const { error } = await sb.from('lessons').delete().eq('id', lesson.id)
      if (error) return Response.json({ error: 'Could not update the booking — please try again.' }, { status: 500 })
    }
    await sb.from('level_test_invites').update({ lesson_id: null, chosen_slot: null, parent_note: choice.note.trim(), responded_at: now, updated_at: now }).eq('id', invite.id)
  }

  if (plan.action !== 'keep') {
    // The family answered: restart the pipeline's activity clock.
    await sb.from('trial_submissions').update({ last_activity_at: now, stale_notified_at: null }).eq('id', invite.submission_id)

    const who = studentName || 'A trial student'
    const pushBody = slot
      ? `${plan.action === 'move' ? 'Moved to' : 'Booked'} ${slotLabel(slot)}`
      : `None of the times suit${plan.action === 'cancel' ? ' (booking removed)' : ''}: ${choice.note.trim()}`
    await sendPushToAll({ title: `Level test — ${who}`, body: pushBody, url: '/tutor/trials', tag: `level-test-${invite.id}` }).catch(() => {})

    if (slot && sub?.parent_email && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
      await resend.emails.send({
        from: `CUBE Tuition <${fromEmail}>`,
        to: [sub.parent_email],
        bcc: [PORTAL_BCC],
        subject: `${firstName(studentName) || 'Your child'}’s level test — ${slotLabel(slot)}`,
        html: buildLevelTestBookedEmailHtml({ parentName: sub.parent_name, studentName: firstName(studentName), slot, link: inviteLink(invite.token), moved: plan.action === 'move' }),
      }).catch(() => {})
    }
  }

  return Response.json({ ok: true, action: plan.action, booked: slot ? { date: slot.date, start: slot.start, end: slot.end, room: slot.room } : null })
}

import { Resend } from 'resend'
import { serviceClient, sydneyToday, trialInviteByToken, trialInviteLink, bookTrialClass } from '../../../../lib/trialInviteServer'
import { isOpen, openOptions, planTrialPicks, buildTrialBookedEmailHtml, optionTitle, optionDetail } from '../../../../lib/trialInvite'
import { PORTAL_BCC } from '../../../../lib/emailConfig'
import { sendPushToAll } from '../../../../lib/push'

/*
 * /api/trial-invite/<token> — public: the family's trial class form.
 *
 * No login: the token in the invitation email is the credential.
 *   GET  → each subject's offered classes still open, what's already picked,
 *          and whether it can still change.
 *   POST { picks: { <submission_id>: <option_id> } } → book them. A class
 *          books the trial (its enrolment gets the class and first lesson, the
 *          card moves to Trial scheduled); an "other" option staff typed in is
 *          recorded for them to set up. The family gets a confirmation; the directors get a push.
 *        { none: true, note } → none of them suit; record what does.
 */
export const dynamic = 'force-dynamic'

const SUB_COLS = 'id, status, student_name, student_year, school, parent_name, parent_email, parent_phone, converted_student_id, enrolment_id, trial_class_id'
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || ''
// A subject can change its pick until its trial has started.
const changeable = (sub, pickedOption, today) =>
  ['new', 'contacted', 'trial_scheduled', 'on_hold'].includes(sub?.status) && (!pickedOption || isOpen(pickedOption, today))

async function load(sb, token) {
  const invite = await trialInviteByToken(sb, token)
  if (!invite) return {}
  const { data: subs } = await sb.from('trial_submissions').select(SUB_COLS).in('id', invite.submission_ids || [])
  return { invite, subs: subs || [] }
}

export async function GET(_request, { params }) {
  const { token } = await params
  const sb = serviceClient()
  const { invite, subs } = await load(sb, token)
  if (!invite) return Response.json({ error: 'This link is not valid. Please contact CUBE for a new one.' }, { status: 404 })
  const today = sydneyToday()
  return Response.json({
    firstName: firstName(invite.student_name),
    sections: (invite.sections || []).map(sec => {
      const sub = subs.find(s => s.id === sec.submission_id)
      const pickedId = invite.picks?.[sec.submission_id]?.option_id || null
      const picked = (sec.options || []).find(o => o.id === pickedId) || null
      return { submission_id: sec.submission_id, label: sec.label, options: openOptions(sec, today), picked, locked: !changeable(sub, picked, today) }
    }),
    note: invite.note || '',
    responded: !!invite.responded_at,
  })
}

export async function POST(request, { params }) {
  const { token } = await params
  const sb = serviceClient()
  const { invite, subs } = await load(sb, token)
  if (!invite) return Response.json({ error: 'This link is not valid. Please contact CUBE for a new one.' }, { status: 404 })
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }) }
  const today = sydneyToday()
  const now = new Date().toISOString()
  const who = firstName(invite.student_name) || 'A trial student'

  if (body?.none) {
    const note = String(body.note || '').trim().slice(0, 1000)
    if (!note) return Response.json({ error: 'Please tell us which days and times would suit.' }, { status: 400 })
    await sb.from('trial_invites').update({ note, responded_at: now }).eq('id', invite.id)
    await sb.from('trial_submissions').update({ last_activity_at: now, stale_notified_at: null }).in('id', invite.submission_ids || [])
    await sendPushToAll({ title: `Trial times — ${who}`, body: `None of the classes suit: ${note}`, url: '/tutor/trials', tag: `trial-invite-${invite.id}` }).catch(() => {})
    return Response.json({ ok: true, action: 'note' })
  }

  const plan = planTrialPicks({ invite, picks: body?.picks, today })
  if (plan.error) return Response.json({ error: plan.error }, { status: 409 })
  // Only what changed, and only where the trial hasn't started yet.
  const chosen = plan.chosen.filter(({ section, option }) => invite.picks?.[section.submission_id]?.option_id !== option.id)
  if (!chosen.length) return Response.json({ ok: true, action: 'keep' })
  for (const { section } of chosen) {
    const sub = subs.find(s => s.id === section.submission_id)
    const prev = (section.options || []).find(o => o.id === invite.picks?.[section.submission_id]?.option_id)
    if (!changeable(sub, prev, today)) return Response.json({ error: 'This trial has already started — please contact CUBE to change it.' }, { status: 409 })
  }

  const picks = { ...(invite.picks || {}) }
  let moved = false
  for (const { section, option } of chosen) {
    const sub = subs.find(s => s.id === section.submission_id)
    if (picks[section.submission_id]) moved = true
    if (option.kind === 'class') {
      try { await bookTrialClass(sb, sub, { classId: option.class_id, firstDate: option.date }) }
      catch (e) {
        console.error('[trial-invite] booking failed', e?.message)
        return Response.json({ error: 'Could not book the trial — please try again, or reply to our email.' }, { status: 500 })
      }
    }
    picks[section.submission_id] = { option_id: option.id, picked_at: now }
  }
  await sb.from('trial_invites').update({ picks, responded_at: now }).eq('id', invite.id)
  await sb.from('trial_submissions').update({ last_activity_at: now, stale_notified_at: null }).in('id', chosen.map(c => c.section.submission_id))

  const summary = chosen.map(({ section, option }) => `${optionTitle(option)} (${optionDetail(option)})`).join('; ')
  await sendPushToAll({
    title: `Trial ${moved ? 'changed' : 'booked'} — ${who}`,
    body: chosen.some(c => c.option.kind === 'slot') ? `${summary}. Set it up on the Trials page.` : summary,
    url: '/tutor/trials', tag: `trial-invite-${invite.id}`,
  }).catch(() => {})

  if (invite.parent_email && process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    await resend.emails.send({
      from: `CUBE Tuition <${fromEmail}>`,
      to: [invite.parent_email],
      bcc: [PORTAL_BCC],
      subject: `${firstName(invite.student_name) || 'Your child'}’s trial ${moved ? 'has been updated' : 'is booked'}`,
      html: buildTrialBookedEmailHtml({ parentName: invite.parent_name, studentName: invite.student_name, chosen, link: trialInviteLink(token), moved }),
    }).catch(() => {})
  }
  return Response.json({ ok: true, action: moved ? 'move' : 'book' })
}

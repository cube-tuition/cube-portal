import { requireApiRole } from '../../../lib/apiAuth'
import {
  adminClient, mintResetLink, sendResetEmail, isPlaceholderEmail,
} from '../../../lib/passwordReset'

/*
 * Staff-initiated password reset — POST /api/password-reset
 *
 * The student sets their own password; staff only start the process. Nobody at
 * CUBE ever sees the result, which is the point: the alternative (staff pick a
 * password and read it out) means the password is known to two people from the
 * moment it exists, and tends to stay written down.
 *
 * Two calls:
 *   POST { student_id }                    → who this could be sent to (mints nothing)
 *   POST { student_id, deliver: <mode> }   → mints a single-use link and delivers it
 *
 * deliver:
 *   'link'     — return the link only; staff hand it over in person. The only
 *                option for the ~44 students whose login is a placeholder
 *                address that cannot receive mail.
 *   'student'  — email the student's own address.
 *   'guardian' — email the parent on file. Most students have no address of
 *                their own, so this is the only way to reach them remotely.
 *                It is deliberately a separate, named choice: the link opens
 *                the student's account, so sending it to a parent is a decision
 *                staff make, never a silent fallback.
 *
 * The link is returned in every mode. Email can bounce or sit in a spam folder,
 * and a reset nobody can complete is worse than one staff can read out.
 */
export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { student_id, deliver } = await req.json()
    if (!student_id) return Response.json({ error: 'Missing student_id' }, { status: 400 })
    if (deliver && !['link', 'student', 'guardian'].includes(deliver)) {
      return Response.json({ error: 'Unknown delivery mode.' }, { status: 400 })
    }

    const sb = adminClient()

    const { data: student, error: sErr } = await sb
      .from('students').select('id, full_name').eq('id', student_id).maybeSingle()
    if (sErr)     return Response.json({ error: sErr.message }, { status: 400 })
    if (!student) return Response.json({ error: 'No such student.' }, { status: 404 })

    // The login address is whatever auth holds — students.email can drift from
    // it, and resetting the wrong address would send a link that signs nobody in.
    // getUserById reports a missing account as an ERROR, not as {user: null} —
    // so an ordinary "they don't have a login yet" arrives here looking like a
    // failure. Say what it means instead of passing "User not found" through.
    const { data: found, error: uErr } = await sb.auth.admin.getUserById(student_id)
    const missing = !found?.user || /not.?found/i.test(uErr?.message || '')
    if (missing) {
      return Response.json({
        error: `${student.full_name} has no portal login yet — create one first, then you can reset it.`,
      }, { status: 409 })
    }
    if (uErr) return Response.json({ error: uErr.message }, { status: 400 })
    const accountEmail = found.user.email || null
    const placeholder  = isPlaceholderEmail(accountEmail)

    const { data: guardians } = await sb
      .from('guardians').select('full_name, email, relationship').eq('student_id', student_id)
    const guardian = (guardians || [])
      .find(g => String(g.email || '').trim() && !isPlaceholderEmail(g.email)) || null

    const options = {
      full_name: student.full_name,
      account:  { email: accountEmail, deliverable: !!accountEmail && !placeholder },
      guardian: guardian
        ? { email: guardian.email.trim(), name: guardian.full_name, relationship: guardian.relationship }
        : null,
      last_sign_in_at: found.user.last_sign_in_at || null,
    }

    // Step one: just report what's possible.
    if (!deliver) return Response.json({ options })

    if (deliver === 'student' && !options.account.deliverable) {
      return Response.json({
        error: `${accountEmail || 'That login'} cannot receive email. Use the link, or send it to a parent.`,
      }, { status: 400 })
    }
    if (deliver === 'guardian' && !guardian) {
      return Response.json({
        error: `No parent email on file for ${student.full_name}.`,
      }, { status: 400 })
    }

    // generateLink needs the address the account actually uses, whoever we
    // eventually mail the link to.
    const link = await mintResetLink(accountEmail)
    if (!link) {
      return Response.json({ error: 'Could not create a reset link for that account.' }, { status: 400 })
    }

    let sentTo = null
    let warning = null
    if (deliver !== 'link') {
      const to = deliver === 'guardian' ? guardian.email.trim() : accountEmail
      const sent = await sendResetEmail({
        to,
        link,
        name: student.full_name,
        guardianOf: deliver === 'guardian' ? student.full_name : null,
      })
      // A failed send does NOT fail the request — the link is already valid and
      // staff can still use it. Say what happened rather than swallowing it.
      if (sent.ok) sentTo = to
      else warning = sent.error
    }

    return Response.json({ success: true, link, sentTo, warning, options, deliver })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

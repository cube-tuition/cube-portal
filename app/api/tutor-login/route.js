import { requireApiRole } from '../../../lib/apiAuth'
import { adminClient, mintResetLink, sendLoginDetailsEmail } from '../../../lib/passwordReset'
import { ensureTutorLogin, getTutorLogin, logTutorLoginSent, LoginError } from '../../../lib/tutorLogin'

/*
 * A tutor's portal login — /api/tutor-login (directors only)
 *
 *   GET  ?tutor_id=…        → { login: { email, last_sign_in_at } | null }
 *   POST { tutor_id }       → creates the login if there is none (see
 *                             lib/tutorLogin), then emails the "Your CUBE
 *                             Portal login" message: username + a single-use
 *                             link to choose a password. With a login already
 *                             in place it just re-sends.
 *
 * The onboarding email can carry the same login (api/onboarding/send).
 * Sends are recorded in login_deliveries (kind 'tutor'), never the link.
 */

export async function GET(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    const id = new URL(req.url).searchParams.get('tutor_id')
    if (!id) return Response.json({ error: 'Missing tutor_id' }, { status: 400 })
    const u = await getTutorLogin(adminClient(), id)
    return Response.json({ login: u ? { email: u.email || null, last_sign_in_at: u.last_sign_in_at || null } : null })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    const { tutor_id } = await req.json()
    if (!tutor_id) return Response.json({ error: 'Missing tutor_id' }, { status: 400 })

    const sb = adminClient()
    const { data: tutor } = await sb.from('tutors').select('id, full_name, email').eq('id', tutor_id).maybeSingle()
    if (!tutor) return Response.json({ error: 'Tutor not found.' }, { status: 404 })

    const { user, created } = await ensureTutorLogin(sb, tutor)
    const username = user.email
    const link = await mintResetLink(username)
    if (!link) return Response.json({ error: 'The login exists, but a set-password link could not be created.', created }, { status: 400 })
    const sent = await sendLoginDetailsEmail({ to: username, link, username, name: tutor.full_name, staff: true })
    if (!sent.ok) return Response.json({ error: sent.error, created }, { status: 502 })

    await logTutorLoginSent(sb, { tutorId: tutor.id, sentTo: username, authUser: auth.user })
    return Response.json({ success: true, created, sentTo: username })
  } catch (err) {
    return Response.json({ error: err.message }, { status: err instanceof LoginError ? err.status : 500 })
  }
}

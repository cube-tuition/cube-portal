import { randomBytes } from 'node:crypto'
import { requireApiRole } from '../../../lib/apiAuth'
import { adminClient, mintResetLink, sendLoginDetailsEmail } from '../../../lib/passwordReset'

/*
 * A tutor's portal login — /api/tutor-login (directors only)
 *
 *   GET  ?tutor_id=…        → { login: { email, last_sign_in_at } | null }
 *   POST { tutor_id }       → creates the login if there is none, then emails
 *                             the "Your CUBE Portal login" message: username +
 *                             a single-use link to choose a password.
 *                             With a login already in place it just re-sends.
 *
 * Same pairing rule as /api/student-login: the auth user is created with the
 * tutor's OWN id (tutors.id = auth.users.id — getAuthProfile looks tutors up
 * by it) and app_metadata.role 'tutor'. The account gets a random password
 * nobody ever sees; the tutor sets their own from the link. Sends are
 * recorded in login_deliveries (kind 'tutor'), never the link.
 */

const getLogin = async (sb, id) => {
  const { data } = await sb.auth.admin.getUserById(id)
  return data?.user || null
}

export async function GET(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    const id = new URL(req.url).searchParams.get('tutor_id')
    if (!id) return Response.json({ error: 'Missing tutor_id' }, { status: 400 })
    const u = await getLogin(adminClient(), id)
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

    let user = await getLogin(sb, tutor.id)
    let created = false
    if (!user) {
      const email = String(tutor.email || '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: `${tutor.full_name} has no email address on file — add one first.` }, { status: 400 })
      }
      const { data, error } = await sb.auth.admin.createUser({
        id: tutor.id,                                     // the ids must match
        email,
        password: randomBytes(24).toString('base64url'), // never shown; they set their own
        email_confirm: true,
        app_metadata: { role: 'tutor' },
        user_metadata: { full_name: tutor.full_name },
      })
      if (error) {
        if (/already been registered|already exists|duplicate/i.test(error.message || '')) {
          return Response.json({ error: `${email} is already the login for another account.` }, { status: 409 })
        }
        return Response.json({ error: error.message }, { status: 400 })
      }
      if (data?.user?.id !== tutor.id) {
        if (data?.user?.id) await sb.auth.admin.deleteUser(data.user.id)
        return Response.json({ error: 'The account was created with the wrong id and has been removed. Nothing was changed.' }, { status: 500 })
      }
      user = data.user; created = true
    }

    const username = user.email
    const link = await mintResetLink(username)
    if (!link) return Response.json({ error: 'The login exists, but a set-password link could not be created.', created }, { status: 400 })
    const sent = await sendLoginDetailsEmail({ to: username, link, username, name: tutor.full_name, staff: true })
    if (!sent.ok) return Response.json({ error: sent.error, created }, { status: 502 })

    await sb.from('login_deliveries').insert({
      person_id: tutor.id, kind: 'tutor', channel: 'account', sent_to: username,
      sent_by: auth.user?.id || null,
      sent_by_name: auth.user?.user_metadata?.full_name || auth.user?.email || null,
      purpose: 'login_details',
    })
    return Response.json({ success: true, created, sentTo: username })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { randomBytes } from 'node:crypto'

/*
 * Server only (service-role client). A tutor's portal login: the auth user is
 * created with the tutor's OWN id (tutors.id = auth.users.id — getAuthProfile
 * looks tutors up by it) and app_metadata.role 'tutor'. It gets a random
 * password nobody ever sees; the tutor chooses their own from a set-password
 * link. Used by /api/tutor-login and the onboarding email.
 */

export class LoginError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

export async function getTutorLogin(sb, tutorId) {
  const { data } = await sb.auth.admin.getUserById(tutorId)
  return data?.user || null
}

// Returns { user, created }. Throws LoginError with a message fit for the page.
export async function ensureTutorLogin(sb, tutor) {
  const existing = await getTutorLogin(sb, tutor.id)
  if (existing) return { user: existing, created: false }
  const email = String(tutor.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new LoginError(`${tutor.full_name} has no email address on file — add one first.`)
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
      throw new LoginError(`${email} is already the login for another account.`, 409)
    }
    throw new LoginError(error.message)
  }
  if (data?.user?.id !== tutor.id) {
    if (data?.user?.id) await sb.auth.admin.deleteUser(data.user.id)
    throw new LoginError('The account was created with the wrong id and has been removed. Nothing was changed.', 500)
  }
  return { user: data.user, created: true }
}

export async function logTutorLoginSent(sb, { tutorId, sentTo, authUser }) {
  await sb.from('login_deliveries').insert({
    person_id: tutorId, kind: 'tutor', channel: 'account', sent_to: sentTo,
    sent_by: authUser?.id || null,
    sent_by_name: authUser?.user_metadata?.full_name || authUser?.email || null,
    purpose: 'login_details',
  })
}

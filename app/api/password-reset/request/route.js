import { mintResetLink, sendResetEmail, isPlaceholderEmail, adminClient } from '../../../../lib/passwordReset'

/*
 * Self-service "I forgot my password" — POST /api/password-reset/request
 *
 * Unauthenticated by necessity: someone who cannot log in cannot present a
 * token. Two consequences shape everything below.
 *
 * 1. It must not reveal who has an account. The response is identical whether
 *    the address belongs to a director, to nobody, or to a student whose login
 *    is an unreachable placeholder. Otherwise this becomes a way to test which
 *    addresses are enrolled at CUBE.
 *
 * 2. It must not be usable to spray mail at an address. One request per address
 *    per minute is plenty for a person who mistyped, and useless to anyone else.
 *
 * Most students cannot use this route at all — their login is an
 * @cubetuition.com placeholder with no mailbox — so they still go through a
 * tutor (see /api/password-reset). Staff, and the handful of students with a
 * real address, can help themselves.
 */

// Per-instance and therefore leaky across serverless workers — this throttles
// the ordinary case, it is not a defence on its own. Supabase rate-limits token
// generation underneath, and Resend rate-limits delivery.
const recent = new Map()
const COOLDOWN_MS = 60_000

function throttled(key) {
  const now = Date.now()
  for (const [k, t] of recent) if (now - t > COOLDOWN_MS) recent.delete(k)
  if (recent.has(key)) return true
  recent.set(key, now)
  return false
}

// Always the same answer, whatever happened. Never say "no such account".
const SAME_ANSWER = {
  success: true,
  message: 'If that address has a CUBE Portal login, a reset link is on its way. It can take a minute or two to arrive — check your junk folder too.',
}

export async function POST(req) {
  try {
    const { email } = await req.json()
    const address = String(email || '').trim().toLowerCase()
    if (!address || !address.includes('@')) {
      return Response.json({ error: 'Please enter your email address.' }, { status: 400 })
    }
    if (throttled(address)) return Response.json(SAME_ANSWER)

    // Placeholder logins have no mailbox, so there is nothing to send. Stop
    // before minting a token that would only be thrown away.
    if (isPlaceholderEmail(address)) return Response.json(SAME_ANSWER)

    // generateLink fails for unknown addresses; mintResetLink returns null
    // rather than throwing, so an unknown address is indistinguishable here.
    const link = await mintResetLink(address)
    if (!link) return Response.json(SAME_ANSWER)

    let name = null
    try {
      const { data } = await adminClient()
        .from('students').select('full_name').ilike('email', address).maybeSingle()
      name = data?.full_name || null
    } catch { /* a missing name only costs us the greeting */ }

    await sendResetEmail({ to: address, link, name })
    return Response.json(SAME_ANSWER)
  } catch {
    // Even a crash must not become a signal about the address.
    return Response.json(SAME_ANSWER)
  }
}

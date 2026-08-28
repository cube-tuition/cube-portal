import { createClient } from '@supabase/supabase-js'
import { PORTAL_BCC } from './emailConfig'
import { passwordResetEmail } from './passwordResetEmail'
import { loginDetailsEmail } from './loginDetailsEmail'

/*
 * Server-side plumbing for password resets. Never import this from a client
 * component — it uses the service-role key.
 *
 * How a reset works here
 * ---------------------
 * Supabase's own resetPasswordForEmail() would send the mail itself, through
 * Supabase's shared SMTP: heavily rate-limited, unbranded, and prone to the
 * spam folder. The portal already sends everything else through Resend on a
 * verified cubetuition.com.au domain, so we mint the token and do the delivery
 * ourselves — admin.generateLink() creates a recovery token WITHOUT sending
 * anything, and hands back `hashed_token`.
 *
 * We then build our own URL to /reset-password rather than using the
 * `action_link` Supabase returns. That link bounces through Supabase's
 * /auth/v1/verify endpoint and depends on the redirect allow-list being right;
 * ours goes straight to a page we control and calls verifyOtp() with the token.
 *
 * The token travels in the URL **fragment** (#token=…), not the query string.
 * Fragments are never sent to a server, so the token stays out of access logs,
 * proxy logs, and Referer headers on anything the page later loads.
 */

let _admin
export function adminClient() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
  }
  return _admin
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.cubetuition.com.au').replace(/\/+$/, '')
}

/* Generated logins live on @cubetuition.com, a domain with no mailboxes. Mail
   sent there is undeliverable, so these accounts can only be reset by hand. */
export const isPlaceholderEmail = (e) => /@cubetuition\.com$/i.test(String(e || '').trim())

/* Mint a single-use recovery link for an existing account. Returns null (never
   throws) when the address has no account, so callers that must not reveal
   whether an account exists can stay quiet. */
export async function mintResetLink(email) {
  const { data, error } = await adminClient().auth.admin.generateLink({
    type: 'recovery',
    email,
  })
  const token = data?.properties?.hashed_token
  if (error || !token) return null
  return `${siteUrl()}/reset-password#token=${encodeURIComponent(token)}`
}

/* Deliver an email built by one of the templates above. Returns {ok, error} —
   the caller decides how loudly to fail. */
async function deliver({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, error: 'Email is not configured (RESEND_API_KEY is missing).' }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `CUBE Tuition <${process.env.RESEND_FROM_EMAIL || 'admin@cubetuition.com.au'}>`,
      to: [to],
      bcc: [PORTAL_BCC],   // staff keep a record that a reset went out, but never the token's use
      subject,
      html,
      text,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('[password-reset] Resend error:', body)
    return { ok: false, error: 'The email could not be sent. Use the link instead.' }
  }
  return { ok: true }
}

export async function sendResetEmail({ to, link, name, guardianOf = null }) {
  return deliver({ to, ...passwordResetEmail({ name, link, guardianOf }) })
}

/* First-time login details: the username, the portal address, and a link to
   choose a password. No password is sent — none can be, they are only hashes. */
export async function sendLoginDetailsEmail({ to, link, name, username, guardianOf = null }) {
  return deliver({ to, ...loginDetailsEmail({ name, username, link, portalUrl: siteUrl(), guardianOf }) })
}

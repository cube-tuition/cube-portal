import { createHmac, timingSafeEqual } from 'node:crypto'

/*
 * Twilio, server-side only. Configured by three env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (E.164, the office number)
 * Optional: PORTAL_URL (public origin, for status callbacks and email links),
 * SMS_ALERT_EMAIL (where a copy of every incoming text is emailed; defaults to
 * the portal BCC address), SMS_FORWARD_TO (a mobile that also gets a copy).
 */

export const twilioConfigured = () =>
  !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER)

export const portalUrl = () => (process.env.PORTAL_URL || 'https://portal.cubetuition.com.au').replace(/\/$/, '')

/** Send one SMS from the office number. Returns Twilio's message resource. */
export async function sendSms({ to, body, statusCallback = `${portalUrl()}/api/sms/status` }) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN
  const params = new URLSearchParams({ To: to, From: process.env.TWILIO_PHONE_NUMBER, Body: body })
  if (statusCallback) params.set('StatusCallback', statusCallback)
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.message || `Twilio ${res.status}`)
  return json
}

/*
 * Twilio signs every webhook: base64(HMAC-SHA1(auth token, url + sorted POST
 * params)). The URL must be exactly what Twilio requested, so it is rebuilt
 * from the proxy headers Vercel sets (or TWILIO_WEBHOOK_BASE if that differs).
 */
export function webhookUrl(req) {
  const u = new URL(req.url)
  const base = process.env.TWILIO_WEBHOOK_BASE
    || `${req.headers.get('x-forwarded-proto') || 'https'}://${req.headers.get('x-forwarded-host') || req.headers.get('host')}`
  return base.replace(/\/$/, '') + u.pathname + u.search
}

export function validTwilioSignature(req, url, params) {
  const token = process.env.TWILIO_AUTH_TOKEN
  const sig = req.headers.get('x-twilio-signature') || ''
  if (!token || !sig) return false
  const data = url + [...params.keys()].sort().map((k) => k + params.get(k)).join('')
  const expected = createHmac('sha1', token).update(data).digest('base64')
  const a = Buffer.from(expected), b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}

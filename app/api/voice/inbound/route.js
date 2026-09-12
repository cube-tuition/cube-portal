import { webhookUrl, validTwilioSignature, twiml, escXml, portalUrl } from '../../../../lib/twilio'
import { normalisePhone } from '../../../../lib/phone'
import { adminClient } from '../../../../lib/callAlerts'

/*
 * POST /api/voice/inbound — Twilio's "A call comes in" webhook.
 * Logs the call, then rings the office mobile (VOICE_FORWARD_TO) for
 * VOICE_RING_SECONDS. What happens after the ring — answered, or straight to
 * voicemail — is decided in /api/voice/after, which Twilio calls when the
 * <Dial> ends. With no forwarding number configured, callers go to voicemail.
 */
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const params = new URLSearchParams(await req.text())
  if (!validTwilioSignature(req, webhookUrl(req), params)) return Response.json({ error: 'Bad signature' }, { status: 403 })
  const from = normalisePhone(params.get('From')), sid = params.get('CallSid')
  const forwardTo = normalisePhone(process.env.VOICE_FORWARD_TO || '')
  const admin = adminClient()
  if (sid && from) {
    await admin.from('phone_calls').upsert({ twilio_sid: sid, direction: 'in', phone: from, forwarded_to: forwardTo || null, status: 'ringing' }, { onConflict: 'twilio_sid', ignoreDuplicates: true })
  }
  const after = `${portalUrl()}/api/voice/after`
  if (!forwardTo) {
    // No mobile to ring: behave as an unanswered call.
    return twiml(`<Redirect method="POST">${escXml(after + '?DialCallStatus=no-answer')}</Redirect>`)
  }
  // 'parent' passes the caller's own number through so your phone shows who it
  // is; 'office' shows the office number instead so you know it's a work call.
  const callerId = (process.env.VOICE_CALLER_ID || 'parent') === 'office' ? process.env.TWILIO_PHONE_NUMBER : from
  const ring = Math.max(10, Math.min(60, Number(process.env.VOICE_RING_SECONDS) || 20))
  return twiml(`<Dial action="${escXml(after)}" method="POST" timeout="${ring}" callerId="${escXml(callerId)}"><Number>${escXml(forwardTo)}</Number></Dial>`)
}

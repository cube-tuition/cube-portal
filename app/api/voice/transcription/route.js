import { webhookUrl, validTwilioSignature } from '../../../../lib/twilio'
import { adminClient } from '../../../../lib/callAlerts'

/* POST /api/voice/transcription — Twilio's transcript of a voicemail. */
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const params = new URLSearchParams(await req.text())
  if (!validTwilioSignature(req, webhookUrl(req), params)) return Response.json({ error: 'Bad signature' }, { status: 403 })
  const sid = params.get('CallSid')
  const text = params.get('TranscriptionStatus') === 'completed' ? (params.get('TranscriptionText') || '') : ''
  if (sid && text) {
    await adminClient().from('phone_calls').update({ transcript: text, updated_at: new Date().toISOString() }).eq('twilio_sid', sid)
  }
  return new Response('', { status: 204 })
}

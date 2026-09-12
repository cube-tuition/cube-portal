import { webhookUrl, validTwilioSignature, twiml, escXml, portalUrl } from '../../../../lib/twilio'
import { normalisePhone } from '../../../../lib/phone'
import { adminClient, whoIs, alertEmail } from '../../../../lib/callAlerts'

/*
 * POST /api/voice/after — runs when the forwarded <Dial> ends.
 * Answered: record the talk time and hang up. Not answered (busy, no answer,
 * failed): mark the call missed, email the office, and take a voicemail of up
 * to two minutes with a transcript. Twilio then reports the recording and the
 * transcript to their own callbacks.
 */
export const dynamic = 'force-dynamic'

const GREETING = process.env.VOICE_GREETING
  || "Thank you for calling CUBE Tuition. We can't take your call right now. Please leave your name and a short message after the tone, and we'll call you back."

export async function POST(req) {
  const params = new URLSearchParams(await req.text())
  if (!validTwilioSignature(req, webhookUrl(req), params)) return Response.json({ error: 'Bad signature' }, { status: 403 })
  const sid = params.get('CallSid'), from = normalisePhone(params.get('From'))
  const outcome = params.get('DialCallStatus') || new URL(req.url).searchParams.get('DialCallStatus') || 'no-answer'
  const admin = adminClient()

  if (outcome === 'completed') {
    await admin.from('phone_calls').update({ status: 'answered', duration_s: Number(params.get('DialCallDuration')) || 0, updated_at: new Date().toISOString() }).eq('twilio_sid', sid)
    return twiml('<Hangup/>')
  }

  await admin.from('phone_calls').upsert({ twilio_sid: sid, direction: 'in', phone: from, status: 'missed', updated_at: new Date().toISOString() }, { onConflict: 'twilio_sid' })
  const who = await whoIs(admin, from)
  await alertEmail({ subject: `Missed call from ${who}`, who, phone: from, linkPath: '/tutor/admin/messages?tab=calls',
    bodyHtml: `<p style="margin:0">The office number rang${process.env.VOICE_FORWARD_TO ? ' and was not answered' : ''}. If they leave a voicemail you'll get a second email with it.</p>` })

  const base = portalUrl()
  return twiml(
    `<Say voice="Polly.Nicole" language="en-AU">${escXml(GREETING)}</Say>` +
    `<Record maxLength="120" playBeep="true" timeout="5" transcribe="true"` +
    ` transcribeCallback="${escXml(base + '/api/voice/transcription')}"` +
    ` recordingStatusCallback="${escXml(base + '/api/voice/recording')}" recordingStatusCallbackEvent="completed"/>` +
    `<Say voice="Polly.Nicole" language="en-AU">Thank you. Goodbye.</Say><Hangup/>`,
  )
}

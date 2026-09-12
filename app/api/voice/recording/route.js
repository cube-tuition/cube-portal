import { webhookUrl, validTwilioSignature } from '../../../../lib/twilio'
import { adminClient, whoIs, alertEmail } from '../../../../lib/callAlerts'

/* POST /api/voice/recording — a voicemail recording is ready. */
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const params = new URLSearchParams(await req.text())
  if (!validTwilioSignature(req, webhookUrl(req), params)) return Response.json({ error: 'Bad signature' }, { status: 403 })
  const sid = params.get('CallSid'), rec = params.get('RecordingSid')
  if (sid && rec) {
    const admin = adminClient()
    const secs = Number(params.get('RecordingDuration')) || 0
    const { data: row } = await admin.from('phone_calls').update({
      status: 'voicemail', recording_sid: rec, recording_url: params.get('RecordingUrl') || null, recording_s: secs, updated_at: new Date().toISOString(),
    }).eq('twilio_sid', sid).select('phone').maybeSingle()
    if (row?.phone) {
      const who = await whoIs(admin, row.phone)
      await alertEmail({ subject: `Voicemail from ${who}`, who, phone: row.phone, linkPath: '/tutor/admin/messages?tab=calls',
        bodyHtml: `<p style="margin:0">A ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} voicemail is waiting. The transcript appears in the portal a minute or two later.</p>` })
    }
  }
  return new Response('', { status: 204 })
}

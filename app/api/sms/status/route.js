import { createClient } from '@supabase/supabase-js'
import { webhookUrl, validTwilioSignature } from '../../../../lib/twilio'

/*
 * POST /api/sms/status — Twilio's delivery status callback for texts the
 * portal sent (queued → sent → delivered, or undelivered / failed). Keeps the
 * outbound row's status current so the page can show a failed send.
 */
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const params = new URLSearchParams(await req.text())
  if (!validTwilioSignature(req, webhookUrl(req), params)) {
    return Response.json({ error: 'Bad signature' }, { status: 403 })
  }
  const sid = params.get('MessageSid'), status = params.get('MessageStatus')
  if (sid && status) {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const patch = { status }
    if (params.get('ErrorCode')) patch.error = `${params.get('ErrorCode')} ${params.get('ErrorMessage') || ''}`.trim()
    await admin.from('sms_messages').update(patch).eq('twilio_sid', sid)
  }
  return new Response('', { status: 204 })
}

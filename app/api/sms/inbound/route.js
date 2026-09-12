import { createClient } from '@supabase/supabase-js'
import { webhookUrl, validTwilioSignature, sendSms, portalUrl } from '../../../../lib/twilio'
import { formatPhone, normalisePhone } from '../../../../lib/phone'
import { PORTAL_BCC } from '../../../../lib/emailConfig'

/*
 * POST /api/sms/inbound — Twilio's "A message comes in" webhook.
 * Unauthenticated by nature, so the Twilio signature is checked instead. Stores
 * the text, then emails a copy to the office inbox (and forwards an SMS copy to
 * SMS_FORWARD_TO if set) so nothing waits unseen for someone to open the page.
 * Replies with empty TwiML: the portal answers from the Messages page, not
 * with an auto-reply.
 */
export const dynamic = 'force-dynamic'

const TWIML_EMPTY = new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(req) {
  const params = new URLSearchParams(await req.text())
  if (!validTwilioSignature(req, webhookUrl(req), params)) {
    return Response.json({ error: 'Bad signature' }, { status: 403 })
  }
  const from = normalisePhone(params.get('From')), body = params.get('Body') || '', sid = params.get('MessageSid')
  if (!from || !sid) return TWIML_EMPTY

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  // Twilio retries on any non-2xx, so a duplicate SID is simply acknowledged.
  const { error } = await admin.from('sms_messages').upsert(
    { direction: 'in', phone: from, body, twilio_sid: sid, status: 'received' }, { onConflict: 'twilio_sid', ignoreDuplicates: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Who is this? Students' and guardians' numbers, for the alert's subject line.
  let who = formatPhone(from)
  try {
    const [{ data: st }, { data: gu }] = await Promise.all([
      admin.from('students').select('full_name, phone').not('phone', 'is', null),
      admin.from('guardians').select('full_name, relationship, students(full_name)').not('phone', 'is', null),
    ])
    const s = (st || []).find((r) => normalisePhone(r.phone) === from)
    const g = (gu || []).find((r) => normalisePhone(r.phone) === from)
    if (g) who = `${g.full_name}${g.students?.full_name ? ` (${g.relationship || 'guardian'} of ${g.students.full_name})` : ''}`
    else if (s) who = `${s.full_name} (student)`
  } catch { /* the alert still goes out with the bare number */ }

  const link = `${portalUrl()}/tutor/admin/messages?phone=${encodeURIComponent(from)}`
  const alerts = []
  if (process.env.RESEND_API_KEY) {
    alerts.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'CUBE Tuition <admin@cubetuition.com.au>',
        to: [process.env.SMS_ALERT_EMAIL || PORTAL_BCC],
        subject: `New text from ${who}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#2A2035;max-width:560px">
          <p style="color:#555;margin:0 0 8px">${esc(who)} · ${esc(formatPhone(from))}</p>
          <div style="background:#F0F4FF;border-radius:12px;padding:14px 16px;white-space:pre-wrap;font-size:15px">${esc(body)}</div>
          <p style="margin:16px 0 0"><a href="${link}" style="color:#325099;font-weight:600">Reply in the portal →</a></p>
        </div>`,
      }),
    }).catch(() => {}))
  }
  if (process.env.SMS_FORWARD_TO) {
    alerts.push(sendSms({ to: normalisePhone(process.env.SMS_FORWARD_TO), body: `Text from ${who}: ${body}`, statusCallback: null }).catch(() => {}))
  }
  await Promise.all(alerts)
  return TWIML_EMPTY
}

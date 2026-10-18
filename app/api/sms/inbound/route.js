import { createClient } from '@supabase/supabase-js'
import { webhookUrl, validTwilioSignature, sendSms } from '../../../../lib/twilio'
import { formatPhone, normalisePhone } from '../../../../lib/phone'
import { sendPushToAll } from '../../../../lib/push'

/*
 * POST /api/sms/inbound — Twilio's "A message comes in" webhook.
 * Unauthenticated by nature, so the Twilio signature is checked instead. Stores
 * the text, then pushes the directors' phones (and forwards an SMS copy to
 * SMS_FORWARD_TO if set) so nothing waits unseen for someone to open the page.
 * Replies with empty TwiML: the portal answers from the Messages page, not
 * with an auto-reply.
 */
export const dynamic = 'force-dynamic'

const TWIML_EMPTY = new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } })

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

  // Who is this? Guardians', students' and staff numbers, for the alert's subject line.
  let who = formatPhone(from)
  try {
    const [{ data: st }, { data: gu }, { data: tu }, { data: di }] = await Promise.all([
      admin.from('students').select('full_name, phone').not('phone', 'is', null),
      admin.from('guardians').select('full_name, relationship, phone, students(full_name)').not('phone', 'is', null),
      admin.from('tutors').select('full_name, phone').not('phone', 'is', null),
      admin.from('directors').select('full_name, phone').not('phone', 'is', null),
    ])
    const match = (rows) => (rows || []).find((r) => normalisePhone(r.phone) === from)
    const s = match(st), g = match(gu), t = match(tu), d = match(di)
    if (g) who = `${g.full_name}${g.students?.full_name ? ` (${g.relationship || 'guardian'} of ${g.students.full_name})` : ''}`
    else if (s) who = `${s.full_name} (student)`
    else if (d) who = `${d.full_name} (director)`
    else if (t) who = `${t.full_name} (tutor)`
  } catch { /* the alert still goes out with the bare number */ }

  // The directors hear about it through the app (push) — no email copy any more.
  const alerts = []
  if (process.env.SMS_FORWARD_TO) {
    alerts.push(sendSms({ to: normalisePhone(process.env.SMS_FORWARD_TO), body: `Text from ${who}: ${body}`, statusCallback: null }).catch(() => {}))
  }
  alerts.push(sendPushToAll({ title: who, body, url: `/messages?phone=${encodeURIComponent(from)}`, tag: `sms-${from}` }).catch(() => {}))
  await Promise.all(alerts)
  return TWIML_EMPTY
}

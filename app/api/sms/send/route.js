import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../lib/apiAuth'
import { sendSms, twilioConfigured } from '../../../../lib/twilio'
import { normalisePhone } from '../../../../lib/phone'

/*
 * POST /api/sms/send — send a text from the office number.
 * Caller must be admin or director. Body: { to, body }. The message is handed
 * to Twilio first and only recorded once accepted, so a rejected send (an
 * unverified number on a trial account, say) leaves no phantom row.
 */
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const auth = await requireApiRole(req, ['admin', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  if (!twilioConfigured()) return Response.json({ error: 'SMS is not configured yet — add the Twilio keys to the environment.' }, { status: 503 })

  let payload
  try { payload = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const to = normalisePhone(payload?.to), body = String(payload?.body || '').trim()
  if (!/^\+\d{8,15}$/.test(to)) return Response.json({ error: 'That doesn’t look like a phone number.' }, { status: 400 })
  if (!body) return Response.json({ error: 'Nothing to send.' }, { status: 400 })
  if (body.length > 1200) return Response.json({ error: 'Keep a text under 1200 characters.' }, { status: 400 })

  let tw
  try { tw = await sendSms({ to, body }) }
  catch (e) { return Response.json({ error: `Twilio refused the message: ${e.message}` }, { status: 502 }) }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: senderRow } = await admin.from('tutors').select('full_name').eq('id', auth.user.id).maybeSingle()
  const { data: dirRow } = senderRow ? { data: null } : await admin.from('directors').select('full_name').eq('id', auth.user.id).maybeSingle()
  const { data: row, error } = await admin.from('sms_messages').insert({
    direction: 'out', phone: to, body, twilio_sid: tw.sid, status: tw.status || 'queued',
    sent_by: senderRow?.full_name || dirRow?.full_name || auth.user.email || null,
  }).select('*').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, message: row })
}

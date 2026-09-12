import { createClient } from '@supabase/supabase-js'
import { formatPhone, normalisePhone } from './phone'
import { PORTAL_BCC } from './emailConfig'
import { portalUrl } from './twilio'

/* Shared by the SMS and voice webhooks: who a number belongs to, and an alert
 * email to the office inbox. Both fail soft — a webhook must never 500 because
 * an email bounced. */

export const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export async function whoIs(admin, e164) {
  try {
    const [{ data: st }, { data: gu }] = await Promise.all([
      admin.from('students').select('full_name, phone').not('phone', 'is', null),
      admin.from('guardians').select('full_name, relationship, students(full_name)').not('phone', 'is', null),
    ])
    const g = (gu || []).find((r) => normalisePhone(r.phone) === e164)
    if (g) return `${g.full_name}${g.students?.full_name ? ` (${g.relationship || 'guardian'} of ${g.students.full_name})` : ''}`
    const s = (st || []).find((r) => normalisePhone(r.phone) === e164)
    if (s) return `${s.full_name} (student)`
  } catch { /* fall through */ }
  return formatPhone(e164)
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function alertEmail({ subject, who, phone, bodyHtml, linkPath }) {
  if (!process.env.RESEND_API_KEY) return
  const link = `${portalUrl()}${linkPath}`
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'CUBE Tuition <admin@cubetuition.com.au>',
      to: [process.env.SMS_ALERT_EMAIL || PORTAL_BCC],
      subject,
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#2A2035;max-width:560px">
        <p style="color:#555;margin:0 0 8px">${esc(who)} · ${esc(formatPhone(phone))}</p>
        ${bodyHtml}
        <p style="margin:16px 0 0"><a href="${link}" style="color:#325099;font-weight:600">Open in the portal →</a></p>
      </div>`,
    }),
  }).catch(() => {})
}

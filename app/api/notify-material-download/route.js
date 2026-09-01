import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'
import { PORTAL_BCC } from '../../../lib/emailConfig'

/*
 * POST /api/notify-material-download
 *
 * Emails the admin inbox when a tutor downloads a workbook or worksheet PDF,
 * with the reason they gave. Directors and admins download without a prompt,
 * and this route is never called for them.
 *
 * Who downloaded is taken from the VERIFIED token, never from the request body:
 * the body is written by the browser and a tutor could put any name in it.
 * The role is re-checked here too, so a tutor cannot skip the record by
 * claiming to be a director client-side.
 *
 * Unlike the other notify routes, a mail failure is reported rather than
 * swallowed. Elsewhere the thing being notified about is already saved and the
 * email is a courtesy; here the email IS the record, so the caller needs to
 * know it did not land and can hold the download back.
 *
 * Body: { title, filename, kind, reason }
 */
export const dynamic = 'force-dynamic'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(req) {
  const auth = await requireApiRole(req, ['admin', 'tutor', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { title, filename, kind, reason } = body || {}
  const cleanReason = String(reason || '').trim()
  if (!cleanReason) return Response.json({ error: 'A reason is required' }, { status: 400 })
  if (cleanReason.length > 2000) return Response.json({ error: 'Reason is too long' }, { status: 400 })

  // The name is looked up against the verified user id, so the email names
  // whoever actually holds the session. Falls back to the account email.
  let who = auth.user.email || 'Unknown staff member'
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
    const table = auth.role === 'tutor' ? 'tutors' : 'directors'
    let { data: p } = await sb.from(table).select('full_name').eq('id', auth.user.id).maybeSingle()
    if (!p && auth.user.email) {
      const { data: byEmail } = await sb.from(table).select('full_name').eq('email', auth.user.email).maybeSingle()
      p = byEmail
    }
    if (p?.full_name) who = `${p.full_name} (${auth.user.email})`
  } catch { /* the account email alone still identifies them */ }

  if (!process.env.RESEND_API_KEY) {
    // Nothing was recorded. Say so plainly rather than returning ok — the
    // caller decides whether to let the download through.
    return Response.json({ error: 'Email is not configured, so this download cannot be recorded.' }, { status: 503 })
  }

  const to = PORTAL_BCC
  const from = process.env.RESEND_FROM_EMAIL || 'CUBE Tuition <admin@cubetuition.com.au>'
  const doc = title || filename || 'Untitled document'
  const when = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'full', timeStyle: 'short' })

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:640px;line-height:1.5">
      <h2 style="color:#062E63;margin:0 0 2px">📥 Material downloaded — ${esc(doc)}</h2>
      <p style="color:#555;margin:0 0 14px;font-size:13px">
        ${esc(who)} · ${esc(auth.role)}${kind ? ` · ${esc(kind)}` : ''}
      </p>
      <p style="margin:0 0 6px;font-size:13px;font-weight:bold;color:#062E63">Reason given</p>
      <div style="font-size:13px;background:#F8FAFF;border:1px solid #DEE7FF;border-radius:8px;padding:10px 12px;white-space:pre-wrap">${esc(cleanReason)}</div>
      <table style="font-size:13px;margin-top:14px;border-collapse:collapse">
        <tr><td style="color:#888;padding:2px 12px 2px 0">File</td><td>${esc(filename || '—')}</td></tr>
        <tr><td style="color:#888;padding:2px 12px 2px 0">When</td><td>${esc(when)}</td></tr>
      </table>
      <p style="font-size:12px;color:#888;margin-top:16px">
        Sent because a tutor downloaded curriculum material from the portal. Directors and
        admins are not prompted and do not generate this email.
      </p>
    </div>`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: `Material downloaded: ${doc} — ${who}`, html }),
  })
  if (!resendRes.ok) {
    const t = await resendRes.text().catch(() => '')
    return Response.json({ error: `Could not send the notification: ${t}` }, { status: 502 })
  }
  return Response.json({ ok: true })
}

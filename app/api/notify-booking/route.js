import { createClient } from '@supabase/supabase-js'
import { T_DROPIN_SIGNINS } from '../../../lib/tables'
import { requireApiRole } from '../../../lib/apiAuth'
import { PORTAL_BCC } from '../../../lib/emailConfig'

/*
 * /api/notify-booking
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends a formatted email to bookings@cubetuition.com.au when a student books
 * OR cancels a drop-in session.
 *
 * POST body:
 *   { action: 'booked',    bookingId }              — looks up by ID
 *   { action: 'cancelled', snapshot: {...} }        — snapshot supplied by
 *                                                     client (row is gone
 *                                                     from DB after delete)
 *
 * If action is omitted, defaults to 'booked' (backward compat).
 *
 * Env vars:
 *   RESEND_API_KEY          required (skipped gracefully if missing)
 *   BOOKINGS_EMAIL_TO       defaults to bookings@cubetuition.com.au
 *   BOOKINGS_EMAIL_FROM     defaults to "CUBE Bookings <onboarding@resend.dev>"
 */

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const auth = await requireApiRole(request, null)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body?.action || 'booked'
  if (!['booked', 'cancelled'].includes(action)) {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  // ── Resolve booking details: lookup by id, OR use a snapshot supplied
  //    by the client (used for cancellations, since the row has been deleted)
  let booking
  if (body.snapshot) {
    // Skip demo bookings entirely
    if (String(body.snapshot.id || '').startsWith('__demo_booking__')) {
      return Response.json({ ok: true, emailed: false, reason: 'demo booking' })
    }
    booking = body.snapshot
  } else {
    const { bookingId } = body
    if (!bookingId) {
      return Response.json({ error: 'Missing bookingId' }, { status: 400 })
    }
    if (String(bookingId).startsWith('__demo_booking__')) {
      return Response.json({ ok: true, emailed: false, reason: 'demo booking' })
    }
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    const { data, error } = await supabase
      .from(T_DROPIN_SIGNINS)
      .select(`
        id, subject, question, signed_in_at,
        students (full_name, school, year, email),
        dropin_sessions (session_date, start_time, end_time, location, tutors)
      `)
      .eq('id', bookingId)
      .single()

    if (error || !data) {
      return Response.json({ error: 'Booking not found' }, { status: 404 })
    }
    booking = data
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('[notify-booking] RESEND_API_KEY not set — skipping email')
    return Response.json({ ok: true, emailed: false, reason: 'RESEND_API_KEY not set' })
  }

  const toEmail   = process.env.BOOKINGS_EMAIL_TO   || 'bookings@cubetuition.com.au'
  const fromEmail = process.env.BOOKINGS_EMAIL_FROM || 'CUBE Bookings <onboarding@resend.dev>'

  const student  = booking.students || booking.student || {}
  const session  = booking.dropin_sessions || booking.session || {}
  const subjects = (booking.subject || '').split(/\s*,\s*/).filter(Boolean)
  const isCancel = action === 'cancelled'

  const topicsHtml = formatTopicsHtml(booking.question)

  const subjLine = isCancel
    ? `Drop-in cancelled: ${student.full_name || 'Student'} — ${session.session_date}`
    : `New drop-in booking: ${student.full_name || 'Student'} — ${session.session_date}`

  const timestamp = new Date(booking.signed_in_at || Date.now()).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  // Visual tokens differ slightly so the inbox card reads at a glance.
  const accent = isCancel
    ? { gradient: 'linear-gradient(90deg,#FEE2E2,#FECACA,#FCA5A5)', label: 'Drop-in cancellation', heading: `${escapeHtml(student.full_name || 'A student')} cancelled` }
    : { gradient: 'linear-gradient(90deg,#F8FAFF,#EEF4FF,#BFD1FF)', label: 'Drop-in booking',     heading: `${escapeHtml(student.full_name || 'A student')} booked a session` }

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F8FAFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#2A2035">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFF;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #DEE7FF;border-radius:16px;overflow:hidden;max-width:600px">
        <tr><td style="background:${accent.gradient};padding:24px 28px">
          <div style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:${isCancel ? '#991B1B' : '#325099'};font-weight:600;margin-bottom:6px">CUBE Tuition · ${accent.label}</div>
          <h1 style="margin:0;font-size:22px;color:#2A2035;font-weight:700">${accent.heading}</h1>
        </td></tr>
        <tr><td style="padding:24px 28px">
          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#325099;font-weight:600;margin-bottom:6px">Student</div>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600">${escapeHtml(student.full_name || '—')}</p>
          <p style="margin:0 0 16px;font-size:13px;color:#2A2035;opacity:0.7">
            ${escapeHtml(student.school || '')}${student.year ? ` · Year ${escapeHtml(student.year)}` : ''}
            ${student.email ? `<br><a href="mailto:${escapeHtml(student.email)}" style="color:#325099;text-decoration:none">${escapeHtml(student.email)}</a>` : ''}
          </p>

          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#325099;font-weight:600;margin-bottom:6px">Session</div>
          <p style="margin:0 0 16px;font-size:15px">
            ${escapeHtml(session.session_date || '—')} · ${escapeHtml((session.start_time||'').slice(0,5))}–${escapeHtml((session.end_time||'').slice(0,5))}<br>
            <span style="color:#2A2035;opacity:0.7">${escapeHtml(session.location || 'Chatswood centre')}</span>
          </p>

          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#325099;font-weight:600;margin-bottom:6px">Subject${subjects.length > 1 ? 's' : ''}</div>
          <p style="margin:0 0 16px">
            ${subjects.map(s => `<span style="display:inline-block;background:${isCancel ? '#FEE2E2' : '#DEE7FF'};color:${isCancel ? '#991B1B' : '#062E63'};font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;margin-right:6px;margin-bottom:4px;text-decoration:${isCancel ? 'line-through' : 'none'}">${escapeHtml(s)}</span>`).join('')}
          </p>

          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#325099;font-weight:600;margin-bottom:6px">Topics${isCancel ? ' (now cancelled)' : ''}</div>
          <div style="background:#F8FAFF;border:1px solid #DEE7FF;border-radius:12px;padding:14px 16px">${topicsHtml}</div>

          <p style="margin:24px 0 0;font-size:11px;color:#2A2035;opacity:0.5">${isCancel ? 'Cancelled' : 'Booked'} ${escapeHtml(timestamp)} (Sydney time) · CUBE Tuition Portal</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const text = [
    isCancel ? 'Drop-in cancellation' : 'New drop-in booking',
    '',
    `Student:  ${student.full_name || '—'}`,
    `School:   ${student.school || '—'}${student.year ? ` · Year ${student.year}` : ''}`,
    student.email ? `Email:    ${student.email}` : null,
    '',
    `Session:  ${session.session_date} · ${(session.start_time||'').slice(0,5)}–${(session.end_time||'').slice(0,5)}`,
    `Location: ${session.location || 'Chatswood centre'}`,
    '',
    `Subject${subjects.length > 1 ? 's' : ''}: ${subjects.join(', ') || '—'}`,
    '',
    `Topics${isCancel ? ' (cancelled)' : ''}:`,
    booking.question || '(none)',
    '',
    `${isCancel ? 'Cancelled' : 'Booked'} ${timestamp} (Sydney time)`,
  ].filter(Boolean).join('\n')

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        bcc: [PORTAL_BCC],
        subject: subjLine,
        html,
        text,
      }),
    })
    if (!resp.ok) {
      const errText = await resp.text()
      console.error('[notify-booking] Resend error:', resp.status, errText)
      return Response.json({ ok: false, error: errText }, { status: 502 })
    }
    return Response.json({ ok: true, emailed: true, action })
  } catch (e) {
    console.error('[notify-booking] Send failed:', e)
    return Response.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatTopicsHtml(text) {
  if (!text) return '<span style="color:#2A2035;opacity:0.5">(none)</span>'
  const sections = []
  const re = /\[([^\]]+)\]\n?/g
  const matches = [...text.matchAll(re)]
  if (matches.length === 0) {
    return `<p style="margin:0;line-height:1.5;white-space:pre-wrap">${escapeHtml(text)}</p>`
  }
  for (let i = 0; i < matches.length; i++) {
    const header = matches[i][1]
    const start = matches[i].index + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    const body = text.slice(start, end).trim()
    sections.push(`
      <p style="margin:${i === 0 ? '0' : '12px 0 4px'};font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#325099;font-weight:600">${escapeHtml(header)}</p>
      <p style="margin:0;line-height:1.5;white-space:pre-wrap">${escapeHtml(body)}</p>
    `)
  }
  return sections.join('')
}

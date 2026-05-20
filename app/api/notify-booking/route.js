import { createClient } from '@supabase/supabase-js'

/*
 * /api/notify-booking
 * ─────────────────────────────────────────────────────────────────────────────
 * POST { bookingId } — looks up the dropin_signins row + linked student +
 * session, then sends a formatted email to bookings@cubetuition.com.au via
 * Resend.
 *
 * Called by the portal in fire-and-forget mode right after a successful
 * client-side insert — so it can't slow the booking confirmation down, and
 * email failures don't break the booking itself.
 *
 * Env vars:
 *   RESEND_API_KEY          required to actually send (skipped gracefully
 *                           if missing — booking still works)
 *   BOOKINGS_EMAIL_TO       defaults to bookings@cubetuition.com.au
 *   BOOKINGS_EMAIL_FROM     defaults to "CUBE Bookings <onboarding@resend.dev>"
 *                           (works without domain verification while you set
 *                           up DNS; once cubetuition.com.au is verified in
 *                           Resend, switch to "CUBE Bookings <bookings@cubetuition.com.au>")
 */

export const dynamic = 'force-dynamic'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { bookingId } = body || {}
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

  const { data: booking, error } = await supabase
    .from('dropin_signins')
    .select(`
      id, subject, question, signed_in_at,
      students (full_name, school, school_year, email),
      dropin_sessions (session_date, start_time, end_time, location, tutors)
    `)
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    return Response.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('[notify-booking] RESEND_API_KEY not set — skipping email')
    return Response.json({ ok: true, emailed: false, reason: 'RESEND_API_KEY not set' })
  }

  const toEmail   = process.env.BOOKINGS_EMAIL_TO   || 'bookings@cubetuition.com.au'
  const fromEmail = process.env.BOOKINGS_EMAIL_FROM || 'CUBE Bookings <onboarding@resend.dev>'

  const student = booking.students || {}
  const session = booking.dropin_sessions || {}
  const subjects = (booking.subject || '').split(/\s*,\s*/).filter(Boolean)

  // Pretty-format the topics. We saved them as either plain text (single
  // subject) or "[Subject]\ntext\n\n[Subject]\ntext" (multi-subject).
  const topicsHtml = formatTopicsHtml(booking.question)

  const subjLine = `New drop-in booking: ${student.full_name || 'Student'} — ${session.session_date}`
  const bookedAt = new Date(booking.signed_in_at).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F8FAFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#2A2035">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFF;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #DEE7FF;border-radius:16px;overflow:hidden;max-width:600px">
        <tr><td style="background:linear-gradient(90deg,#F8FAFF,#EEF4FF,#BFD1FF);padding:24px 28px">
          <div style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#325099;font-weight:600;margin-bottom:6px">CUBE Tuition · Drop-in booking</div>
          <h1 style="margin:0;font-size:22px;color:#2A2035;font-weight:700">${escapeHtml(student.full_name || 'A student')} booked a session</h1>
        </td></tr>
        <tr><td style="padding:24px 28px">
          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#325099;font-weight:600;margin-bottom:6px">Student</div>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600">${escapeHtml(student.full_name || '—')}</p>
          <p style="margin:0 0 16px;font-size:13px;color:#2A2035;opacity:0.7">
            ${escapeHtml(student.school || '')}${student.school_year ? ` · Year ${escapeHtml(student.school_year)}` : ''}
            ${student.email ? `<br><a href="mailto:${escapeHtml(student.email)}" style="color:#325099;text-decoration:none">${escapeHtml(student.email)}</a>` : ''}
          </p>

          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#325099;font-weight:600;margin-bottom:6px">Session</div>
          <p style="margin:0 0 16px;font-size:15px">
            ${escapeHtml(session.session_date || '—')} · ${escapeHtml((session.start_time||'').slice(0,5))}–${escapeHtml((session.end_time||'').slice(0,5))}<br>
            <span style="color:#2A2035;opacity:0.7">${escapeHtml(session.location || 'Chatswood centre')}</span>
          </p>

          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#325099;font-weight:600;margin-bottom:6px">Subject${subjects.length > 1 ? 's' : ''}</div>
          <p style="margin:0 0 16px">
            ${subjects.map(s => `<span style="display:inline-block;background:#DEE7FF;color:#062E63;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;margin-right:6px;margin-bottom:4px">${escapeHtml(s)}</span>`).join('')}
          </p>

          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#325099;font-weight:600;margin-bottom:6px">Topics</div>
          <div style="background:#F8FAFF;border:1px solid #DEE7FF;border-radius:12px;padding:14px 16px">${topicsHtml}</div>

          <p style="margin:24px 0 0;font-size:11px;color:#2A2035;opacity:0.5">Booked ${escapeHtml(bookedAt)} (Sydney time) · CUBE Tuition Portal</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  // Plain-text fallback for clients that prefer it
  const text = [
    `New drop-in booking`,
    ``,
    `Student:  ${student.full_name || '—'}`,
    `School:   ${student.school || '—'}${student.school_year ? ` · Year ${student.school_year}` : ''}`,
    student.email ? `Email:    ${student.email}` : null,
    ``,
    `Session:  ${session.session_date} · ${(session.start_time||'').slice(0,5)}–${(session.end_time||'').slice(0,5)}`,
    `Location: ${session.location || 'Chatswood centre'}`,
    ``,
    `Subject${subjects.length > 1 ? 's' : ''}: ${subjects.join(', ') || '—'}`,
    ``,
    `Topics:`,
    booking.question || '(none)',
    ``,
    `Booked ${bookedAt} (Sydney time)`,
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
    return Response.json({ ok: true, emailed: true })
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

// Convert "[Subject]\ntext\n\n[Subject]\ntext" → grouped HTML blocks.
// Single-subject bookings are rendered as a single paragraph.
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

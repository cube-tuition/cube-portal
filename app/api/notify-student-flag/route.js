import { requireApiRole } from '../../../lib/apiAuth'
import { sendPushToAll } from '../../../lib/push'

/*
 * POST /api/notify-student-flag
 * Tells the directors when a tutor flags a student from the lesson page: a
 * push to their phones (the iPhone app and web push) and an email to the
 * admin inbox. Caller must be staff. Both are best effort — the flag itself
 * is already saved and listed on /tutor/flags, so a push or mail outage must
 * never look like a lost concern.
 *
 * Body: { studentName, className, lessonDate, reason, reasonLabel, note, raisedBy }
 */
export const dynamic = 'force-dynamic'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function fmtDate(d) {
  if (!d) return ''
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-AU',
      { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return String(d) }
}

// Wellbeing gets the urgent treatment in the email too, matching how the
// Action Centre ranks it (lib/studentFlags.js).
const URGENT = new Set(['wellbeing'])

export async function POST(req) {
  const auth = await requireApiRole(req, ['admin', 'tutor', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const to = 'cubehsctuition@gmail.com'
  const from = process.env.RESEND_FROM_EMAIL || 'CUBE Tuition <admin@cubetuition.com.au>'

  const { studentName, className, lessonDate, reason, reasonLabel, note, raisedBy } = body || {}
  if (!studentName || !reason) {
    return Response.json({ error: 'studentName and reason are required' }, { status: 400 })
  }

  const urgent = URGENT.has(reason)
  const label = reasonLabel || reason
  const dateLabel = fmtDate(lessonDate)
  const context = [className, dateLabel].filter(Boolean).join(' · ')

  // The push first — it is what the directors see straight away.
  const pushed = await sendPushToAll({
    title: `${urgent ? '🚨' : '🚩'} ${studentName} flagged — ${label}`,
    body: [note, [context, raisedBy && `raised by ${raisedBy}`].filter(Boolean).join(' · ')].filter(Boolean).join('\n') || 'No further detail given.',
    url: '/tutor/flags', tag: `flag-${studentName}-${reason}-${lessonDate || ''}`,
  }).then(r => r?.sent ?? 0).catch(() => 0)

  if (!process.env.RESEND_API_KEY) return Response.json({ ok: true, pushed, emailed: false })

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:640px;line-height:1.5">
      <h2 style="color:#062E63;margin:0 0 2px">🚩 Student flagged — ${esc(studentName)}</h2>
      <p style="color:#555;margin:0 0 14px;font-size:13px">
        ${esc(context)}${context && raisedBy ? ' · ' : ''}${raisedBy ? `raised by ${esc(raisedBy)}` : ''}
      </p>
      <p style="margin:0 0 12px">
        <span style="display:inline-block;font-size:13px;font-weight:bold;padding:4px 12px;border-radius:999px;
          background:${urgent ? '#FEE2E2' : '#FEF3C7'};color:${urgent ? '#991B1B' : '#92400E'};
          border:1px solid ${urgent ? '#FECACA' : '#FDE68A'}">${esc(label)}</span>
      </p>
      ${note
        ? `<div style="font-size:13px;background:#F8FAFF;border:1px solid #DEE7FF;border-radius:8px;padding:10px 12px;white-space:pre-wrap">${esc(note)}</div>`
        : '<p style="font-size:13px;color:#888">No further detail was given.</p>'}
      <p style="font-size:12px;color:#888;margin-top:16px">
        Open flags are listed on the portal’s Flags page (/tutor/flags) until a director resolves them.
      </p>
    </div>`

  const subject = `${urgent ? '[Urgent] ' : ''}Student flagged: ${studentName} — ${label}`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
  if (!resendRes.ok) {
    const t = await resendRes.text().catch(() => '')
    return Response.json({ error: `Resend error: ${t}`, pushed }, { status: 502 })
  }
  return Response.json({ ok: true, pushed, emailed: true })
}

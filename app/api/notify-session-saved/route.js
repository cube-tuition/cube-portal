import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/notify-session-saved
 * Emails a fixed admin inbox a full breakdown whenever a tutor saves a session.
 * Caller must be staff (admin/tutor/director). Sends via Resend; skips quietly
 * if email isn't configured so a save is never blocked on email delivery.
 *
 * Body: {
 *   className, date (YYYY-MM-DD), week, markedBy,
 *   notes: { general, workbook, homework },
 *   students: [{ name, attendance, comment, homework, quiz, trialFeedback }]
 * }
 */
export const dynamic = 'force-dynamic'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function fmtDate(d) {
  if (!d) return ''
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return String(d) }
}

export async function POST(req) {
  const auth = await requireApiRole(req, ['admin', 'tutor', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!process.env.RESEND_API_KEY) return Response.json({ ok: false, skipped: 'email not configured' })

  const to = process.env.SESSION_EMAIL_TO || 'admin@cubetuition.com.au'
  const from = process.env.RESEND_FROM_EMAIL || 'CUBE Tuition <admin@cubetuition.com.au>'

  const { className, date, week, markedBy, hasRq = true, notes = {}, students = [] } = body || {}
  const dateLabel = fmtDate(date)
  const quizCol = !!hasRq   // a 'No RQ' session drops the Quiz column

  const rows = (students || []).map((s) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(s.name)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-transform:capitalize">${esc(s.attendance || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(s.homework || '—')}</td>
      ${quizCol ? `<td style="padding:6px 8px;border-bottom:1px solid #eee">${(s.quiz != null && s.quiz !== '') ? esc(s.quiz) + '%' : '—'}</td>` : ''}
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(s.comment || '')}${s.trialFeedback ? `<br/><em style="color:#b45309">Trial: ${esc(s.trialFeedback)}</em>` : ''}</td>
    </tr>`).join('')

  const studentsTable = students.length ? `
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:6px">
      <thead><tr style="text-align:left;color:#555">
        <th style="padding:6px 8px;border-bottom:2px solid #ddd">Student</th>
        <th style="padding:6px 8px;border-bottom:2px solid #ddd">Attendance</th>
        <th style="padding:6px 8px;border-bottom:2px solid #ddd">Homework</th>
        ${quizCol ? '<th style="padding:6px 8px;border-bottom:2px solid #ddd">Quiz</th>' : ''}
        <th style="padding:6px 8px;border-bottom:2px solid #ddd">Comment</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>` : '<p style="font-size:13px;color:#888">No per-student marks entered.</p>'

  const noRqNote = quizCol ? '' : '<p style="font-size:13px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin:10px 0 0">No revision quiz this week.</p>'

  const noteBlock = (label, val) => val ? `<p style="margin:4px 0;font-size:13px"><strong>${esc(label)}:</strong> ${esc(val)}</p>` : ''
  const notesHtml = [noteBlock('General', notes.general), noteBlock('Workbook', notes.workbook), noteBlock('Homework', notes.homework)].join('')

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:640px;line-height:1.5">
      <h2 style="color:#062E63;margin:0 0 2px">Session saved — ${esc(className) || 'Class'}</h2>
      <p style="color:#555;margin:0 0 14px;font-size:13px">${esc(dateLabel)}${week ? ` · ${esc(week)}` : ''} · marked by ${esc(markedBy || '—')}</p>
      <h3 style="font-size:14px;color:#325099;margin:14px 0 4px">Student marks</h3>
      ${studentsTable}
      ${noRqNote}
      ${notesHtml ? `<h3 style="font-size:14px;color:#325099;margin:16px 0 4px">Notes to CUBE</h3>${notesHtml}` : ''}
    </div>`

  const subject = `Session saved: ${className || 'Class'} — ${dateLabel}`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
  if (!resendRes.ok) {
    const t = await resendRes.text().catch(() => '')
    return Response.json({ error: `Resend error: ${t}` }, { status: 502 })
  }
  return Response.json({ ok: true })
}

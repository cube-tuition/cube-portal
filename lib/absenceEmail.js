/*
 * Absence emails — sent to a family from an absence case on the Absences
 * page (/tutor/admin/monitoring/attendance/absences).
 *
 *   options    the student missed (or will miss) a lesson; here are sessions
 *              they can join to catch up — reply with the one that suits
 *   confirmed  a makeup is booked: when and where
 *   message    a plain message, for anything else
 *
 * Pure functions: the case panel renders the same HTML for its preview as the
 * send route puts in the email, so what a director approves is what goes out.
 * Text blocks are editable before sending; **bold** and line breaks carry over.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const rich = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\n/g, '<br/>')

export function fillAbsenceVars(text, v = {}) {
  return String(text ?? '')
    .replace(/\{\{parent_name\}\}/g,  v.parentName  || 'there')
    .replace(/\{\{student_name\}\}/g, v.studentName || 'your child')
    .replace(/\{\{class_name\}\}/g,   v.className   || 'class')
    .replace(/\{\{date\}\}/g,         v.date        || 'the lesson')
}

// `ahead` = the session hasn't happened yet (the family gave notice), which
// changes how the options email opens.
export function defaultAbsenceContent(kind, { ahead = false } = {}) {
  if (kind === 'confirmed') {
    return {
      subject: 'Makeup lesson booked for {{student_name}}',
      body: 'Hi {{parent_name}},\n\nWe’ve booked a makeup lesson for {{student_name}} to cover {{class_name}} on {{date}}. The details are below — see you then!',
      boxHeading: 'Makeup lesson',
    }
  }
  if (kind === 'message') {
    return {
      subject: 'About {{student_name}}’s lesson on {{date}}',
      body: 'Hi {{parent_name}},\n\n',
      boxHeading: '',
    }
  }
  return {
    subject: ahead
      ? 'Catching up on {{student_name}}’s {{class_name}} lesson'
      : '{{student_name}} missed {{class_name}} on {{date}}',
    body: ahead
      ? 'Hi {{parent_name}},\n\nThanks for letting us know {{student_name}} will miss {{class_name}} on {{date}}. So they don’t fall behind, they’re welcome to join one of the sessions below instead.\n\nJust **reply with the one that suits** and we’ll book it in.'
      : 'Hi {{parent_name}},\n\nWe missed {{student_name}} at {{class_name}} on {{date}} — we hope everything is okay. So they don’t fall behind, they’re welcome to catch up at one of the sessions below.\n\nJust **reply with the one that suits** and we’ll book it in.',
    boxHeading: 'Sessions they can join',
  }
}

const NAVY = '#062E63'
const BLUE = '#325099'
const INK  = '#2A2035'

/*
 * Build the email.
 *   vars     { parentName, studentName, className, date }
 *   content  { subject, body, boxHeading }
 *   items    lines for the box: session labels (options) or the booking (confirmed)
 */
export function buildAbsenceEmailHtml(vars = {}, content = {}, items = []) {
  const body = rich(fillAbsenceVars(content.body, vars))
  const lines = (items || []).filter(Boolean)
  const box = lines.length ? `
    <div style="margin:22px 0 0;background:#F0F4FF;border:1px solid #DEE7FF;border-radius:12px;padding:16px 20px;">
      ${content.boxHeading ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${NAVY};">${esc(fillAbsenceVars(content.boxHeading, vars))}</p>` : ''}
      ${lines.map(l => `<p style="margin:0 0 6px;font-size:14.5px;line-height:1.6;color:${INK};">• ${esc(l)}</p>`).join('')}
    </div>` : ''

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:${INK};background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
    <div style="background:linear-gradient(120deg,#04204a 0%,${NAVY} 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:30px;">
      <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
      <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
    </div>
    <p style="margin:0;font-size:15px;line-height:1.7;">${body}</p>
    ${box}
    <p style="margin:28px 0 0;font-size:15px;line-height:1.7;">Kind regards,<br/>The CUBE Team</p>
    <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:${BLUE};opacity:0.6;">You can reply to this email directly.</p>
  </div>
  </body></html>`
}

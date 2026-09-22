/*
 * Holiday Courses — promotional emails for a holiday intensive. Shared by the
 * /tutor/emails/holiday-courses page (preview) and the send route.
 *
 * A template is plain text fields with {{parent_name}} / {{student_names}}
 * placeholders and **bold**, plus one block per subject and an "Enrol now"
 * button that opens the sign-up form. Pure functions — safe on client and server.
 */

export const HOLIDAY_SUBJECTS = ['Mathematics', 'English', 'Chemistry', 'Physics', 'Science']
export const HOLIDAY_YEARS    = [3, 5, 6, 7, 8, 9, 10, 11, 12]   // no Year 4 — CUBE doesn't teach it
export const STUDENT_STATUSES = ['active', 'trial', 'pending', 'inactive']

export function fillTemplate(text, vars = {}) {
  return (text || '')
    .replace(/\{\{parent_name\}\}/g,   vars.parentName   || 'there')
    .replace(/\{\{student_names\}\}/g, vars.studentNames || 'your child')
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Escaped text with **bold** and line breaks honoured.
const inline = (text, vars) => esc(fillTemplate(text, vars))
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>')
// Blank-line separated paragraphs.
const paragraphs = (text, vars) => (fillTemplate(text, vars) || '').split(/\n\n+/).filter(b => b.trim())
  .map(b => `<p style="margin:0 0 16px 0;line-height:1.7;">${esc(b).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>')}</p>`).join('')

const box = (heading, bodyHtml) => `
      <div style="margin:22px 0;background:#F0F4FF;border:1px solid #DEE7FF;border-radius:12px;padding:18px 20px;">
        ${heading ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#062E63;text-transform:uppercase;letter-spacing:0.6px;">${esc(heading)}</p>` : ''}
        <div style="font-size:14px;line-height:1.7;color:#2A2035;">${bodyHtml}</div>
      </div>`

// The email body for one family. `tpl` is a holiday_course_emails row (or the
// page's draft of one); `vars` = { parentName, studentNames }.
export function buildHolidayCourseEmailHtml(tpl = {}, vars = {}) {
  const courses = (tpl.courses || []).filter(c => (c.title || '').trim())
  const courseHtml = courses.map(c => `
      <div style="margin:0 0 18px 0;padding:0 0 18px 0;border-bottom:1px solid #EEF2FB;">
        <p style="margin:0 0 2px;font-size:16px;font-weight:700;color:#062E63;">${inline(c.title, vars)}</p>
        ${(c.time || '').trim() ? `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#325099;">${inline(c.time, vars)}</p>` : ''}
        ${(c.blurb || '').trim() ? `<p style="margin:0;font-size:14px;line-height:1.7;color:#2A2035;">${inline(c.blurb, vars)}</p>` : ''}
      </div>`).join('')
  const feeLines = (tpl.fees || '').split('\n').map(l => l.trim()).filter(Boolean)
  const feesHtml = feeLines.length
    ? box('Course fees', `<ul style="margin:0;padding-left:18px;">${feeLines.map(l => `<li style="margin:0 0 4px;">${inline(l, vars)}</li>`).join('')}</ul>`)
    : ''
  const datesHtml = (tpl.dates_line || '').trim() ? box('Dates', inline(tpl.dates_line, vars)) : ''
  const url = (tpl.enrol_url || '').trim()
  const button = url ? `
      <div style="text-align:center;margin:28px 0 24px;">
        <a href="${esc(url)}" style="display:inline-block;background:#062E63;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.4px;padding:14px 34px;border-radius:10px;">${esc((tpl.enrol_label || 'Enrol now').trim() || 'Enrol now')}</a>
      </div>` : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;background:linear-gradient(120deg,#04204a 0%,#062E63 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:32px;">
        <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
        <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
      </div>
      <div style="font-size:15px;">
        ${paragraphs(tpl.intro, vars)}
        ${datesHtml}
        ${courseHtml}
        ${feesHtml}
        ${paragraphs(tpl.closing, vars)}
        ${button}
        ${paragraphs(tpl.signoff, vars)}
      </div>
    </div>
  </body></html>`
}

// Filler starter template — the Year 6 intensive — until the holiday classes
// exist to link to. Every field is editable on the page.
export const DEFAULT_HOLIDAY_TEMPLATE = () => ({
  name: 'Year 6 Holiday Intensive',
  email_subject: 'A head start on Year 7 for {{student_names}} — Year 6 Holiday Intensive',
  intro: `Dear {{parent_name}},

Year 7 is a big step, and the first weeks set the tone. CUBE's six-day **Year 6 Holiday Intensive** gives {{student_names}} a confident head start in the two subjects that matter most.`,
  dates_line: 'Monday 28 September to Saturday 3 October — six consecutive days, at the same times each day.',
  courses: [
    { class_id: null, title: 'Mathematics: Head Start on Algebra', time: '9:30 – 11:00 am, daily',
      blurb: 'Algebraic expressions, equations and problem-solving strategies — the foundation of high school mathematics.' },
    { class_id: null, title: 'English: Head Start on Australian Poetry', time: '11:30 am – 1:00 pm, daily',
      blurb: 'A study of Australian poetry that builds high school skills: language techniques, analytical paragraph writing and essay-style analysis.' },
  ],
  fees: `One subject: $340 by bank transfer, or $300 cash
Both subjects: $600 by bank transfer, or $550 cash`,
  closing: 'Classes are kept small so every student gets real attention — which means places are limited.',
  enrol_url: '',
  enrol_label: 'Enrol now',
  signoff: `Kind regards,
The CUBE Team`,
  term_id: null,
  year_levels: [6], requires_subjects: [], excludes_subjects: [], statuses: ['active', 'trial'],
})

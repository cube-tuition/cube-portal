/*
 * Course Offers — promotional emails pitching a course to a targeted cohort
 * (e.g. Maths to English-only students, Chemistry to Year 10). Shared by the
 * /tutor/emails/course-offers page (preview) and the send route.
 *
 * Subjects are the canonical names from components/CourseDetail's inferSubject.
 */

export const OFFER_SUBJECTS = ['Mathematics', 'English', 'Chemistry', 'Physics', 'Science']
export const OFFER_YEARS    = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export function fillOfferTemplate(text, vars = {}) {
  return (text || '')
    .replace(/\{\{parent_name\}\}/g,   vars.parentName   || 'there')
    .replace(/\{\{student_names\}\}/g, vars.studentNames || 'your child')
}

// Wrap the plain-text body (with {{placeholders}} and **bold**) in the CUBE
// branded email shell. Pure function — safe on both client and server.
export function buildCourseOfferEmailHtml(body, vars = {}) {
  const filled = fillOfferTemplate(body, vars)
  const escaped = filled.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paragraphs = escaped
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 16px 0;line-height:1.7;">${p.replace(/\n/g, '<br/>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`)
    .join('')
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;background:linear-gradient(120deg,#04204a 0%,#062E63 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:32px;">
        <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
        <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
      </div>
      <div style="font-size:15px;">${paragraphs}</div>
    </div>
  </body></html>`
}

// Starter body for a new offer.
export const DEFAULT_OFFER_BODY = `Hi {{parent_name}},

We've loved having {{student_names}} at CUBE, and wanted to let you know about a course we think would be a great fit.

[Write a short overview of the course here — what it covers, who teaches it, and why it helps.]

**Special offer this term:** [describe the discount, e.g. 20% off the first term].

If you'd like to know more or book a trial lesson, just reply to this email.

Kind regards,
The CUBE Team`

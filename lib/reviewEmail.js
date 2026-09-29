/*
 * "Leave us a Google review" email. Shared by the send route and the
 * /tutor/emails/reviews page, so the preview is exactly what is sent.
 *
 * One email per family. Every field is editable on the page and saved in
 * portal_settings ('review_email_content'). In the bodies, {{parent_name}}
 * and {{student_names}} are filled per family, **bold** is bold, and
 * [label](https://…) is a link. The button always points at `reviewUrl`.
 *
 * Deliberately no incentive of any kind: Google's policy forbids offering
 * anything for a review, and the ACCC treats undisclosed incentivised reviews
 * as potentially misleading.
 */

const BLUE_DARK = '#062E63'
const BLUE      = '#325099'
const INK       = '#2A2035'

export const REVIEW_CONTENT_KEY = 'review_email_content'
export const REVIEW_LOG_KEY     = 'review_request_log'   // { [email]: { asked } } ISO date

export const DEFAULT_REVIEW_CONTENT = {
  reviewUrl: '',
  subject: 'Would you share a quick review of CUBE? ⭐',
  body: `Hi {{parent_name}},

Thank you for being part of CUBE this term — it’s been a real pleasure teaching {{student_names}}.

If you’ve found our classes helpful, we’d be really grateful if you could share a quick Google review. It only takes a minute, and it makes a real difference to a small tuition centre like ours — it’s how most new families find us.

A sentence or two is plenty — for example, what’s changed for {{student_names}} since starting at CUBE.`,
  ctaLabel: 'Leave a Google review ⭐',
  ctaNote: 'Thank you — we read every single review.',
  signoff: 'Kind regards,\nThe CUBE Team',
}

export const mergeReviewContent = (overrides) => ({ ...DEFAULT_REVIEW_CONTENT, ...(overrides || {}) })

// A review link has to be a real https link — it is the whole point of the email.
export const isValidReviewUrl = (u) => /^https:\/\/\S+\.\S+/.test(String(u || '').trim())

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// escape → **bold** → [label](url) (http/https/mailto only) → line breaks
const rich = (s) => escHtml(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_m, label, href) => `<a href="${href}" style="color:${BLUE};font-weight:700;">${label}</a>`)
  .replace(/\n/g, '<br/>')

function joinNames(names) {
  if (names.length <= 1) return names[0] || ''
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

// First names, de-duplicated, as "Aiden", "Aiden and Mia", "Aiden, Mia and Leo".
export const studentNamesFor = (fullNames = []) =>
  joinNames([...new Set(fullNames.map(n => String(n || '').trim().split(/\s+/)[0]).filter(Boolean))])

const fill = (text, vars) => String(text || '')
  .replace(/\{\{parent_name\}\}/g, vars.parentName || 'there')
  .replace(/\{\{student_names\}\}/g, vars.studentNames || 'your child')

export function reviewEmailSubject(overrides) {
  return mergeReviewContent(overrides).subject
}

export function buildReviewEmailHtml({ parentName, studentNames }, overrides) {
  const c = mergeReviewContent(overrides)
  const body = fill(c.body, { parentName, studentNames })
  const paragraphs = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="margin:0 0 16px 0;line-height:1.7;">${rich(p)}</p>`).join('')
  const url = String(c.reviewUrl || '').trim()
  const button = isValidReviewUrl(url)
    ? `<div style="text-align:center;margin:28px 0 8px;">
        <a href="${escHtml(url)}" style="display:inline-block;background:${BLUE};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 34px;border-radius:10px;">${rich(c.ctaLabel)}</a>
      </div>
      ${c.ctaNote ? `<p style="margin:0 0 24px 0;text-align:center;font-size:12px;color:${INK};opacity:0.55;">${rich(c.ctaNote)}</p>` : ''}`
    : `<p style="margin:24px 0;text-align:center;font-size:12px;color:#b23a3a;">[Review link not set yet]</p>`
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:${INK};background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
    <div style="background:${BLUE_DARK};background:linear-gradient(120deg,#04204a 0%,${BLUE_DARK} 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:32px;">
      <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
      <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
    </div>
    <div style="font-size:15px;">${paragraphs}</div>
    ${button}
    <p style="margin:0;line-height:1.7;font-size:15px;">${rich(c.signoff)}</p>
  </div>
</body></html>`
}

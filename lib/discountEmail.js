/*
 * CUBE discount-program marketing email template (referral-led).
 * Shared by the send API route and the /tutor/emails/discount-program page.
 *
 * Every text block is editable on the page: content overrides are merged over
 * DEFAULT_DISCOUNT_CONTENT, persisted in portal_settings ('discount_email_content')
 * and passed to the send API. **bold** in any field renders as bold; line
 * breaks become new lines; fine-print lines become bullets.
 */

const BLUE_DARK = '#062E63'
const BLUE      = '#325099'
const BLUE_SOFT = '#DEE7FF'
const BG_SOFT   = '#F0F4FF'
const INK       = '#2A2035'

export const DEFAULT_DISCOUNT_CONTENT = {
  subject:          'Save $50 every time you share CUBE 🎁 — plus sibling & multi-course discounts',
  heroTitle:        'Share CUBE, and you both save.',
  intro:            'Great teaching travels by word of mouth — and we’d love to thank you for it. Here’s every way your family can save at CUBE this term.',
  referralHeadline: '$50 off — for both families',
  referralBody:     'For every family you refer who enrols and begins classes, **you get $50 off** your term fees and **they get $50 off** theirs. There’s no limit — refer three families, save $150.',
  step1:            'Tell a friend about CUBE and email us the student’s name (e.g. “I’ve referred Ryan Park, Year 9”) — or they can put your name in the **“Referred by”** box on the free-trial form.',
  step2:            'They try a **free trial lesson** and enrol for the term.',
  step3:            'We apply **$50 off for both families** on the next invoice — automatically.',
  multiTitle:       'Multi-Course Discount',
  multiBody:        '2 courses → **$100 off** total\n3 courses → **$150 off** total',
  siblingTitle:     'Sibling Discount',
  siblingBody:      '**$50 off per sibling** when siblings are enrolled together.',
  formsNote:        'Adding a course or sibling? Use the **re-enrolment form** (returning) or the **free-trial form** (new) and we’ll match the details on your invoice automatically.',
  finePrint:        'Referrals count once the new student is fully enrolled for the term, and must be new families to CUBE.\nIf discounts exceed your term fee, the balance carries forward as credit.\nAlready paid? The discount applies to your next bill — or is issued as cash if you finish up before then.',
  ctaLabel:         'Refer a family →',
  ctaNote:          'Just reply to this email with the student’s name — that’s it.',
}

// Backwards-compatible name (older callers passed just the intro string)
export const DEFAULT_DISCOUNT_INTRO = DEFAULT_DISCOUNT_CONTENT.intro

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// escape, then **bold** → <strong>, newline → <br/>
const rich = (s) => escHtml(s)
  .replace(/\*\*(.+?)\*\*/g, `<strong style="color:inherit;">$1</strong>`)
  .replace(/\n/g, '<br/>')

// White strong text variant for the dark hero card
const richOnDark = (s) => escHtml(s)
  .replace(/\*\*(.+?)\*\*/g, `<strong style="color:#ffffff;">$1</strong>`)
  .replace(/\n/g, '<br/>')

const paragraphs = (s, color = INK) => {
  const text = String(s ?? '').trim()
  if (!text) return ''
  return text.split(/\n\s*\n/).map((p, i, arr) =>
    `<p style="margin:0 ${i < arr.length - 1 ? '0 12px' : ''};font-size:15px;line-height:1.7;color:${color};">${rich(p)}</p>`
  ).join('')
}

export function mergeDiscountContent(overrides) {
  const merged = { ...DEFAULT_DISCOUNT_CONTENT }
  for (const [k, v] of Object.entries(overrides || {})) {
    if (typeof v === 'string' && v.trim() !== '' && k in merged) merged[k] = v
  }
  return merged
}

export function buildDiscountEmailHtml(parentName, contentOverrides) {
  // Back-compat: a plain string is treated as the intro
  const overrides = typeof contentOverrides === 'string'
    ? { intro: contentOverrides } : contentOverrides
  const c = mergeDiscountContent(overrides)
  const name = (parentName || 'there').split(' ')[0]
  const steps = [c.step1, c.step2, c.step3]
  const fineLines = c.finePrint.split('\n').map(l => l.trim()).filter(Boolean)

  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#EEF2FB;">
<div style="display:none;max-height:0;overflow:hidden;">${escHtml(c.referralHeadline)} — plus multi-course and sibling discounts.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2FB;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Header -->
  <tr><td style="background:${BLUE_DARK};border-radius:16px 16px 0 0;padding:28px 32px;">
    <span style="color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">CUBE</span>
    <span style="color:rgba(255,255,255,0.55);font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-left:10px;">Tuition</span>
  </td></tr>

  <!-- Hero -->
  <tr><td style="background:#ffffff;padding:36px 32px 8px;">
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BLUE};">CUBE Rewards</p>
    <h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;color:${BLUE_DARK};">${rich(c.heroTitle)}</h1>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:${INK};">Hi ${escHtml(name)},</p>
    ${paragraphs(c.intro)}
  </td></tr>

  <!-- Referral hero card -->
  <tr><td style="background:#ffffff;padding:24px 32px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BLUE_DARK};border-radius:14px;">
      <tr><td style="padding:26px 28px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9DB6E8;">Referral Program</p>
        <p style="margin:0 0 10px;font-size:30px;font-weight:800;color:#ffffff;line-height:1.2;">${escHtml(c.referralHeadline)}</p>
        <p style="margin:0;font-size:14px;line-height:1.7;color:#CBD9F5;">${richOnDark(c.referralBody)}</p>
      </td></tr>
    </table>
  </td></tr>

  <!-- How referrals work -->
  <tr><td style="background:#ffffff;padding:20px 32px 4px;">
    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:${BLUE_DARK};text-transform:uppercase;letter-spacing:1px;">How it works</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${steps.map((step, i) => `<tr>
        <td valign="top" style="width:28px;padding:6px 0;"><span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${BLUE_SOFT};color:${BLUE_DARK};font-size:12px;font-weight:700;text-align:center;line-height:22px;">${i + 1}</span></td>
        <td style="padding:6px 0 6px 10px;font-size:14px;line-height:1.6;color:${INK};">${rich(step)}</td>
      </tr>`).join('')}
    </table>
  </td></tr>

  <!-- Divider -->
  <tr><td style="background:#ffffff;padding:20px 32px 0;"><div style="border-top:1px solid ${BLUE_SOFT};"></div></td></tr>

  <!-- Two discount cards -->
  <tr><td style="background:#ffffff;padding:20px 32px 8px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:${BLUE_DARK};text-transform:uppercase;letter-spacing:1px;">Also available, every term</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td valign="top" width="49%" style="background:${BG_SOFT};border-radius:12px;padding:18px 20px;">
          <p style="margin:0 0 4px;font-size:22px;">📚</p>
          <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:${BLUE_DARK};">${rich(c.multiTitle)}</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:${INK};">${rich(c.multiBody)}</p>
        </td>
        <td width="2%"></td>
        <td valign="top" width="49%" style="background:${BG_SOFT};border-radius:12px;padding:18px 20px;">
          <p style="margin:0 0 4px;font-size:22px;">👨‍👩‍👧‍👦</p>
          <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:${BLUE_DARK};">${rich(c.siblingTitle)}</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:${INK};">${rich(c.siblingBody)}</p>
        </td>
      </tr>
    </table>
    <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:${BLUE};opacity:0.85;">${rich(c.formsNote)}</p>
  </td></tr>

  <!-- Good to know -->
  <tr><td style="background:#ffffff;padding:16px 32px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:1px;">Good to know</p>
        <p style="margin:0;font-size:12.5px;line-height:1.8;color:#92400E;">
          ${fineLines.map(l => `• ${rich(l)}`).join('<br/>')}
        </p>
      </td></tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td align="center" style="background:#ffffff;padding:24px 32px 36px;">
    <a href="mailto:cubehsctuition@gmail.com?subject=Referral%20—%20CUBE%20Tuition" style="display:inline-block;background:${BLUE};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:10px;">${rich(c.ctaLabel)}</a>
    <p style="margin:12px 0 0;font-size:12px;color:${BLUE};opacity:0.7;">${rich(c.ctaNote)}</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:${BG_SOFT};border-radius:0 0 16px 16px;padding:18px 32px;">
    <p style="margin:0;font-size:11px;line-height:1.7;color:${BLUE};opacity:0.7;">
      CUBE Tuition · You&rsquo;re receiving this because your family is enrolled at CUBE.<br/>
      Questions? Just reply — we read every email.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

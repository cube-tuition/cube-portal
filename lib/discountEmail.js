/*
 * CUBE discount-program marketing email template (referral-led).
 * Shared by the send API route and the /tutor/emails/discount-program preview.
 * Content mirrors the CUBE Discount Programs PDF.
 */

const BLUE_DARK = '#062E63'
const BLUE      = '#325099'
const BLUE_SOFT = '#DEE7FF'
const BG_SOFT   = '#F0F4FF'
const INK       = '#2A2035'

export function buildDiscountEmailHtml(parentName) {
  const name = (parentName || 'there').split(' ')[0]
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#EEF2FB;">
<div style="display:none;max-height:0;overflow:hidden;">Refer a family and you BOTH save $50 — plus multi-course and sibling discounts.</div>
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
    <h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;color:${BLUE_DARK};">Share CUBE, and you both save.</h1>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:${INK};">Hi ${name},</p>
    <p style="margin:0;font-size:15px;line-height:1.7;color:${INK};">Great teaching travels by word of mouth — and we&rsquo;d love to thank you for it. Here&rsquo;s every way your family can save at CUBE this term.</p>
  </td></tr>

  <!-- Referral hero card -->
  <tr><td style="background:#ffffff;padding:24px 32px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BLUE_DARK};border-radius:14px;">
      <tr><td style="padding:26px 28px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9DB6E8;">Referral Program</p>
        <p style="margin:0 0 10px;font-size:30px;font-weight:800;color:#ffffff;line-height:1.2;">$50 off — for both families</p>
        <p style="margin:0;font-size:14px;line-height:1.7;color:#CBD9F5;">For every family you refer who enrols and begins classes, <strong style="color:#ffffff;">you get $50 off</strong> your term fees and <strong style="color:#ffffff;">they get $50 off</strong> theirs. There&rsquo;s no limit — refer three families, save $150.</p>
      </td></tr>
    </table>
  </td></tr>

  <!-- How referrals work -->
  <tr><td style="background:#ffffff;padding:20px 32px 4px;">
    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:${BLUE_DARK};text-transform:uppercase;letter-spacing:1px;">How it works</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td valign="top" style="width:28px;padding:6px 0;"><span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${BLUE_SOFT};color:${BLUE_DARK};font-size:12px;font-weight:700;text-align:center;line-height:22px;">1</span></td>
        <td style="padding:6px 0 6px 10px;font-size:14px;line-height:1.6;color:${INK};">Tell a friend about CUBE and email us the student&rsquo;s name (e.g. <em>&ldquo;I&rsquo;ve referred Ryan Park, Year 9&rdquo;</em>) — or they can put your name in the <strong>&ldquo;Referred by&rdquo;</strong> box on the free-trial form.</td>
      </tr>
      <tr>
        <td valign="top" style="width:28px;padding:6px 0;"><span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${BLUE_SOFT};color:${BLUE_DARK};font-size:12px;font-weight:700;text-align:center;line-height:22px;">2</span></td>
        <td style="padding:6px 0 6px 10px;font-size:14px;line-height:1.6;color:${INK};">They try a <strong>free trial lesson</strong> and enrol for the term.</td>
      </tr>
      <tr>
        <td valign="top" style="width:28px;padding:6px 0;"><span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${BLUE_SOFT};color:${BLUE_DARK};font-size:12px;font-weight:700;text-align:center;line-height:22px;">3</span></td>
        <td style="padding:6px 0 6px 10px;font-size:14px;line-height:1.6;color:${INK};">We apply <strong>$50 off for both families</strong> on the next invoice — automatically.</td>
      </tr>
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
          <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:${BLUE_DARK};">Multi-Course Discount</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:${INK};">2 courses → <strong>$100 off</strong> total<br/>3 courses → <strong>$150 off</strong> total</p>
        </td>
        <td width="2%"></td>
        <td valign="top" width="49%" style="background:${BG_SOFT};border-radius:12px;padding:18px 20px;">
          <p style="margin:0 0 4px;font-size:22px;">👨‍👩‍👧‍👦</p>
          <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:${BLUE_DARK};">Sibling Discount</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:${INK};"><strong>$50 off per sibling</strong> when siblings are enrolled together.</p>
        </td>
      </tr>
    </table>
    <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:${BLUE};opacity:0.85;">Adding a course or sibling? Use the <strong>re-enrolment form</strong> (returning) or the <strong>free-trial form</strong> (new) and we&rsquo;ll match the details on your invoice automatically.</p>
  </td></tr>

  <!-- Good to know -->
  <tr><td style="background:#ffffff;padding:16px 32px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:1px;">Good to know</p>
        <p style="margin:0;font-size:12.5px;line-height:1.8;color:#92400E;">
          • Referrals count once the new student is fully enrolled for the term, and must be new families to CUBE.<br/>
          • If discounts exceed your term fee, the balance carries forward as credit.<br/>
          • Already paid? The discount applies to your next bill — or is issued as cash if you finish up before then.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td align="center" style="background:#ffffff;padding:24px 32px 36px;">
    <a href="mailto:cubehsctuition@gmail.com?subject=Referral%20—%20CUBE%20Tuition" style="display:inline-block;background:${BLUE};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:10px;">Refer a family →</a>
    <p style="margin:12px 0 0;font-size:12px;color:${BLUE};opacity:0.7;">Just reply to this email with the student&rsquo;s name — that&rsquo;s it.</p>
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


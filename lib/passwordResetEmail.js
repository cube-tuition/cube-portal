import { CONTACT_EMAIL } from './emailConfig'

/*
 * The "set a new password" email.
 *
 * The link carries a single-use recovery token in its fragment, so it is the
 * one secret in here: anyone holding it can set the password on that account.
 * That is why the copy tells the reader not to forward it, and why there is no
 * password anywhere in this email — the whole point of the reset flow is that
 * the student chooses their own and nobody else ever sees it.
 *
 * `guardianOf` is set when the email goes to a parent rather than to the
 * student: most CUBE students have no address of their own, so the parent is
 * the only way to reach the account. The copy has to say plainly whose account
 * is being reset, or a parent receives a reset link with no idea what it opens.
 */
export function passwordResetEmail({ name, link, guardianOf = null }) {
  const who = guardianOf || name || 'your CUBE account'
  const subject = guardianOf
    ? `Set a new CUBE Portal password for ${guardianOf}`
    : 'Set a new password for your CUBE Portal'

  const intro = guardianOf
    ? `A new password is needed for <strong>${guardianOf}</strong>'s CUBE Portal login. Because ${guardianOf} doesn't have their own email address with us, this link has come to you.`
    : `Someone asked to reset the password on your CUBE Portal login. Choose a new one using the button below.`

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;background:linear-gradient(120deg,#04204a 0%,#062E63 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:32px;">
        <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">CUBE Tuition</p>
        <p style="margin:6px 0 0;font-size:12px;color:#bcd0f0;text-transform:uppercase;letter-spacing:2.4px;font-weight:600;">Portal password</p>
        <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
      </div>

      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Hi${name && !guardianOf ? ` ${name.split(' ')[0]}` : ''},</p>
      <p style="margin:0 0 26px;font-size:15px;line-height:1.6;">${intro}</p>

      <div style="text-align:center;margin:0 0 26px;">
        <a href="${link}" style="display:inline-block;background:#325099;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 34px;border-radius:12px;">Choose a new password</a>
      </div>

      <div style="margin:26px 0;background:#F0F4FF;border:1px solid #DEE7FF;border-radius:12px;padding:18px 20px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#062E63;text-transform:uppercase;letter-spacing:0.6px;">Before you click</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#2A2035;">
          This link works <strong>once</strong> and then stops working, so please don't forward it —
          anyone who opens it can set the password on ${guardianOf ? `${guardianOf}'s` : 'this'} account.
          It also expires after a short while; if it has gone stale, just ask us for another.
        </p>
      </div>

      <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#2A2035;">
        If the button doesn't work, copy this address into your browser:
      </p>
      <p style="margin:0 0 26px;font-size:12px;line-height:1.5;word-break:break-all;color:#325099;">${link}</p>

      <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#6b6577;">
        Didn't ask for this? You can ignore this email — nothing changes until the link is opened
        and a new password is set. If you'd like us to look into it, reply or write to
        <a href="mailto:${CONTACT_EMAIL}" style="color:#325099;">${CONTACT_EMAIL}</a>.
      </p>

      <p style="margin:26px 0 0;padding-top:18px;border-top:1px solid #DEE7FF;font-size:11px;color:#9b95a8;text-align:center;letter-spacing:2px;text-transform:uppercase;">
        CUBE Tuition · Chatswood
      </p>
    </div>
  </body></html>`

  const text = [
    guardianOf
      ? `A new password is needed for ${guardianOf}'s CUBE Portal login.`
      : `Someone asked to reset the password on your CUBE Portal login.`,
    ``,
    `Choose a new password here:`,
    link,
    ``,
    `This link works once and then stops working, so please don't forward it.`,
    `It also expires after a short while — ask us for another if it has gone stale.`,
    ``,
    `Didn't ask for this? Ignore this email; nothing changes until the link is opened.`,
    `Questions: ${CONTACT_EMAIL}`,
    `— CUBE Tuition`,
  ].join('\n')

  return { subject, html, text, who }
}

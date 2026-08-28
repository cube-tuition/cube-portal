import { CONTACT_EMAIL } from './emailConfig'

/*
 * The "here is your portal login" email.
 *
 * It carries the username and a single-use link for choosing a password — not
 * a password. Passwords are stored only as hashes, so an existing one cannot
 * be looked up and sent by anyone; and mailing a password would leave it
 * sitting in an inbox for as long as the message survives. The reader sets
 * their own, and nobody at CUBE ever knows it.
 *
 * `guardianOf` is set when the mail goes to a parent rather than the student:
 * most CUBE logins are @cubetuition.com addresses with no mailbox, so the
 * parent is the only way to reach the account. The copy then has to be plain
 * about whose login it is, and that the username is the student's, not theirs.
 */
export function loginDetailsEmail({ name, username, link, portalUrl, guardianOf = null }) {
  const first = (name || '').split(' ')[0]
  const subject = guardianOf
    ? `${guardianOf}'s CUBE Portal login`
    : 'Your CUBE Portal login'

  const intro = guardianOf
    ? `Here is the CUBE Portal login for <strong>${guardianOf}</strong>. Because ${guardianOf} doesn't have their own email address with us, it has come to you.`
    : `Here is your login for the CUBE Portal — where your workbooks, homework and results live.`

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;background:linear-gradient(120deg,#04204a 0%,#062E63 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:32px;">
        <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">CUBE Tuition</p>
        <p style="margin:6px 0 0;font-size:12px;color:#bcd0f0;text-transform:uppercase;letter-spacing:2.4px;font-weight:600;">Portal login</p>
        <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
      </div>

      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Hi${first && !guardianOf ? ` ${first}` : ''},</p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${intro}</p>

      <div style="margin:0 0 26px;background:#F0F4FF;border:1px solid #DEE7FF;border-radius:12px;padding:18px 20px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#062E63;text-transform:uppercase;letter-spacing:0.6px;">Username</p>
        <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#2A2035;word-break:break-all;">${username}</p>
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#062E63;text-transform:uppercase;letter-spacing:0.6px;">Portal</p>
        <p style="margin:0;font-size:14px;"><a href="${portalUrl}" style="color:#325099;">${portalUrl}</a></p>
      </div>

      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Choose a password using the button below, then sign in with the username above.</p>

      <div style="text-align:center;margin:0 0 26px;">
        <a href="${link}" style="display:inline-block;background:#325099;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 34px;border-radius:12px;">Set ${guardianOf ? 'the' : 'your'} password</a>
      </div>

      <div style="margin:26px 0;background:#FFF7ED;border:1px solid #FDE2B8;border-radius:12px;padding:18px 20px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.6px;">Before you click</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#2A2035;">
          This link works <strong>once</strong> and then stops working, so please don't forward it.
          We never send passwords by email, and nobody at CUBE can see the one you choose.
        </p>
      </div>

      <p style="margin:0;font-size:13px;line-height:1.6;color:#2A2035/70;">Stuck? Just reply to this email or write to
        <a href="mailto:${CONTACT_EMAIL}" style="color:#325099;">${CONTACT_EMAIL}</a>.</p>
    </div>
  </body></html>`

  const text = [
    guardianOf ? `CUBE Portal login for ${guardianOf}` : 'Your CUBE Portal login',
    '',
    `Username: ${username}`,
    `Portal:   ${portalUrl}`,
    '',
    `Set ${guardianOf ? 'the' : 'your'} password: ${link}`,
    '',
    "That link works once and then stops working, so please don't forward it.",
    'We never send passwords by email, and nobody at CUBE can see the one you choose.',
    '',
    `Questions: ${CONTACT_EMAIL}`,
  ].join('\n')

  return { subject, html, text }
}

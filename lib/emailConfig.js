// Every email the portal sends BCCs this address, so staff always keep a copy
// (the portal sends via Resend server-side, so nothing lands in a Gmail "Sent"
// folder otherwise). Override with the PORTAL_BCC_EMAIL env var if needed.
export const PORTAL_BCC = process.env.PORTAL_BCC_EMAIL || 'cubehsctuition@gmail.com'

// A "test send" delivers the EXACT same email but only to staff, so a director
// can see precisely what a family would receive without sending it to them.
export const TEST_RECIPIENT = process.env.PORTAL_TEST_EMAIL || PORTAL_BCC

// A standalone banner that marks an email as a staff-only test send.
export function testEmailBanner() {
  return `<div style="max-width:600px;margin:0 auto 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#FEF3C7;border:1px solid #F59E0B;border-radius:10px;padding:12px 18px;color:#92400E;font-size:13px;font-weight:700;text-align:center;letter-spacing:0.3px;">⚠️ TEST EMAIL — sent to CUBE staff only. The family did NOT receive this.</div>`
}

// Place the test banner just inside <body> if present, otherwise at the very top.
function injectTestBanner(html) {
  if (!html) return html
  const banner = testEmailBanner()
  const m = html.match(/<body[^>]*>/i)
  if (m) {
    const idx = html.indexOf(m[0]) + m[0].length
    return html.slice(0, idx) + banner + html.slice(idx)
  }
  return banner + html
}

/*
 * Given the Resend params we'd send to a real recipient, return params adjusted
 * for a "test send": delivered ONLY to staff (TEST_RECIPIENT), no family BCC,
 * subject prefixed with [TEST], and a TEST banner injected into the HTML body.
 * Everything else (attachments, from, headers) is preserved so the test is an
 * exact copy of the real email. When `test` is falsy, params pass through.
 */
export function applyEmailTestMode(params, test) {
  if (!test) return params
  return {
    ...params,
    to: [TEST_RECIPIENT],
    bcc: undefined,
    subject: `[TEST] ${params.subject || ''}`.trim(),
    html: injectTestBanner(params.html),
  }
}

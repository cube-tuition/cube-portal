// Every email the portal sends BCCs this address, so staff always keep a copy
// (the portal sends via Resend server-side, so nothing lands in a Gmail "Sent"
// folder otherwise). Override with the PORTAL_BCC_EMAIL env var if needed.
export const PORTAL_BCC = process.env.PORTAL_BCC_EMAIL || 'cubehsctuition@gmail.com'

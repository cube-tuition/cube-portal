import { NextResponse } from 'next/server'

/**
 * GET /api/xero/auth
 * Redirects the admin to Xero's OAuth consent screen.
 */
export async function GET() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.XERO_CLIENT_ID,
    redirect_uri:  process.env.XERO_REDIRECT_URI,
    scope:         'openid profile email accounting.contacts accounting.invoices accounting.settings offline_access',
    state:         'cube-xero-connect',
  })
  return NextResponse.redirect(
    `https://login.xero.com/identity/connect/authorize?${params.toString()}`
  )
}

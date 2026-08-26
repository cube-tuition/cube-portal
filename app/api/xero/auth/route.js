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
    // accounting.transactions is what the Payments endpoint checks — without it
    // Xero answers POST /Payments with a bare 401, even though invoices push
    // fine on accounting.invoices. Adding a scope needs a fresh consent, so an
    // existing connection must Reconnect before payments start working.
    scope:         'openid profile email accounting.contacts accounting.invoices accounting.transactions accounting.settings payroll.employees payroll.payruns payroll.payslip payroll.settings offline_access',
    state:         'cube-xero-connect',
  })
  return NextResponse.redirect(
    `https://login.xero.com/identity/connect/authorize?${params.toString()}`
  )
}

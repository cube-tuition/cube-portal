import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { XERO_STATE_COOKIE, XERO_STATE_COOKIE_PATH } from '../../../../lib/xeroOauth'

/**
 * GET /api/xero/auth
 * Redirects the admin to Xero's OAuth consent screen.
 *
 * CSRF: `state` used to be the fixed string 'cube-xero-connect', and the
 * callback never checked it. That let an attacker hand our callback their own
 * authorisation code, so the portal would store tokens pointing at THEIR Xero
 * organisation and start pushing our invoices into it. We now mint a random
 * nonce per attempt, keep it in an httpOnly cookie, and require the callback to
 * see the same value come back.
 *
 * The cookie is SameSite=Lax deliberately: Xero returns the browser here via a
 * top-level cross-site GET redirect, which Lax allows but Strict would strip —
 * a Strict cookie would make every legitimate callback look forged.
 */
export async function GET() {
  const state = randomBytes(32).toString('hex')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.XERO_CLIENT_ID,
    redirect_uri:  process.env.XERO_REDIRECT_URI,
    // accounting.payments is what the Payments endpoint checks — without it
    // Xero answers POST /Payments with a bare 401, even though invoices push
    // fine on accounting.invoices. Adding a scope needs a fresh consent, so an
    // existing connection must Reconnect before payments start working.
    //
    // It must be the GRANULAR scope, not the broad accounting.transactions.
    // This app is already on granular scopes (accounting.invoices is one), and
    // Xero rejects the whole consent request with invalid_scope if the broad
    // scope those granular ones replace is asked for as well.
    scope:         'openid profile email accounting.contacts accounting.invoices accounting.payments accounting.settings payroll.employees payroll.payruns payroll.payslip payroll.settings offline_access',
    state,
  })

  const res = NextResponse.redirect(
    `https://login.xero.com/identity/connect/authorize?${params.toString()}`
  )
  res.cookies.set(XERO_STATE_COOKIE, state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     XERO_STATE_COOKIE_PATH,
    maxAge:   600, // consent is a one-sitting action; 10 minutes is plenty
  })
  return res
}

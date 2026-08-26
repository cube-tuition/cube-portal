import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { XERO_STATE_COOKIE, XERO_STATE_COOKIE_PATH } from '../../../../lib/xeroOauth'

/**
 * GET /api/xero/callback
 * Xero redirects here after the user approves access.
 * Exchanges the auth code for tokens, then redirects back to the portal.
 *
 * The `state` returned by Xero must match the nonce /api/xero/auth put in an
 * httpOnly cookie. Without that check anyone could call this endpoint with an
 * authorisation code for their own Xero organisation and repoint our stored
 * tokens at it (OAuth CSRF / code injection).
 */
function statesMatch(a, b) {
  if (!a || !b) return false
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  const portalBase = process.env.XERO_REDIRECT_URI.replace('/api/xero/callback', '')
  const fail = (reason) => {
    console.error('Xero callback error:', reason)
    // Details stay in the server log. The old code returned err.message to the
    // caller, which echoed the raw Xero token-endpoint response body back to an
    // unauthenticated request.
    const res = NextResponse.redirect(`${portalBase}/tutor/accounting/invoices?xero=error`)
    res.cookies.set(XERO_STATE_COOKIE, '', { path: XERO_STATE_COOKIE_PATH, maxAge: 0 })
    return res
  }

  if (error || !code) return fail(error || 'no authorisation code returned')

  const expectedState = req.cookies.get(XERO_STATE_COOKIE)?.value
  if (!statesMatch(state, expectedState)) {
    return fail('state mismatch — refusing to exchange this authorisation code')
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  'Basic ' + Buffer.from(
          `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
        ).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: process.env.XERO_REDIRECT_URI,
      }).toString(),
    })
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`)
    const tokens = await tokenRes.json()

    // Get the tenant ID (Xero organisation)
    const connRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    })
    if (!connRes.ok) throw new Error(`Connections fetch failed: ${await connRes.text()}`)
    const connections = await connRes.json()
    const tenant_id = connections[0]?.tenantId
    if (!tenant_id) throw new Error('No Xero organisation found')

    // Save tokens to DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
    const expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    const { error: dbErr } = await supabase.from('xero_tokens').upsert({
      id:            1,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      tenant_id,
      expires_at,
      updated_at:    new Date().toISOString(),
    })
    if (dbErr) throw new Error(`DB save failed: ${dbErr.message}`)

    const res = NextResponse.redirect(`${portalBase}/tutor/accounting/invoices?xero=connected`)
    res.cookies.set(XERO_STATE_COOKIE, '', { path: XERO_STATE_COOKIE_PATH, maxAge: 0 })
    return res
  } catch (err) {
    return fail(err)
  }
}

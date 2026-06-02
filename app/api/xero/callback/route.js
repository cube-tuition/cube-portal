import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/xero/callback
 * Xero redirects here after the user approves access.
 * Exchanges the auth code for tokens, then redirects back to the portal.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  const portalBase = process.env.XERO_REDIRECT_URI.replace('/api/xero/callback', '')

  if (error || !code) {
    return NextResponse.redirect(`${portalBase}/tutor/database?xero=error`)
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

    return NextResponse.redirect(`${portalBase}/tutor/database?xero=connected`)
  } catch (err) {
    console.error('Xero callback error:', err)
    return NextResponse.redirect(`${portalBase}/tutor/database?xero=error`)
  }
}

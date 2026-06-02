import { NextResponse } from 'next/server'
import { getStoredTokens, getValidToken } from '../../../../lib/xero'

export async function GET() {
  try {
    // Show raw stored token state first
    const stored = await getStoredTokens()
    if (!stored) return NextResponse.json({ error: 'No token row in DB' })

    const tokenAge = stored.expires_at
      ? `expires_at=${stored.expires_at}, now=${new Date().toISOString()}, expired=${new Date(stored.expires_at) < new Date()}`
      : 'no expires_at'

    // Try to get a valid token (triggers refresh if expired)
    let validToken
    try {
      validToken = await getValidToken()
    } catch (err) {
      return NextResponse.json({ tokenAge, refreshError: err.message })
    }

    // Check what tenants are actually connected to this token
    const connRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${validToken.access_token}`, Accept: 'application/json' },
    })
    const connText = await connRes.text()

    // Test the token against Xero using stored tenant_id
    const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices?page=1&pageSize=1', {
      headers: {
        Authorization:    `Bearer ${validToken.access_token}`,
        'Xero-Tenant-Id': validToken.tenant_id,
        Accept:           'application/json',
      },
    })
    const text = await res.text()
    return NextResponse.json({
      tokenAge,
      storedTenantId: validToken.tenant_id,
      connections: connText.slice(0, 500),
      xeroStatus: res.status,
      body: text.slice(0, 300),
    })
  } catch (err) {
    return NextResponse.json({ fatalError: err.message })
  }
}

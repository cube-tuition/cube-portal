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

    // Test the token against Xero
    const res = await fetch('https://api.xero.com/api.xro/2.0/Organisations', {
      headers: {
        Authorization:    `Bearer ${validToken.access_token}`,
        'Xero-Tenant-Id': validToken.tenant_id,
        Accept:           'application/json',
      },
    })
    const text = await res.text()
    return NextResponse.json({ tokenAge, xeroStatus: res.status, body: text.slice(0, 500) })
  } catch (err) {
    return NextResponse.json({ fatalError: err.message })
  }
}

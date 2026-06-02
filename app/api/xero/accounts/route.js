import { NextResponse } from 'next/server'
import { getValidToken } from '../../../../lib/xero'

export async function GET() {
  const { access_token, tenant_id } = await getValidToken()
  const res = await fetch('https://api.xero.com/api.xro/2.0/Accounts?Status=ACTIVE', {
    headers: { Authorization: `Bearer ${access_token}`, 'Xero-Tenant-Id': tenant_id, Accept: 'application/json' },
  })
  const text = await res.text()
  return NextResponse.json({ status: res.status, body: text.slice(0, 2000) })
}

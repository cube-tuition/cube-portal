import { NextResponse } from 'next/server'
import { getValidToken } from '../../../../lib/xero'

export async function GET() {
  const { access_token, tenant_id } = await getValidToken()
  const res = await fetch('https://api.xero.com/api.xro/2.0/Accounts?Status=ACTIVE', {
    headers: { Authorization: `Bearer ${access_token}`, 'Xero-Tenant-Id': tenant_id, Accept: 'application/json' },
  })
  const data = await res.json()
  return NextResponse.json(data.Accounts?.map(a => ({ Code: a.Code, Name: a.Name, Type: a.Type })) || [])
}

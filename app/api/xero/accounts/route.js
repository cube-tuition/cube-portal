import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidToken } from '../../../../lib/xero'

export async function GET(req) {
  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.replace('Bearer ', '')
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { access_token, tenant_id } = await getValidToken()
  const res = await fetch('https://api.xero.com/api.xro/2.0/Accounts?Type=REVENUE&Status=ACTIVE', {
    headers: { Authorization: `Bearer ${access_token}`, 'Xero-Tenant-Id': tenant_id, Accept: 'application/json' },
  })
  const data = await res.json()
  return NextResponse.json(data.Accounts?.map(a => ({ Code: a.Code, Name: a.Name, Type: a.Type })) || [])
}

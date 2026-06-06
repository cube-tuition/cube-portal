import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function adminSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

/** GET /api/xero/settings — returns current account mapping */
export async function GET() {
  const { data, error } = await adminSb()
    .from('xero_settings').select('*').eq('id', 1).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** POST /api/xero/settings — saves account mapping */
export async function POST(req) {
  try {
    const body = await req.json()
    const allowed = ['enrolment_account_code', 'discount_account_code', 'credit_account_code', 'tax_type']
    const update = {}
    for (const k of allowed) if (body[k] !== undefined) update[k] = body[k] || null
    update.updated_at = new Date().toISOString()

    const { error } = await adminSb()
      .from('xero_settings').update(update).eq('id', 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

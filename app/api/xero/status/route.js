import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getStoredTokens, getTokenScopes, PAYMENTS_SCOPE } from '../../../../lib/xero'

/**
 * GET /api/xero/status
 * Returns whether Xero is connected (admin only), and whether the connection
 * carries the scope needed to record payments.
 */
export async function GET(req) {
  // Verify admin JWT
  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.replace('Bearer ', '')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.app_metadata?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tokens = await getStoredTokens()
  const scopes = tokens ? await getTokenScopes() : []
  const { data: settings } = await supabase
    .from('xero_settings').select('payment_account_code').eq('id', 1).maybeSingle()
  return NextResponse.json({
    connected: !!tokens,
    expires_at: tokens?.expires_at || null,
    // False on a connection made before the payments scope was added — it keeps
    // pushing invoices happily and only fails when a payment is attempted.
    payments_enabled: scopes.includes(PAYMENTS_SCOPE),
    // Both must be true before anything can be marked paid in Xero. Reported
    // separately because the fixes are different — one is Reconnect, the other
    // is picking a bank account.
    payment_account_set: !!settings?.payment_account_code,
  })
}

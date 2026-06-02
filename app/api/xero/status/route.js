import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getStoredTokens } from '../../../../lib/xero'

/**
 * GET /api/xero/status
 * Returns whether Xero is connected (admin only).
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
  return NextResponse.json({
    connected: !!tokens,
    expires_at: tokens?.expires_at || null,
  })
}

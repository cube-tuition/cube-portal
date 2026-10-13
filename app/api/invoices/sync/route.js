import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../lib/apiAuth'
import { syncQueuedInvoices } from '../../../../lib/invoiceSync'

/**
 * POST /api/invoices/sync
 * Brings draft invoices in line with the enrolment changes queued since the
 * last run (lib/invoiceSync). The invoices page calls it as it opens; the
 * daily cron runs the same function. Safe to call any number of times.
 */
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    return Response.json(await syncQueuedInvoices(sb))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

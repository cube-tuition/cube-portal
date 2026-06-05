import { createClient } from '@supabase/supabase-js'

/* POST /api/update-invoice-status  Body: { invoice_id, status } */
export async function POST(req) {
  try {
    const { invoice_id, status } = await req.json()
    if (!invoice_id || !status) return Response.json({ error: 'Missing invoice_id or status' }, { status: 400 })

    const VALID_STATUSES = ['draft', 'approved', 'synced_to_xero', 'sent', 'awaiting_payment', 'paid', 'overdue', 'voided', 'credited', 'unpaid']
    if (!VALID_STATUSES.includes(status)) return Response.json({ error: 'Invalid status' }, { status: 400 })

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { error } = await sb.from('invoices').update({ status }).eq('id', invoice_id)
    if (error) return Response.json({ error: error.message }, { status: 400 })
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

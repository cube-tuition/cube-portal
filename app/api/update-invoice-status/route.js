import { createClient } from '@supabase/supabase-js'

/*
 * POST /api/update-invoice-status
 * Body: { invoice_id, field, value }
 *
 * field must be one of: 'status' | 'delivery_status' | 'payment_status'
 *
 * Valid values:
 *   status:          draft | approved | synced_to_xero | voided
 *   delivery_status: unsent | sent
 *   payment_status:  unpaid | paid | overdue | null
 */

const ALLOWED_FIELDS = {
  status:          ['draft', 'approved', 'synced_to_xero', 'voided'],
  delivery_status: ['unsent', 'sent'],
  payment_status:  ['unpaid', 'paid', 'overdue'],   // null also allowed
}

export async function POST(req) {
  try {
    const { invoice_id, field, value } = await req.json()
    if (!invoice_id || !field) return Response.json({ error: 'Missing invoice_id or field' }, { status: 400 })
    if (!ALLOWED_FIELDS[field]) return Response.json({ error: `Invalid field: ${field}` }, { status: 400 })

    // Allow null for payment_status (clears it)
    if (value !== null && !ALLOWED_FIELDS[field].includes(value)) {
      return Response.json({ error: `Invalid value "${value}" for ${field}` }, { status: 400 })
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const { error } = await sb.from('invoices').update({ [field]: value }).eq('id', invoice_id)
    if (error) return Response.json({ error: error.message }, { status: 400 })
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

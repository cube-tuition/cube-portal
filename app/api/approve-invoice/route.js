import { createClient } from '@supabase/supabase-js'

/* POST /api/approve-invoice  Body: { invoice_id, approved_by? } */
export async function POST(req) {
  try {
    const { invoice_id, approved_by } = await req.json()
    if (!invoice_id) return Response.json({ error: 'Missing invoice_id' }, { status: 400 })

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { error } = await sb.from('invoices').update({
      status:      'approved',
      approved_at: new Date().toISOString(),
      approved_by: approved_by || null,
    }).eq('id', invoice_id).eq('status', 'draft') // only approve drafts

    if (error) return Response.json({ error: error.message }, { status: 400 })
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

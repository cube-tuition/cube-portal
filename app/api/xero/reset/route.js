import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../lib/apiAuth'

/*
 * Xero link reset — for when invoices were deleted on the Xero side and the
 * portal is still claiming they are there.
 *
 * The push query selects on `xero_invoice_id IS NULL`, so a stale link makes an
 * invoice permanently unpushable. Changing the status dropdown back to Approved
 * does NOT fix that: it leaves the id in place. Clearing the three xero_* fields
 * is the only thing that makes an invoice a sync candidate again.
 *
 * GET  /api/xero/reset?term_id=…   → how many would be reset (for the confirm)
 * POST /api/xero/reset { term_id } → do it
 */

function adminSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

// Same bar as pushing: this decides what lands in the real accounting system.
const ROLES = ['admin']

async function linkedInvoices(sb, termId) {
  return sb.from('invoices')
    .select('id, status')
    .eq('term_id', termId)
    .not('xero_invoice_id', 'is', null)
}

export async function GET(req) {
  const auth = await requireApiRole(req, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const termId = new URL(req.url).searchParams.get('term_id')
  if (!termId) return NextResponse.json({ error: 'term_id required' }, { status: 400 })

  const { data, error } = await linkedInvoices(adminSb(), termId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data || []
  return NextResponse.json({
    linked:   rows.length,
    reopened: rows.filter(i => i.status === 'synced_to_xero').length,
    voided:   rows.filter(i => i.status === 'voided').length,
  })
}

export async function POST(req) {
  const auth = await requireApiRole(req, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { term_id } = await req.json()
  if (!term_id) return NextResponse.json({ error: 'term_id required' }, { status: 400 })

  const sb = adminSb()
  const { data, error } = await linkedInvoices(sb, term_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data || []
  if (!rows.length) {
    return NextResponse.json({ reset: 0, reopened: 0, left_as_is: 0, message: 'No invoices in this term are linked to Xero.' })
  }

  const clear = { xero_invoice_id: null, xero_contact_id: null, xero_pushed_at: null }

  // ONLY a synced invoice goes back to 'approved'. Every other status keeps the
  // one it has — a voided invoice flipped to approved would re-enter the push
  // queue and recreate a cancelled bill in Xero, which is exactly the mess this
  // route exists to clean up. (Term 2 2026 alone carries 82 voided invoices with
  // a Xero link, so this is not a hypothetical.)
  const reopenIds = rows.filter(i => i.status === 'synced_to_xero').map(i => i.id)
  const keepIds   = rows.filter(i => i.status !== 'synced_to_xero').map(i => i.id)

  if (reopenIds.length) {
    const { error: e } = await sb.from('invoices').update({ ...clear, status: 'approved' }).in('id', reopenIds)
    if (e) return NextResponse.json({ error: e.message }, { status: 500 })
  }
  if (keepIds.length) {
    const { error: e } = await sb.from('invoices').update(clear).in('id', keepIds)
    if (e) return NextResponse.json({ error: e.message }, { status: 500 })
  }

  return NextResponse.json({
    reset:      rows.length,
    reopened:   reopenIds.length,
    left_as_is: keepIds.length,
  })
}

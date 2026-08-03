import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'

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
 *
 * Marking a CASH invoice paid also adds the matching inflow to the cash log
 * (and un-marking removes it) — see syncCashLog below. The response reports
 * what happened as `cash_log`: added | removed | exists | failed: … | null.
 */

const ALLOWED_FIELDS = {
  status:          ['draft', 'approved', 'synced_to_xero', 'voided'],
  delivery_status: ['unsent', 'sent'],
  payment_status:  ['unpaid', 'paid', 'overdue'],   // null also allowed
}

/*
 * Cash-log side effect. A cash invoice being marked paid IS cash arriving at the
 * desk, so it books itself into the cash log rather than waiting to be typed in
 * again; un-marking it removes that row again. Bank invoices are left alone —
 * their money never passes through the cash tin.
 *
 * cash_log.invoice_id carries the link (unique where not null), so flipping an
 * invoice paid → unpaid → paid can never leave two rows or a stray one behind.
 * Mirrors payroll's markCashPaid / markCashUnpaid for cash-paid wages.
 */
async function syncCashLog(sb, invoiceId, isPaid) {
  const { data: inv } = await sb.from('invoices')
    .select('id, payment_method, payment_status, total, term_id, invoice_number, paid_date, line_items')
    .eq('id', invoiceId).single()
  if (!inv) return { cash_log: null }

  if (!isPaid || inv.payment_method !== 'cash') {
    // Not (or no longer) cash money in hand — drop any row this invoice added.
    const { data: gone } = await sb.from('cash_log').delete().eq('invoice_id', invoiceId).select('id')
    return { cash_log: gone?.length ? 'removed' : null }
  }

  const amount = Number(inv.total) || 0
  if (amount <= 0) return { cash_log: null }        // nothing to bank

  const { data: existing } = await sb.from('cash_log')
    .select('id').eq('invoice_id', invoiceId).maybeSingle()
  if (existing) return { cash_log: 'exists' }       // already logged; leave it as staff have it

  // "Monica Ma — invoice 26T3-0188", in the spirit of the hand-typed rows.
  const names = [...new Set((inv.line_items || []).map(l => l.student_name).filter(Boolean))]
  const who = names.join(', ')
  const description = [who, inv.invoice_number ? `invoice ${inv.invoice_number}` : null]
    .filter(Boolean).join(' — ') || `Invoice ${invoiceId}`

  const { data: row, error } = await sb.from('cash_log').insert({
    date: inv.paid_date || new Date().toISOString().slice(0, 10),
    direction: 'inflow',
    type: 'invoice',
    description,
    amount,
    term_id: inv.term_id,
    invoice_id: invoiceId,
  }).select('id').single()
  // A failed log row must not fail the payment itself — the invoice is paid
  // either way, and the staff member can add the line by hand.
  return { cash_log: error ? `failed: ${error.message}` : 'added', cash_log_id: row?.id ?? null }
}

export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { invoice_id, field, value, paid_date } = await req.json()
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

    const patch = { [field]: value }
    // Payment date rides along with the paid status: set when marking paid
    // (defaults to today if the client sent none), cleared when un-marking.
    if (field === 'payment_status') {
      if (value === 'paid') {
        const d = typeof paid_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(paid_date)
          ? paid_date : new Date().toISOString().slice(0, 10)
        patch.paid_date = d
      } else {
        patch.paid_date = null
      }
    }

    const { error } = await sb.from('invoices').update(patch).eq('id', invoice_id)
    if (error) return Response.json({ error: error.message }, { status: 400 })

    // Cash invoices book themselves into the cash log when paid. Never let this
    // fail the payment: the invoice is already updated by here.
    let cashLog = {}
    if (field === 'payment_status') {
      try { cashLog = await syncCashLog(sb, invoice_id, value === 'paid') }
      catch (e) { cashLog = { cash_log: `failed: ${e.message}` } }
    }
    return Response.json({ success: true, patch, ...cashLog })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../../lib/apiAuth'
import { listPayRuns, PayrollScopeError } from '../../../../../lib/xeroPayroll'

function adminSb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * GET/POST /api/xero/payroll/reconcile
 * Pull pay-run statuses back from Xero and settle the portal to match:
 *
 *   1. Shifts stamped with a Xero pay run that is now POSTED flip
 *      approved → paid. This is the ground truth the push's double-pay guard
 *      reads, so a posted fortnight can never be pushed twice.
 *   2. A portal pay run (approved/exported) flips to paid once every
 *      bank-paid shift attached to it is paid. Cash shifts don't gate the
 *      flip — cash is settled in person and tracked via cash_pay_status.
 *   3. The Action-Centre bank reminder for that fortnight is marked done
 *      (same portal_settings key the dashboard writes).
 *
 * Read-only towards Xero; never touches a DRAFT run. Auth: Vercel cron
 * (Bearer CRON_SECRET) or a signed-in admin/director.
 */
async function reconcile(req) {
  const cronOk = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  if (!cronOk) {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const sb = adminSb()

    // Xero: which runs are posted?
    const xeroRuns = await listPayRuns()
    const postedIds = new Set(xeroRuns.filter(r => r.status === 'POSTED').map(r => r.id))

    // 1. Flip shifts on posted Xero runs to paid.
    const { data: stamped, error: stampedErr } = await sb
      .from('shifts')
      .select('id, xero_pay_run_id, pay_run_id')
      .eq('status', 'approved')
      .not('xero_pay_run_id', 'is', null)
    if (stampedErr) throw stampedErr
    const toPay = (stamped || []).filter(s => postedIds.has(s.xero_pay_run_id))
    if (toPay.length) {
      const { error } = await sb.from('shifts')
        .update({ status: 'paid' })
        .in('id', toPay.map(s => s.id))
      if (error) throw error
    }

    // 2. Portal runs whose bank shifts are now all paid → paid.
    const { data: openRuns, error: runsErr } = await sb
      .from('pay_runs')
      .select('id, period_start, period_end, status')
      .in('status', ['approved', 'exported'])
    if (runsErr) throw runsErr

    const [{ data: tRows }, { data: dRows }] = await Promise.all([
      sb.from('tutors').select('id, pay_method'),
      sb.from('directors').select('id, pay_method'),
    ])
    const payMethod = {}
    for (const r of [...(tRows || []), ...(dRows || [])]) payMethod[r.id] = r.pay_method || 'bank'

    const paidRuns = []
    for (const run of openRuns || []) {
      const { data: runShifts, error } = await sb
        .from('shifts')
        .select('id, tutor_id, status')
        .eq('pay_run_id', run.id)
      if (error) throw error
      const bank = (runShifts || []).filter(s => payMethod[s.tutor_id] !== 'cash')
      // Only flip runs Xero actually settled: at least one bank shift, all paid.
      if (!bank.length || !bank.every(s => s.status === 'paid')) continue
      const { error: upErr } = await sb.from('pay_runs')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', run.id)
      if (upErr) throw upErr
      paidRuns.push({ id: run.id, period: `${run.period_start} → ${run.period_end}` })

      // 3. Clear the Action-Centre bank reminder for this fortnight.
      const { data: doneRow } = await sb.from('portal_settings')
        .select('value').eq('key', 'payroll_alerts_done').maybeSingle()
      let done = []
      try { done = JSON.parse(doneRow?.value || '[]') } catch { /* reset */ }
      const key = `bank:${run.period_start}`
      if (!done.includes(key)) {
        done.push(key)
        await sb.from('portal_settings').upsert({
          key: 'payroll_alerts_done', value: JSON.stringify(done), updated_at: new Date().toISOString(),
        })
      }
    }

    return NextResponse.json({
      success: true,
      postedXeroRuns: postedIds.size,
      shiftsMarkedPaid: toPay.length,
      runsMarkedPaid: paidRuns,
    })
  } catch (err) {
    if (err instanceof PayrollScopeError || err.scope) {
      return NextResponse.json({ needsReconnect: true, error: err.message }, { status: 200 })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(req) { return reconcile(req) }
export async function POST(req) { return reconcile(req) }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../../lib/apiAuth'
import { getPayrollCalendars, getEarningsRates, getPayrollEmployees, PayrollScopeError } from '../../../../../lib/xeroPayroll'

function adminSb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * GET /api/xero/payroll/config
 * Everything the Xero Payroll settings panel needs: live Xero calendars /
 * earnings rates / employees, plus the portal's stored settings, employee map,
 * and staff list to match against.
 */
export async function GET(req) {
  const auth = await requireApiRole(req, ['admin', 'director'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sb = adminSb()
  const [{ data: settings }, { data: map }, { data: tutors }, { data: directors }] = await Promise.all([
    sb.from('xero_payroll_settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('xero_employee_map').select('*'),
    sb.from('tutors').select('id, full_name, email').order('full_name'),
    sb.from('directors').select('id, full_name, email').order('full_name'),
  ])

  const staff = [
    ...(tutors || []).map(t => ({ ...t, staff_table: 'tutors' })),
    ...(directors || []).map(d => ({ ...d, staff_table: 'directors' })),
  ].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))

  // Light mode: stored config only, no Xero round-trips. Used to decide whether
  // the "Push to Xero Payroll" button is ready without hitting the API on every
  // payroll page load.
  if (new URL(req.url).searchParams.get('light') === '1') {
    const configured = !!(settings?.payroll_calendar_id && settings?.earnings_rate_id && (map || []).length)
    return NextResponse.json({ light: true, configured, settings, map: map || [], staff })
  }

  let xero = { calendars: [], earningsRates: [], employees: [], connected: true }
  try {
    const [calendars, earningsRates, employees] = await Promise.all([
      getPayrollCalendars(), getEarningsRates(), getPayrollEmployees(),
    ])
    xero = { calendars, earningsRates, employees, connected: true }
  } catch (e) {
    if (e instanceof PayrollScopeError || e.scope) {
      return NextResponse.json({ needsReconnect: true, error: e.message, settings, map, staff }, { status: 200 })
    }
    return NextResponse.json({ error: e.message, settings, map, staff }, { status: 200 })
  }

  return NextResponse.json({ ...xero, settings, map: map || [], staff })
}

/**
 * POST /api/xero/payroll/config
 * Saves calendar/earnings-rate settings and/or the employee map.
 * body: { payroll_calendar_id?, earnings_rate_id?, send_rate?, map?: [{staff_id, staff_table, xero_employee_id, xero_name}] }
 */
export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const body = await req.json()
    const sb = adminSb()

    const s = {}
    for (const k of ['payroll_calendar_id', 'earnings_rate_id', 'payroll_from']) if (body[k] !== undefined) s[k] = body[k] || null
    if (body.send_rate !== undefined) s.send_rate = !!body.send_rate
    if (Object.keys(s).length) {
      s.id = 1; s.updated_at = new Date().toISOString()
      const { error } = await sb.from('xero_payroll_settings').upsert(s)
      if (error) throw error
    }

    if (Array.isArray(body.map)) {
      // Full replace of the mapping: clear rows the user unset, upsert the rest.
      const keep = body.map.filter(m => m.staff_id && m.xero_employee_id)
      const keepIds = keep.map(m => m.staff_id)
      const { data: existing } = await sb.from('xero_employee_map').select('staff_id')
      const toDelete = (existing || []).map(r => r.staff_id).filter(id => !keepIds.includes(id))
      if (toDelete.length) await sb.from('xero_employee_map').delete().in('staff_id', toDelete)
      if (keep.length) {
        const rows = keep.map(m => ({
          staff_id: m.staff_id, staff_table: m.staff_table || 'tutors',
          xero_employee_id: m.xero_employee_id, xero_name: m.xero_name || null,
          updated_at: new Date().toISOString(),
        }))
        const { error } = await sb.from('xero_employee_map').upsert(rows)
        if (error) throw error
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

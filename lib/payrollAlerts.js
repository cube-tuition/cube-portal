import { supabase } from './supabase'

/*
 * Payroll Action-Centre alerts.
 *
 * CUBE pays in term-aligned fortnights (W1-2, W3-4, … W9-10), but bank and cash
 * are processed on different schedules:
 *   • Bank transfers — processed the week AFTER the fortnight ends. Its Monday is
 *     14 days after the fortnight start; one combined reminder appears then.
 *   • Cash — processed in the LAST week of the fortnight (the second week, which
 *     starts 7 days after the fortnight start). One reminder per cash teacher on
 *     their chosen weekday within that last week.
 *
 * So at any moment the bank reminder and the cash reminders can refer to
 * different fortnights (cash is one fortnight "ahead" of bank).
 *
 * "Done" state is stored in portal_settings so it's shared across devices and
 * survives reloads. Each reminder clears itself for the rest of the cycle.
 */

const ALERTS_KEY = 'payroll_alerts_done'

// Pure calendar arithmetic on 'YYYY-MM-DD' strings via UTC, so it never drifts
// a day from the local timezone (the caller passes a local "today" string).
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
// Period start of fortnight idx (1..5): term start + (idx-1)*14 days.
function fortnightStart(term, idx) { return addDays(term.start_date, (idx - 1) * 14) }

export async function loadPayrollDone() {
  const { data } = await supabase.from('portal_settings').select('value').eq('key', ALERTS_KEY).maybeSingle()
  try { return JSON.parse(data?.value || '[]') } catch { return [] }
}

export async function markPayrollDone(key) {
  const list = await loadPayrollDone()
  if (!list.includes(key)) {
    list.push(key)
    await supabase.from('portal_settings').upsert({ key: ALERTS_KEY, value: JSON.stringify(list), updated_at: new Date().toISOString() })
  }
}

// Action-Centre items for the current pay obligation (section 'Payroll').
export async function payrollAlertItems(term, today) {
  if (!term?.start_date) return []

  // Latest fortnight whose "pay Monday" (fortnight start + offsetDays) has begun,
  // within a ~3-week nag window. Bank pays the week after (offset 14); cash pays
  // in the fortnight's last week (offset 7).
  const findTarget = (offsetDays) => {
    for (let idx = 5; idx >= 1; idx--) {
      const ps = fortnightStart(term, idx)
      const payMon = addDays(ps, offsetDays)
      if (today >= payMon) {
        if (today > addDays(payMon, 20)) return null   // too long ago — stop nagging
        return { idx, ps, pe: addDays(ps, 13), payMon }
      }
    }
    return null
  }

  const bankTarget = findTarget(14)   // bank: the week after the fortnight
  const cashTarget = findTarget(7)    // cash: the last (second) week of the fortnight
  if (!bankTarget && !cashTarget) return []

  const [done, tutorsRes, dirsRes, shiftsRes, paidRes] = await Promise.all([
    loadPayrollDone(),
    supabase.from('tutors').select('id, full_name, pay_method, cash_pay_weekday'),
    // Directors are paid via shifts too and have the same pay columns.
    supabase.from('directors').select('id, full_name, pay_method, cash_pay_weekday'),
    supabase.from('pay_run_shifts').select('tutor_id, amount, work_date')
      .gte('work_date', term.start_date).lte('work_date', term.end_date),
    // Cash pays already marked paid on the Payroll page (per tutor + pay run).
    supabase.from('cash_pay_status').select('tutor_id, pay_run:pay_runs(period_start)'),
  ])
  const tutors = [...(tutorsRes.data || []), ...(dirsRes.data || [])]
  const shifts = shiftsRes.data || []
  // Set of `${tutor_id}:${fortnight_start}` already paid — those reminders are cleared.
  const paidSet = new Set(
    (paidRes.data || [])
      .map(r => (r.pay_run?.period_start ? `${r.tutor_id}:${r.pay_run.period_start}` : null))
      .filter(Boolean)
  )
  // Sum each tutor's pay within one fortnight window.
  const amountIn = (ps, pe) => {
    const m = {}
    for (const s of shifts) {
      if (s.work_date >= ps && s.work_date <= pe) m[s.tutor_id] = (m[s.tutor_id] || 0) + Number(s.amount || 0)
    }
    return m
  }
  const money = (n) => `$${Number(n).toFixed(2)}`
  const label = (t) => `Wk ${t.idx * 2 - 1}–${t.idx * 2}`
  const items = []

  // ── Bank transfers — one combined reminder, the Monday after the fortnight ──
  if (bankTarget) {
    const amount = amountIn(bankTarget.ps, bankTarget.pe)
    const bankTutors = tutors.filter(t => (t.pay_method || '').toLowerCase().startsWith('bank'))
    const bankTotal = bankTutors.reduce((a, t) => a + (amount[t.id] || 0), 0)
    const bankCount = bankTutors.filter(t => (amount[t.id] || 0) > 0).length
    const bankKey = `bank:${bankTarget.ps}`
    if (bankTotal > 0 && !done.includes(bankKey)) {
      items.push({
        severity: 'amber', icon: '🏦', count: bankCount, section: 'Payroll',
        label: `send bank-transfer payroll (${label(bankTarget)})`,
        detail: `${money(bankTotal)} across ${bankCount} tutor${bankCount === 1 ? '' : 's'} — due since the Monday after the fortnight.`,
        href: '/tutor/payroll', done: { payrollKey: bankKey },
      })
    }
  }

  // ── Cash — one reminder per cash teacher, in the fortnight's last week ──
  if (cashTarget) {
    const amount = amountIn(cashTarget.ps, cashTarget.pe)
    for (const t of tutors) {
      if ((t.pay_method || '').toLowerCase() !== 'cash') continue
      const a = amount[t.id] || 0
      if (a <= 0) continue
      if (paidSet.has(`${t.id}:${cashTarget.ps}`)) continue   // already marked paid on the Payroll page
      if (!t.cash_pay_weekday) continue           // no pay day set → handled separately as a hint
      const payDate = addDays(cashTarget.payMon, t.cash_pay_weekday - 1)  // weekday within the last week
      if (today < payDate) continue               // not their day yet
      const key = `cash:${t.id}:${cashTarget.ps}`
      if (done.includes(key)) continue
      items.push({
        severity: 'amber', icon: '💵', count: 1, section: 'Payroll',
        label: `pay ${t.full_name} in cash`,
        detail: `${money(a)} for ${label(cashTarget)} — cash pay day (last week of the fortnight).`,
        href: '/tutor/payroll', done: { payrollKey: key },
      })
    }

    // ── Hint: cash teachers with pay owing but no pay day set ──
    const unsetCash = tutors.filter(t => (t.pay_method || '').toLowerCase() === 'cash' && (amount[t.id] || 0) > 0 && !t.cash_pay_weekday && !paidSet.has(`${t.id}:${cashTarget.ps}`))
    if (unsetCash.length) {
      items.push({
        severity: 'blue', icon: '🗓', count: unsetCash.length, section: 'Payroll',
        label: 'cash teachers have no pay day set',
        detail: 'Set a pay day in the Cash pay schedule so reminders appear automatically.',
        href: '/tutor/payroll',
      })
    }
  }

  return items
}

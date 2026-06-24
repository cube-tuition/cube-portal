import { supabase } from './supabase'

/*
 * Payroll Action-Centre alerts.
 *
 * CUBE pays in term-aligned fortnights (W1-2, W3-4, … W9-10). The "pay week" is
 * the week AFTER a fortnight ends — its Monday is 14 days after the fortnight's
 * start. We surface:
 *   • Bank transfers — one reminder on the Monday after each fortnight to send
 *     the bank-transfer pay run (with the total + tutor count).
 *   • Cash — one reminder per cash teacher, on their chosen weekday within the
 *     pay week, showing the amount to hand over.
 *
 * "Done" state is stored in portal_settings so it's shared across devices and
 * survives reloads. Each reminder clears itself for the rest of the cycle.
 */

const ALERTS_KEY = 'payroll_alerts_done'

const isoOf = (d) => d.toISOString().slice(0, 10)
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
// Period start of fortnight idx (1..5): term start + (idx-1)*14 days.
function fortnightStart(term, idx) { const d = new Date(term.start_date + 'T00:00:00'); d.setDate(d.getDate() + (idx - 1) * 14); return isoOf(d) }

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

  // Latest fortnight whose pay week (start + 14 days) has already begun.
  let target = null
  for (let idx = 5; idx >= 1; idx--) {
    const ps = fortnightStart(term, idx)
    const payWeekMon = addDays(ps, 14)
    if (today >= payWeekMon) { target = { idx, ps, pe: addDays(ps, 13), payWeekMon }; break }
  }
  if (!target) return []
  // Stop nagging ~3 weeks after the pay week (e.g. deep into the next term).
  if (today > addDays(target.payWeekMon, 20)) return []

  const [done, tutorsRes, shiftsRes] = await Promise.all([
    loadPayrollDone(),
    supabase.from('tutors').select('id, full_name, pay_method, cash_pay_weekday'),
    supabase.from('pay_run_shifts').select('tutor_id, amount').gte('work_date', target.ps).lte('work_date', target.pe),
  ])
  const tutors = tutorsRes.data || []
  const amount = {}
  for (const s of shiftsRes.data || []) amount[s.tutor_id] = (amount[s.tutor_id] || 0) + Number(s.amount || 0)

  const label = `Wk ${target.idx * 2 - 1}–${target.idx * 2}`
  const money = (n) => `$${Number(n).toFixed(2)}`
  const items = []

  // ── Bank transfers — one combined reminder ──
  const bankTutors = tutors.filter(t => (t.pay_method || '').toLowerCase().startsWith('bank'))
  const bankTotal = bankTutors.reduce((a, t) => a + (amount[t.id] || 0), 0)
  const bankCount = bankTutors.filter(t => (amount[t.id] || 0) > 0).length
  const bankKey = `bank:${target.ps}`
  if (bankTotal > 0 && !done.includes(bankKey)) {
    items.push({
      severity: 'amber', icon: '🏦', count: bankCount, section: 'Payroll',
      label: `send bank-transfer payroll (${label})`,
      detail: `${money(bankTotal)} across ${bankCount} tutor${bankCount === 1 ? '' : 's'} — due since the Monday after the fortnight.`,
      href: '/tutor/payroll', done: { payrollKey: bankKey },
    })
  }

  // ── Cash — one reminder per cash teacher, on their pay day ──
  for (const t of tutors) {
    if ((t.pay_method || '').toLowerCase() !== 'cash') continue
    const a = amount[t.id] || 0
    if (a <= 0) continue
    if (!t.cash_pay_weekday) continue           // no pay day set → handled separately as a hint
    const payDate = addDays(target.payWeekMon, t.cash_pay_weekday - 1)
    if (today < payDate) continue               // not their day yet
    const key = `cash:${t.id}:${target.ps}`
    if (done.includes(key)) continue
    items.push({
      severity: 'amber', icon: '💵', count: 1, section: 'Payroll',
      label: `pay ${t.full_name} in cash`,
      detail: `${money(a)} for ${label} — cash pay day.`,
      href: '/tutor/payroll', done: { payrollKey: key },
    })
  }

  // ── Hint: cash teachers with pay owing but no pay day set ──
  const unsetCash = tutors.filter(t => (t.pay_method || '').toLowerCase() === 'cash' && (amount[t.id] || 0) > 0 && !t.cash_pay_weekday)
  if (unsetCash.length) {
    items.push({
      severity: 'blue', icon: '🗓', count: unsetCash.length, section: 'Payroll',
      label: 'cash teachers have no pay day set',
      detail: 'Set a pay day in the Cash pay schedule so reminders appear automatically.',
      href: '/tutor/payroll',
    })
  }

  return items
}

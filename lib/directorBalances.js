import { supabase } from './supabase'
import { T_CASH_LOG, T_CASH_PAY_STATUS, T_DIRECTOR_BALANCES } from './tables'
import { isoDate } from './format'

/*
 * Director balances — what a director owes CUBE, and how it is paid down.
 * Shared by the payroll cash schedule (settle a fortnight's pay by OFFSET
 * against the balance instead of handing cash over) and the accounting
 * dashboard (the ledger, the net position on the overdue-pay board).
 *
 * Ledger rows: kind 'debt' raises the balance; 'offset' and 'repayment'
 * lower it. Balance = Σ debt − Σ (offset + repayment), never below zero.
 */

export async function loadDirectorBalances() {
  const { data } = await supabase.from(T_DIRECTOR_BALANCES).select('*').order('date').order('created_at')
  return data || []
}

export const isDebit = (row) => row.kind === 'debt'

/** Balance per staff id from ledger rows. */
export function balancesByStaff(rows = []) {
  const out = {}
  for (const r of rows) {
    const n = Number(r.amount) || 0
    out[r.staff_id] = (out[r.staff_id] || 0) + (isDebit(r) ? n : -n)
  }
  for (const k of Object.keys(out)) out[k] = Math.max(0, Math.round(out[k] * 100) / 100)
  return out
}

/** Rows for one director with a running balance, oldest first. */
export function ledgerFor(rows = [], staffId) {
  let bal = 0
  return rows.filter(r => r.staff_id === staffId).map(r => {
    const n = Number(r.amount) || 0
    bal += isDebit(r) ? n : -n
    return { ...r, running: Math.round(bal * 100) / 100 }
  })
}

/** A new debt (or a cash repayment) entered by hand. */
export async function addLedgerEntry({ staff, kind, amount, description, date, createdBy }) {
  const n = Math.abs(Number(amount) || 0)
  if (!n) throw new Error('Enter an amount.')
  const { data, error } = await supabase.from(T_DIRECTOR_BALANCES).insert({
    staff_id: staff.id, staff_name: staff.full_name, kind, amount: n,
    description: (description || '').trim(), date: date || isoDate(new Date()), created_by: createdBy || null,
  }).select('*').single()
  if (error) throw error
  return data
}

export async function deleteLedgerEntry(row) {
  if (row.kind === 'offset') return undoOffset(row)
  const { error } = await supabase.from(T_DIRECTOR_BALANCES).delete().eq('id', row.id)
  if (error) throw error
}

/*
 * Settle `amount` of a director's pay for `run` against their balance. No
 * cash moves, but two cash-log rows keep both stories straight — the wages
 * are paid (outflow) and the debt is repaid (inflow) — so wage totals and
 * cash on hand both stay truthful. The pay-status row for the run is raised
 * by the amount (created if absent), which is what clears the overdue board.
 */
export async function recordOffset({ staff, run, termId, label, amount, existingStatus, createdBy }) {
  const n = Math.abs(Number(amount) || 0)
  if (!n) throw new Error('Enter an amount.')
  const first = (staff.full_name || '').split(' ')[0] || staff.full_name
  const today = isoDate(new Date())
  const { data: out, error: e1 } = await supabase.from(T_CASH_LOG).insert({
    date: today, direction: 'outflow', type: 'wages', term_id: termId || null,
    description: `${first} - ${label} - offset against balance`, amount: -n,
  }).select('id').single()
  if (e1) throw e1
  const { data: inn, error: e2 } = await supabase.from(T_CASH_LOG).insert({
    date: today, direction: 'inflow', type: 'repayment', term_id: termId || null,
    description: `${first} - repayment by pay offset (${label})`, amount: n,
  }).select('id').single()
  if (e2) { await supabase.from(T_CASH_LOG).delete().eq('id', out.id); throw e2 }

  let status
  if (existingStatus) {
    const { data, error } = await supabase.from(T_CASH_PAY_STATUS)
      .update({ amount: (Number(existingStatus.amount) || 0) + n }).eq('id', existingStatus.id).select('*').single()
    if (error) throw error
    status = data
  } else {
    const { data, error } = await supabase.from(T_CASH_PAY_STATUS)
      .insert({ pay_run_id: run.id, tutor_id: staff.id, amount: n, cash_log_id: out.id }).select('*').single()
    if (error) { await supabase.from(T_CASH_LOG).delete().in('id', [out.id, inn.id]); throw error }
    status = data
  }
  const { data: row, error: e3 } = await supabase.from(T_DIRECTOR_BALANCES).insert({
    staff_id: staff.id, staff_name: staff.full_name, date: today, kind: 'offset', amount: n,
    description: `Pay offset · ${label}`, pay_run_id: run.id,
    cash_log_out_id: out.id, cash_log_in_id: inn.id, cash_pay_status_id: status.id, created_by: createdBy || null,
  }).select('*').single()
  if (e3) throw e3
  return { row, status }
}

/** Reverse an offset: both cash-log rows go, the pay status shrinks (or goes), the ledger row goes. */
export async function undoOffset(row) {
  const n = Number(row.amount) || 0
  if (row.cash_pay_status_id) {
    const { data: st } = await supabase.from(T_CASH_PAY_STATUS).select('*').eq('id', row.cash_pay_status_id).maybeSingle()
    if (st) {
      const left = Math.round(((Number(st.amount) || 0) - n) * 100) / 100
      if (left > 0) await supabase.from(T_CASH_PAY_STATUS).update({ amount: left }).eq('id', st.id)
      else await supabase.from(T_CASH_PAY_STATUS).delete().eq('id', st.id)
    }
  }
  const ids = [row.cash_log_out_id, row.cash_log_in_id].filter(v => v != null)
  if (ids.length) await supabase.from(T_CASH_LOG).delete().in('id', ids)
  const { error } = await supabase.from(T_DIRECTOR_BALANCES).delete().eq('id', row.id)
  if (error) throw error
}

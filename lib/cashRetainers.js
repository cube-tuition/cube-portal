/*
 * Director retainers — $300 cash per fortnight, on top of shift pay. Shared by
 * the accounting dashboard (overdue-pay board, term cash snapshot) and the
 * payroll cash schedule so the amount owed and the amount marked paid always
 * agree. A retainer attaches to a pay run: it is owed alongside that run's
 * shifts and is settled by the same Mark-paid action (cash_pay_status row).
 */
export const CASH_RETAINERS = [
  { name: 'Ryan',  perFortnight: 300 },
  { name: 'Aiden', perFortnight: 300 },
]

/** Fortnightly retainer for a staff member, matched on first name. */
export function fortnightlyRetainerFor(fullName) {
  const first = (fullName || '').trim().split(/\s+/)[0].toLowerCase()
  return CASH_RETAINERS.find(r => r.name.toLowerCase() === first)?.perFortnight || 0
}

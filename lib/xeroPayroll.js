/**
 * lib/xeroPayroll.js — Xero Payroll AU API helper (server-side only)
 * ─────────────────────────────────────────────────────────────────
 * Wraps the Payroll AU API (payroll.xro/1.0), separate from the Accounting
 * API in lib/xero.js. Shares the same OAuth token (getValidToken) — the token
 * must have been granted the payroll.* scopes (see app/api/xero/auth).
 *
 * SAFETY: nothing here ever POSTs a pay run to 'POSTED'. The portal only
 * creates and edits DRAFT pay runs; a human posts it in Xero, which is what
 * files STP with the ATO. Keep it that way.
 */
import { getValidToken } from './xero'

const PAYROLL_BASE = 'https://api.xero.com/payroll.xro/1.0'

async function payrollFetch(path, { method = 'GET', body } = {}) {
  const { access_token, tenant_id } = await getValidToken()
  const res = await fetch(`${PAYROLL_BASE}${path}`, {
    method,
    headers: {
      Authorization:    `Bearer ${access_token}`,
      'Xero-Tenant-Id': tenant_id,
      'Content-Type':   'application/json',
      Accept:           'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 429) throw new Error('Xero rate limit hit — wait 60 seconds then try again')
  const text = await res.text()
  if (res.status === 401 || res.status === 403) {
    // Almost always a missing payroll scope on an older connection.
    throw new PayrollScopeError(`Xero payroll access not granted (${res.status}). Reconnect Xero to grant Payroll access. ${text.slice(0, 160)}`)
  }
  if (!res.ok) throw new Error(`Xero Payroll ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`)
  if (!text) return {}
  try { return JSON.parse(text) } catch {
    throw new Error(`Xero Payroll ${method} ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }
}

export class PayrollScopeError extends Error {
  constructor(msg) { super(msg); this.name = 'PayrollScopeError'; this.scope = true }
}

// Xero AU payroll serialises dates as "/Date(1493942400000+0000)/". Parse to ISO
// (yyyy-mm-dd) for display/comparison; pass through anything already ISO.
export function parseXeroDate(v) {
  if (!v) return null
  const m = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(String(v))
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10)
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Payroll calendars (pay cycles). Returns [{ id, name, type }]. */
export async function getPayrollCalendars() {
  const json = await payrollFetch('/PayrollCalendars')
  return (json.PayrollCalendars || []).map(c => ({
    id:   c.PayrollCalendarID,
    name: c.Name,
    type: c.CalendarType,
  }))
}

/** Ordinary/earnings pay items. Returns [{ id, name, type }]. */
export async function getEarningsRates() {
  const json = await payrollFetch('/PayItems')
  const rates = json.PayItems?.EarningsRates || json.EarningsRates || []
  return rates.map(r => ({
    id:   r.EarningsRateID,
    name: r.Name,
    type: r.RateType || r.EarningsType,
  }))
}

/** Active employees. Returns [{ id, first, last, name, email, status }]. */
export async function getPayrollEmployees() {
  const json = await payrollFetch('/Employees')
  return (json.Employees || []).map(e => ({
    id:     e.EmployeeID,
    first:  e.FirstName || '',
    last:   e.LastName || '',
    name:   `${e.FirstName || ''} ${e.LastName || ''}`.trim(),
    email:  e.Email || null,
    status: e.Status,
  }))
}

/** One pay run incl. its payslip stubs. Returns null if not found. */
export async function getPayRun(payRunID) {
  const json = await payrollFetch(`/PayRuns/${payRunID}`)
  const pr = (json.PayRuns || [])[0]
  if (!pr) return null
  return normalisePayRun(pr)
}

/** All pay runs (summary). Returns [{ id, calendarId, status, periodStart, periodEnd }]. */
export async function listPayRuns() {
  const json = await payrollFetch('/PayRuns')
  return (json.PayRuns || []).map(normalisePayRun)
}

function normalisePayRun(pr) {
  return {
    id:          pr.PayRunID,
    calendarId:  pr.PayrollCalendarID,
    status:      pr.PayRunStatus,
    periodStart: parseXeroDate(pr.PayRunPeriodStartDate),
    periodEnd:   parseXeroDate(pr.PayRunPeriodEndDate),
    paymentDate: parseXeroDate(pr.PaymentDate),
    payslips:    (pr.Payslips || []).map(p => ({
      payslipId:  p.PayslipID,
      employeeId: p.EmployeeID,
      name:       `${p.FirstName || ''} ${p.LastName || ''}`.trim(),
    })),
  }
}

/**
 * Create a DRAFT pay run for a calendar. Xero auto-generates a payslip for every
 * employee on that calendar (from their pay template) and picks the period as the
 * calendar's next unprocessed one — we don't get to choose it. Returns the new
 * pay run (normalised, incl. payslip stubs) after re-fetching it.
 */
export async function createDraftPayRun(payrollCalendarId) {
  const json = await payrollFetch('/PayRuns', {
    method: 'POST',
    body: { PayRuns: [{ PayrollCalendarID: payrollCalendarId }] },
  })
  const created = (json.PayRuns || [])[0]
  if (!created?.PayRunID) throw new Error('Xero did not return a pay run id')
  if (created.PayRunStatus && created.PayRunStatus !== 'DRAFT') {
    throw new Error(`Refusing to touch a ${created.PayRunStatus} pay run — expected DRAFT`)
  }
  return await getPayRun(created.PayRunID)
}

/**
 * Set a single ordinary-hours earnings line on a DRAFT payslip.
 * Sends hours (NumberOfUnits) and, optionally, the portal's $/h (ratePerUnit).
 * Only ever call this for payslips on a DRAFT pay run.
 */
export async function setPayslipHours(payslipId, { earningsRateId, hours, ratePerUnit }) {
  const line = { EarningsRateID: earningsRateId, NumberOfUnits: Number(hours) }
  if (ratePerUnit != null && Number.isFinite(Number(ratePerUnit))) line.RatePerUnit = Number(ratePerUnit)
  return await payrollFetch(`/Payslip/${payslipId}`, {
    method: 'POST',
    body: { EarningsLines: [line] },
  })
}

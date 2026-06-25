import { NextResponse } from 'next/server'
import { getValidToken } from '../../../../lib/xero'
import { requireApiRole } from '../../../../lib/apiAuth'

/**
 * GET /api/xero/accounts
 * Returns Xero chart-of-accounts entries suitable for invoice line item mapping.
 * Filters to REVENUE + SALES account types and adds tax types.
 */
export async function GET(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { access_token, tenant_id } = await getValidToken()

    const res = await fetch('https://api.xero.com/api.xro/2.0/Accounts', {
      headers: {
        Authorization:    `Bearer ${access_token}`,
        'Xero-Tenant-Id': tenant_id,
        Accept:           'application/json',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Xero API error (${res.status}): ${text.slice(0, 200)}` }, { status: res.status })
    }

    const { Accounts } = await res.json()

    // Return all active accounts that can appear on an invoice line item.
    // Exclude bank/system types that can never be used on invoice lines.
    const EXCLUDE_TYPES = new Set(['BANK', 'CURRLIAB', 'LIABILITY', 'EQUITY', 'ASSET',
      'CURRENT', 'FIXED', 'NONCURRENT', 'PREPAYMENT', 'TERMLIAB',
      'PAYGLIABILITY', 'SUPERANNUATIONLIABILITY', 'WAGESPAYABLELIABILITY'])

    const relevant = (Accounts || [])
      .filter(a => a.Status === 'ACTIVE' && !EXCLUDE_TYPES.has(a.Type))
      .map(a => ({
        code:    a.Code,
        name:    a.Name,
        type:    a.Type,
        taxType: a.TaxType,
      }))
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''))

    // Also return available tax types for the tax type selector
    const TAX_TYPES = [
      { value: 'OUTPUT2',     label: 'GST on Income (10%)' },
      { value: 'BASEXCLUDED', label: 'GST Free' },
      { value: 'NONE',        label: 'No Tax' },
    ]

    return NextResponse.json({ accounts: relevant, taxTypes: TAX_TYPES })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

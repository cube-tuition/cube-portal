import { NextResponse } from 'next/server'
import { getValidToken } from '../../../../lib/xero'
import { requireApiRole } from '../../../../lib/apiAuth'

/**
 * GET /api/xero/items
 * Returns Xero Products & Services items that are active and sellable.
 * These are used to map portal courses to Xero line items, so Xero
 * handles the account code / tax type internally.
 */
export async function GET(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { access_token, tenant_id } = await getValidToken()

    const res = await fetch('https://api.xero.com/api.xro/2.0/Items', {
      headers: {
        Authorization:    `Bearer ${access_token}`,
        'Xero-Tenant-Id': tenant_id,
        Accept:           'application/json',
      },
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `Xero API error (${res.status}): ${text.slice(0, 200)}` },
        { status: res.status }
      )
    }

    const { Items } = await res.json()

    // Only return items that can appear on a sales invoice (have a sales account)
    const sellable = (Items || [])
      .filter(item => item.IsTrackedAsInventory === false || item.SalesDetails?.AccountCode)
      .filter(item => item.IsSold !== false)
      .map(item => ({
        code:        item.Code,
        name:        item.Name,
        description: item.Description || '',
        accountCode: item.SalesDetails?.AccountCode || '',
        unitPrice:   item.SalesDetails?.UnitPrice ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ items: sellable })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

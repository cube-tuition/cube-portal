import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function adminSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

/**
 * GET /api/xero/item-mappings?term_id=...
 *
 * Returns:
 *   - mappings: all saved class_name → item_code rows
 *   - courseNames: unique class names from invoices in the given term
 */
export async function GET(req) {
  const sb = adminSb()
  const { searchParams } = new URL(req.url)
  const termId = searchParams.get('term_id')

  const [{ data: mappings, error: mapErr }, courseResult] = await Promise.all([
    sb.from('xero_item_mappings').select('*').order('class_name'),
    termId
      ? sb.from('invoices')
          .select('line_items')
          .eq('term_id', termId)
          .not('line_items', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 })

  const courseNames = [...new Set(
    (courseResult.data || [])
      .flatMap(inv => (inv.line_items || []))
      .filter(l => l.type === 'enrolment' && l.class_name)
      .map(l => l.class_name)
  )].sort()

  return NextResponse.json({ mappings: mappings || [], courseNames })
}

/**
 * POST /api/xero/item-mappings
 * Body: { mappings: [{ class_name, item_code, item_name }] }
 */
export async function POST(req) {
  try {
    const { mappings } = await req.json()
    if (!Array.isArray(mappings)) {
      return NextResponse.json({ error: 'mappings must be an array' }, { status: 400 })
    }

    const sb = adminSb()
    const now = new Date().toISOString()

    const rows = mappings.map(({ class_name, item_code, item_name }) => ({
      class_name,
      item_code: item_code || null,
      item_name: item_name || null,
      updated_at: now,
    }))

    const { error } = await sb
      .from('xero_item_mappings')
      .upsert(rows, { onConflict: 'class_name' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, saved: rows.length })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

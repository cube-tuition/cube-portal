import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../lib/apiAuth'

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
 *   - courseNames: unique class names from invoices in the given term, with
 *     retired courses left out
 *   - hiddenCourseNames: exactly the names that were left out — those the
 *     client would otherwise have listed, from this term's invoices or from a
 *     saved mapping — so it can drop them too and say how many it dropped
 */
export async function GET(req) {
  const auth = await requireApiRole(req, ['admin', 'director'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sb = adminSb()
  const { searchParams } = new URL(req.url)
  const termId = searchParams.get('term_id')

  const [{ data: mappings, error: mapErr }, courseResult, { data: classRows }, { data: courseRows }] =
    await Promise.all([
      sb.from('xero_item_mappings').select('*').order('class_name'),
      termId
        ? sb.from('invoices')
            .select('line_items')
            .eq('term_id', termId)
            .not('line_items', 'is', null)
        : Promise.resolve({ data: [] }),
      // Deliberately cross-term: mappings are keyed by class NAME, which spans
      // every term the course has run, so the active/retired verdict for a name
      // has to consider all of them. Nothing here is listed per row.
      sb.from('classes').select('id, class_name, course_id'),
      sb.from('courses').select('id, active'),
    ])

  if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 })

  const courseActive = Object.fromEntries((courseRows || []).map(c => [c.id, c.active]))
  // A name is only treated as retired when EVERY class carrying it belongs to a
  // retired course. A name shared with a course that still runs stays listed,
  // as does one whose course row can't be resolved — hiding a course staff still
  // invoice for would silently drop it from the Xero item mapping.
  const nameStillRuns = {}
  for (const c of classRows || []) {
    const retired = c.course_id != null && courseActive[c.course_id] === false
    nameStillRuns[c.class_name] = (nameStillRuns[c.class_name] || false) || !retired
  }
  const retired = new Set(Object.keys(nameStillRuns).filter(n => !nameStillRuns[n]))

  // Invoice lines can carry a customised label ("… (Holiday 6 lessons)") while
  // still pointing at their class via class_id. Collapse every label variant
  // back to the class's canonical name so each course appears exactly once.
  const lines = (courseResult.data || [])
    .flatMap(inv => (inv.line_items || []))
    .filter(l => l.type === 'enrolment' && l.class_name)
  const nameById = Object.fromEntries((classRows || []).map(c => [c.id, c.class_name]))
  const invoiceNames = [...new Set(lines.map(l => nameById[l.class_id] || l.class_name))]

  // Count as hidden only what the client would actually have shown, so the
  // "n retired courses hidden" note can't over- or under-report: a retired
  // course invisible this term is not something the user is missing. This set
  // must mirror the client's union — invoiced names, plus saved mappings that
  // actually carry an item code.
  const listed = new Set([
    ...invoiceNames,
    ...(mappings || []).filter(m => m.item_code).map(m => m.class_name),
  ])
  const hiddenCourseNames = [...listed].filter(n => retired.has(n)).sort()

  const courseNames = invoiceNames.filter(n => !retired.has(n)).sort()

  return NextResponse.json({ mappings: mappings || [], courseNames, hiddenCourseNames })
}

/**
 * POST /api/xero/item-mappings
 * Body: { mappings: [{ class_name, item_code, item_name }] }
 */
export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

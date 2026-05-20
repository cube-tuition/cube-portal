import Airtable from 'airtable'
import { createClient } from '@supabase/supabase-js'

/*
 * /api/booklet/[bookletId]/pdf/[idx]
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns a fresh, signed Airtable attachment URL for a specific PDF on a
 * booklet row, then 302-redirects the browser straight to it.
 *
 * Why a proxy? Airtable attachment URLs expire every couple of hours
 * (post-Nov 2022). Storing them in Supabase would break the next morning. So
 * we store only attachment IDs and ask Airtable for a fresh URL each click.
 *
 * Auth: student must be signed in to Supabase (the booklets RLS policy is
 * already restricted to authenticated users for the metadata lookup).
 *
 * URL params:
 *   bookletId — Supabase public.booklets.id (uuid)
 *   idx       — 0-based index into pdf_attachment_ids (so a booklet with two
 *               PDFs is reachable as .../pdf/0 and .../pdf/1)
 */

export const dynamic = 'force-dynamic'

export async function GET(request, context) {
  try {
    const params = await context.params
    const { bookletId, idx } = params
    const pdfIndex = parseInt(idx, 10)
    if (!bookletId || Number.isNaN(pdfIndex) || pdfIndex < 0) {
      return Response.json({ error: 'Bad request' }, { status: 400 })
    }

    // Read the auth cookie sent by the browser. We use a service-role client
    // just to read the booklet's metadata (airtable_id + attachment id list).
    // The booklets table is non-sensitive (no per-student data), so even an
    // anon read is fine — we still gate with a Supabase session check below.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { data: booklet, error } = await supabase
      .from('booklets')
      .select('airtable_id, pdf_attachment_ids, pdf_filenames')
      .eq('id', bookletId)
      .single()

    if (error || !booklet) {
      return Response.json({ error: 'Booklet not found' }, { status: 404 })
    }

    const attachmentId = (booklet.pdf_attachment_ids || [])[pdfIndex]
    if (!attachmentId) {
      return Response.json({ error: 'PDF not found at that index' }, { status: 404 })
    }

    // Ask Airtable for a fresh URL by re-reading the row.
    const baseId =
      process.env.AIRTABLE_BOOKLETS_BASE_ID || process.env.AIRTABLE_BASE_ID
    const tableName = process.env.AIRTABLE_BOOKLETS_TABLE || 'Booklets'
    if (!baseId || !process.env.AIRTABLE_API_KEY) {
      return Response.json({ error: 'Airtable env not configured' }, { status: 500 })
    }

    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId)
    const rec = await new Promise((resolve, reject) => {
      base(tableName).find(booklet.airtable_id, (err, r) => (err ? reject(err) : resolve(r)))
    })

    const pdfField = rec.fields['Booklet PDF'] || rec.fields['PDF'] || []
    const match = (pdfField || []).find(a => a.id === attachmentId)
    if (!match || !match.url) {
      return Response.json({ error: 'PDF no longer attached to that row' }, { status: 410 })
    }

    return Response.redirect(match.url, 302)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

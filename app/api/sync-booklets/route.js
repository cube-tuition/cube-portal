import Airtable from 'airtable'
import { createClient } from '@supabase/supabase-js'
import { T_BOOKLETS } from '../../../lib/tables'

/*
 * /api/sync-booklets
 * ─────────────────────────────────────────────────────────────────────────────
 * Pulls the Airtable Booklets table from the booklets base
 * (env: AIRTABLE_BOOKLETS_BASE_ID, table name in AIRTABLE_BOOKLETS_TABLE)
 * and upserts each row into public.booklets, keyed by airtable_id.
 *
 * Each Airtable row holds:
 *   - Booklet Name             primary, formula
 *   - Week                     single select 1..10
 *   - Term                     single select "Term 1".."Term 4"
 *   - Booklet                  linked record → master catalog
 *   - Booklet PDF              attachment (can be multiple PDFs)
 *   - Year (from Booklet)      lookup → array, e.g. [8]
 *   - Subject (from Booklet)   lookup → array, e.g. ["Maths"]
 *
 * We don't store the PDF URLs themselves (Airtable rotates them every few
 * hours). We store the attachment IDs + filenames; the portal then asks the
 * /api/booklet/[id]/pdf/[idx] proxy for a fresh URL when a student clicks.
 *
 * Auth: Bearer ${CRON_SECRET}.
 *
 * Query params:
 *   ?term=Term 1   (or "Term 1"/"Term 2"/...) — only sync that term's rows
 *   ?dry=1         — don't write; return what would happen
 */

const pickField = (fields, candidates) => {
  const keys = Object.keys(fields)
  for (const want of candidates) {
    const hit = keys.find(k => k.toLowerCase() === want.toLowerCase())
    if (hit && fields[hit] != null && fields[hit] !== '') return fields[hit]
  }
  return null
}

// Lookups come back as arrays; flatten + take first non-empty
const firstOf = (v) => (Array.isArray(v) ? v.find(x => x != null && x !== '') : v) ?? null

const parseTermNumber = (raw) => {
  if (raw == null) return null
  const s = String(raw).trim()
  const m = s.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

const parseInt10 = (v) => {
  if (v == null) return null
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const termFilter = url.searchParams.get('term')
  const dryRun = url.searchParams.get('dry') === '1'

  try {
    const baseId =
      process.env.AIRTABLE_BOOKLETS_BASE_ID || process.env.AIRTABLE_BASE_ID
    const tableName = process.env.AIRTABLE_BOOKLETS_TABLE || 'Booklets'

    if (!baseId) {
      return Response.json({ error: 'AIRTABLE_BOOKLETS_BASE_ID not set' }, { status: 500 })
    }

    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const records = await new Promise((resolve, reject) => {
      const all = []
      base(tableName).select().eachPage(
        (page, fetchNext) => { all.push(...page); fetchNext() },
        (err) => err ? reject(err) : resolve(all)
      )
    })

    const stats = {
      total_airtable_rows: records.length,
      upserted: 0,
      skipped: [],
      unknown_year: [],
      unknown_subject: [],
      no_pdf: [],
    }

    // For dry-run debugging, surface the actual fields from rows that have
    // booklet data (a Booklet Name). Empty placeholder rows only show
    // [Year Level, Subject, Term, Week] which doesn't help us spot PDF/lookup
    // field names. Show full field name + a 60-char preview of the value.
    const dataRichSamples = dryRun
      ? records
          .filter(r => {
            const f = r.fields || {}
            return Object.keys(f).length > 4 // has more than the 4 always-set fields
          })
          .slice(0, 3)
          .map(r => ({
            airtable_id: r.id,
            fields: Object.fromEntries(
              Object.entries(r.fields || {}).map(([k, v]) => {
                if (Array.isArray(v)) {
                  return [k, v.map(x =>
                    typeof x === 'object'
                      ? { id: x.id, filename: x.filename, type: x.type }
                      : x
                  )]
                }
                return [k, typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : v]
              })
            ),
          }))
      : null

    for (const rec of records) {
      const f = rec.fields || {}
      const termRaw = pickField(f, ['Term'])
      if (termFilter && termRaw !== termFilter) continue

      const name = pickField(f, ['Booklet Name', 'Name', 'Title'])
      const week = parseInt10(pickField(f, ['Week']))
      const termN = parseTermNumber(termRaw)
      const year = parseInt10(firstOf(pickField(f, ['Year Level', 'Year (from Booklet)', 'Year'])))
      const subject = firstOf(pickField(f, ['Subject (from Booklet)', 'Subject']))
      const pdfs = pickField(f, ['Booklet PDF', 'Booklet PDFs', 'PDF', 'PDFs', 'Attachment', 'Attachments']) || []

      if (!name) {
        stats.skipped.push({ airtable_id: rec.id, reason: 'no booklet name' })
        continue
      }
      if (year == null)    stats.unknown_year.push(rec.id)
      if (!subject)        stats.unknown_subject.push(rec.id)
      if (!Array.isArray(pdfs) || pdfs.length === 0) stats.no_pdf.push(rec.id)

      const pdf_attachment_ids = Array.isArray(pdfs) ? pdfs.map(a => a.id).filter(Boolean) : []
      const pdf_filenames     = Array.isArray(pdfs) ? pdfs.map(a => a.filename || '').filter(Boolean) : []

      const row = {
        airtable_id:  rec.id,
        booklet_name: String(name).trim(),
        year,
        subject:      subject ? String(subject).trim() : null,
        week,
        term_number:  termN,
        pdf_attachment_ids,
        pdf_filenames,
        updated_at:   new Date().toISOString(),
      }

      if (dryRun) {
        stats.upserted += 1
        continue
      }

      const { error: upErr } = await supabase
        .from(T_BOOKLETS)
        .upsert(row, { onConflict: 'airtable_id' })

      if (upErr) {
        stats.skipped.push({ airtable_id: rec.id, reason: upErr.message })
      } else {
        stats.upserted += 1
      }
    }

    return Response.json({
      success: true,
      dry_run: dryRun,
      term_filter: termFilter || null,
      ...stats,
      ...(dataRichSamples ? { field_samples: dataRichSamples } : {}),
    })
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PORTAL_BCC } from '../../../../lib/emailConfig'
import { T_FORMS, T_FORM_SUBMISSIONS } from '../../../../lib/tables'
import { validateSubmission, formatValue } from '../../../../lib/forms'

/*
 * /api/forms/[slug]
 *
 * GET  → the public definition of an ACTIVE form (title, description, fields,
 *        confirmation) for /forms/[slug] to render.
 * POST → a submission { data: {key: value} }. Validated against the form's
 *        fields, stored in form_submissions, and emailed to the form's notify
 *        address (default: the admin inbox). Public and anonymous by design —
 *        the service role is used only for these two narrow operations.
 */

export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }) }

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function loadForm(slug) {
  const { data } = await admin().from(T_FORMS)
    .select('id, slug, title, description, fields, confirmation, notify_email, active')
    .eq('slug', slug).maybeSingle()
  return data && data.active ? data : null
}

export async function GET(_req, { params }) {
  const { slug } = await params
  const form = await loadForm(slug)
  if (!form) return NextResponse.json({ error: 'This form is not available.' }, { status: 404, headers: CORS })
  const { id, title, description, fields, confirmation } = form
  return NextResponse.json({ id, slug, title, description, fields, confirmation }, { headers: CORS })
}

export async function POST(req, { params }) {
  try {
    const { slug } = await params
    const form = await loadForm(slug)
    if (!form) return NextResponse.json({ error: 'This form is not available.' }, { status: 404, headers: CORS })

    let body
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS }) }
    const { ok, errors, data } = validateSubmission(form.fields || [], body?.data || {})
    if (!ok) return NextResponse.json({ error: 'Please check the highlighted fields.', errors }, { status: 400, headers: CORS })

    const { data: row, error } = await admin().from(T_FORM_SUBMISSIONS)
      .insert({ form_id: form.id, data }).select('id, submitted_at').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS })

    // Notify the office. Non-fatal: the submission is already saved.
    if (process.env.RESEND_API_KEY) {
      const to = form.notify_email || process.env.ADMIN_NOTIFICATION_EMAIL || 'admin@cubetuition.com.au'
      const lines = (form.fields || []).map(f => `${f.label}: ${formatValue(data[f.key]) || '—'}`)
      const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.cubetuition.com.au').replace(/\/+$/, '')
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'CUBE Portal <noreply@cubetuition.com.au>',
            to: [to], bcc: [PORTAL_BCC],
            subject: `New form submission: ${form.title}`,
            text: [`${form.title} — new submission`, '', ...lines, '', `View all: ${site}/tutor/admin/forms`].join('\n'),
          }),
        })
      } catch (e) { console.warn('[forms] notification failed (non-fatal):', e.message) }
    }

    return NextResponse.json({ success: true, id: row.id, confirmation: form.confirmation }, { headers: CORS })
  } catch (err) {
    console.error('[forms] submit', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS })
  }
}

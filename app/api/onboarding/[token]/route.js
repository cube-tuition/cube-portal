import { serviceClient, onboardingByToken } from '../../../../lib/onboardingServer'
import { ONBOARDING_BUCKET, TEMPLATES, DOCS } from '../../../../lib/onboarding'

/*
 * GET /api/onboarding/<token> — public: the new tutor's upload page.
 *
 * No login: the token in their email link is the credential. Returns only
 * what their page shows — their first name, start date, the six documents
 * with which are uploaded (filename and time, never a link back to the file),
 * and short-lived download links for the three CUBE templates.
 */
export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  const { token } = await params
  const sb = serviceClient()
  const o = await onboardingByToken(sb, token)
  if (!o) return Response.json({ error: 'This link is not valid. Ask CUBE for a new one.' }, { status: 404 })

  const { data: files } = await sb.from('tutor_onboarding_files').select('doc_key, filename, uploaded_at').eq('onboarding_id', o.id)
  const byKey = Object.fromEntries((files || []).map(f => [f.doc_key, f]))
  const templates = []
  for (const t of TEMPLATES) {
    const { data } = await sb.storage.from(ONBOARDING_BUCKET).createSignedUrl(t.path, 3600, { download: t.filename })
    templates.push({ key: t.key, label: t.label, url: data?.signedUrl || null })
  }
  return Response.json({
    firstName: String(o.full_name || '').trim().split(/\s+/)[0] || '',
    startDate: o.start_date,
    status: o.status,
    docs: DOCS.map(d => ({ ...d, uploaded: byKey[d.key] ? { filename: byKey[d.key].filename, at: byKey[d.key].uploaded_at } : null })),
    templates,
  })
}

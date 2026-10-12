import { requireApiRole } from '../../../../lib/apiAuth'
import { serviceClient } from '../../../../lib/onboardingServer'
import { ONBOARDING_BUCKET, TEMPLATES } from '../../../../lib/onboarding'

/*
 * GET /api/onboarding/file?id=<file id>   — an uploaded document
 * GET /api/onboarding/file?template=<key> — one of the pack's templates
 * Directors only. Returns { url }: a signed link valid for five minutes, so
 * bank and tax documents are never left at a lasting address.
 */
export async function GET(request) {
  const auth = await requireApiRole(request, ['admin', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const q = new URL(request.url).searchParams
  const sb = serviceClient()
  let path = null
  if (q.get('template')) {
    path = TEMPLATES.find(t => t.key === q.get('template'))?.path || null
  } else if (q.get('id')) {
    const { data } = await sb.from('tutor_onboarding_files').select('storage_path').eq('id', q.get('id')).maybeSingle()
    path = data?.storage_path || null
  }
  if (!path) return Response.json({ error: 'Not found' }, { status: 404 })
  const { data, error } = await sb.storage.from(ONBOARDING_BUCKET).createSignedUrl(path, 300)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ url: data.signedUrl })
}

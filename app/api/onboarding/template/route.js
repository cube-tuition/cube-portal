import { requireApiRole } from '../../../../lib/apiAuth'
import { serviceClient } from '../../../../lib/onboardingServer'
import { ONBOARDING_BUCKET, TEMPLATES } from '../../../../lib/onboarding'

/*
 * POST /api/onboarding/template — directors only
 * Body: { key }  (agreement | code | onboarding)
 *
 * Replacing one of the pack's documents: returns a signed upload URL for its
 * fixed path, so the browser uploads the new PDF straight to storage (no size
 * limit from this server) and every later pack attaches the new version.
 */
export async function POST(request) {
  const auth = await requireApiRole(request, ['admin', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const { key } = await request.json().catch(() => ({}))
  const t = TEMPLATES.find(x => x.key === key)
  if (!t) return Response.json({ error: 'Unknown document' }, { status: 400 })
  const { data, error } = await serviceClient().storage.from(ONBOARDING_BUCKET).createSignedUploadUrl(t.path, { upsert: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ path: t.path, token: data.token })
}

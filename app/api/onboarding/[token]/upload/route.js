import { serviceClient, onboardingByToken, safeName } from '../../../../../lib/onboardingServer'
import { ONBOARDING_BUCKET, DOC_KEYS, UPLOAD_MAX_BYTES, UPLOAD_TYPES } from '../../../../../lib/onboarding'
import { sendPushToAll } from '../../../../../lib/push'

/*
 * POST /api/onboarding/<token>/upload — public (token-gated)
 *
 *   { action: 'url',  docKey, filename, size, type } → { path, token }
 *       A signed upload URL for one document. The browser uploads the file
 *       straight to the private bucket, so a large scan never passes through
 *       this server (whose request bodies are capped well below 20 MB).
 *   { action: 'done', docKey, path, filename, size }  → { ok, uploadedCount }
 *       Records the upload once it is in storage, replacing any earlier file
 *       for that document. When all six are in, the pack moves to
 *       'submitted' and the directors get a push.
 *
 * A pack a director has marked complete takes no more uploads.
 */
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { token } = await params
  const sb = serviceClient()
  const o = await onboardingByToken(sb, token)
  if (!o) return Response.json({ error: 'This link is not valid. Ask CUBE for a new one.' }, { status: 404 })
  if (o.status === 'complete') return Response.json({ error: 'Your onboarding is already complete — thank you!' }, { status: 409 })

  const body = await request.json().catch(() => ({}))
  const { action, docKey } = body
  if (!DOC_KEYS.includes(docKey)) return Response.json({ error: 'Unknown document' }, { status: 400 })
  const prefix = `submissions/${o.id}/${docKey}-`

  if (action === 'url') {
    const size = Number(body.size) || 0
    if (size <= 0 || size > UPLOAD_MAX_BYTES) return Response.json({ error: 'Files must be under 20 MB.' }, { status: 400 })
    const type = String(body.type || '')
    const ext = String(body.filename || '').toLowerCase().split('.').pop()
    const okType = UPLOAD_TYPES.includes(type) || ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'doc', 'docx'].includes(ext)
    if (!okType) return Response.json({ error: 'Please upload a PDF, a photo (JPG, PNG, HEIC) or a Word document.' }, { status: 400 })
    const path = `${prefix}${Date.now()}-${safeName(body.filename)}`
    const { data, error } = await sb.storage.from(ONBOARDING_BUCKET).createSignedUploadUrl(path)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ path, token: data.token })
  }

  if (action === 'done') {
    const path = String(body.path || '')
    if (!path.startsWith(prefix)) return Response.json({ error: 'Bad upload path' }, { status: 400 })
    // Confirm the object really landed before ticking it off.
    const name = path.slice(`submissions/${o.id}/`.length)
    const { data: listed } = await sb.storage.from(ONBOARDING_BUCKET).list(`submissions/${o.id}`, { search: name, limit: 5 })
    if (!(listed || []).some(f => f.name === name)) return Response.json({ error: 'The upload did not finish — please try again.' }, { status: 400 })

    const { data: prev } = await sb.from('tutor_onboarding_files').select('storage_path').eq('onboarding_id', o.id).eq('doc_key', docKey).maybeSingle()
    const { error } = await sb.from('tutor_onboarding_files').upsert({
      onboarding_id: o.id, doc_key: docKey, storage_path: path,
      filename: String(body.filename || 'file').slice(0, 200), size_bytes: Number(body.size) || null,
      uploaded_at: new Date().toISOString(),
    }, { onConflict: 'onboarding_id,doc_key' })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (prev?.storage_path && prev.storage_path !== path) await sb.storage.from(ONBOARDING_BUCKET).remove([prev.storage_path])

    const { count } = await sb.from('tutor_onboarding_files').select('id', { count: 'exact', head: true }).eq('onboarding_id', o.id)
    const all = (count || 0) >= DOC_KEYS.length
    if (all && o.status !== 'submitted') {
      await sb.from('tutor_onboarding').update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', o.id)
      try {
        await sendPushToAll({ title: 'Onboarding documents in', body: `${o.full_name} has uploaded all ${DOC_KEYS.length} onboarding documents.`, url: '/tutor/admin/onboarding', tag: 'onboarding' })
      } catch { /* a push failure must not fail the upload */ }
    } else {
      await sb.from('tutor_onboarding').update({ updated_at: new Date().toISOString() }).eq('id', o.id)
    }
    return Response.json({ ok: true, uploadedCount: count || 0 })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

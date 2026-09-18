import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../../lib/apiAuth'

/*
 * Push subscriptions for the Messages app.
 *   GET    → { publicKey } so the page can subscribe (VAPID public key)
 *   POST   { subscription } → stored for this user
 *   DELETE { endpoint }     → removed
 * Directors only, matching the app itself.
 */
export const dynamic = 'force-dynamic'
const ROLES = ['director']

export async function GET(req) {
  const auth = await requireApiRole(req, ROLES)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null })
}

export async function POST(req) {
  const auth = await requireApiRole(req, ROLES)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const sub = body?.subscription
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return Response.json({ error: 'Not a push subscription' }, { status: 400 })
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { error } = await admin.from('push_subscriptions').upsert({
    user_id: auth.user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 200),
  }, { onConflict: 'endpoint' })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req) {
  const auth = await requireApiRole(req, ROLES)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body?.endpoint) return Response.json({ error: 'endpoint required' }, { status: 400 })
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  await admin.from('push_subscriptions').delete().eq('endpoint', body.endpoint).eq('user_id', auth.user.id)
  return Response.json({ ok: true })
}

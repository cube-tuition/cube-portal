import { createClient } from '@supabase/supabase-js'

/*
 * Server-side API auth helper.
 *
 * Privileged API routes run with the service-role key (which bypasses RLS), so
 * they MUST verify the caller themselves. Call requireApiRole() at the top of a
 * route handler: it reads the caller's Supabase JWT from the
 * `Authorization: Bearer <token>` header, verifies it, and checks that
 * app_metadata.role (set server-side only) is allowed.
 *
 *   const auth = await requireApiRole(req, ['admin', 'director'])
 *   if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
 *
 * Pass allowedRoles = null (or omit) to accept ANY authenticated user.
 */

let _admin
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
  }
  return _admin
}

export async function requireApiRole(request, allowedRoles = null) {
  const authHeader = request.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing auth token' }
  }
  const token = authHeader.slice(7)

  const { data: { user }, error } = await admin().auth.getUser(token)
  if (error || !user) {
    return { ok: false, status: 401, error: 'Invalid or expired token' }
  }

  const role = user.app_metadata?.role ?? 'student'
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(role)) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  return { ok: true, user, role }
}

import { createClient } from '@supabase/supabase-js'

/*
 * POST /api/client-error — the error boundaries report crashes here.
 *
 * Writes go through the service role because a crash can happen BEFORE
 * sign-in (the Aug 14 workbook crash fired for unauthenticated visitors too),
 * and granting anon INSERT on the table itself would be an open spam target.
 * This route is the narrow door instead: it accepts one small, capped row,
 * attaches the caller's user id only if their token verifies, and never
 * returns an error — reporting a crash must not be able to cause one.
 *
 * Auth is deliberately optional; everything else about the row is clamped.
 */

export const dynamic = 'force-dynamic'

const CAP = { route: 300, message: 500, stack: 2000, digest: 100, ua: 300 }
const clamp = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

export async function POST(request) {
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const body = await request.json().catch(() => ({}))

    // Attach who it happened to when the session verifies; a crash without a
    // session is still worth recording, so failure here is not a rejection.
    let userId = null
    const authHeader = request.headers.get('authorization') || ''
    if (authHeader.startsWith('Bearer ')) {
      const { data } = await admin.auth.getUser(authHeader.slice(7)).catch(() => ({ data: {} }))
      userId = data?.user?.id ?? null
    }

    const row = {
      route: clamp(body.route, CAP.route) || '(unknown)',
      message: clamp(body.message, CAP.message) || '(no message)',
      stack: clamp(body.stack, CAP.stack),
      digest: clamp(body.digest, CAP.digest),
      user_agent: clamp(request.headers.get('user-agent'), CAP.ua),
      global: body.global === true,
      user_id: userId,
    }
    await admin.from('client_errors').insert(row)
  } catch {
    // Swallow everything — see header comment.
  }
  return Response.json({ ok: true })
}

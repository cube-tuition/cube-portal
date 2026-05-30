import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/*
 * POST /api/exec-ddl
 * ─────────────────────────────────────────────────────────────────────────────
 * Executes a DDL statement (CREATE TABLE, DROP TABLE, ALTER TABLE …) on behalf
 * of an authenticated admin user.
 *
 * Auth flow:
 *   1. Client sends its Supabase JWT as `Authorization: Bearer <token>`.
 *   2. We verify the token and check app_metadata.role === 'admin'.
 *      app_metadata is set server-side only (Supabase dashboard / service role)
 *      and cannot be dropped or modified by the client or DB explorer.
 *   3. We call the exec_ddl(sql_text) RPC using the service-role client, which
 *      bypasses RLS and can run any DDL.
 *
 * Body: { sql: string }
 * Response: 200 {} | 4xx/5xx { error: string }
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

export async function POST(request) {
  try {
    // ── 1. Authenticate ────────────────────────────────────────────────────
    const authHeader = request.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing auth token' }, { status: 401 })
    }
    const token = authHeader.slice(7)

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    // ── 2. Authorise — check app_metadata (server-side only, DB-drop-proof) ──
    if (user.app_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
    }

    // ── 3. Validate payload ────────────────────────────────────────────────
    const body = await request.json()
    const { sql } = body ?? {}

    if (!sql || typeof sql !== 'string' || !sql.trim()) {
      return NextResponse.json({ error: 'Missing or empty sql field' }, { status: 400 })
    }

    // ── 4. Execute via service-role RPC ────────────────────────────────────
    const { error: ddlErr } = await supabaseAdmin.rpc('exec_ddl', { sql_text: sql.trim() })

    if (ddlErr) {
      return NextResponse.json({ error: ddlErr.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[exec-ddl]', err)
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}

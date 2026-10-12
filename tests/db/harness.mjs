/*
 * An in-memory Postgres (PGlite) loaded with the live payroll schema, so the
 * real shift and pay-run functions can be tested without touching production.
 *
 * tests/db/payroll-schema.sql is a snapshot of the live definitions
 * (`npm run test:db:snapshot`); the drift test compares it with production.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const here = path.dirname(fileURLToPath(import.meta.url))
export const SNAPSHOT_PATH = path.join(here, 'payroll-schema.sql')

// Supabase's auth schema, reduced to what the functions call: the JWT claims
// of the request, and the user id inside them.
const AUTH_STUB = `
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
`

export async function freshDb() {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  await db.exec('set check_function_bodies = off;\n' + fs.readFileSync(SNAPSHOT_PATH, 'utf8'))
  return db
}

/*
 * Run `fn` inside a transaction that is always rolled back, so every test
 * starts from the same empty schema. `as(uid, role)` sets who is calling
 * (role 'admin' passes is_admin); `as(null)` is an anonymous caller.
 * `rejects(sql, params, /pattern/)` expects an error and carries on.
 */
export async function inTx(db, fn) {
  await db.exec('begin')
  try {
    const q = async (sql, params) => (await db.query(sql, params)).rows
    const one = async (sql, params) => (await q(sql, params))[0]
    const as = async (uid, role) => {
      const claims = uid ? { sub: uid, app_metadata: role ? { role } : {} } : {}
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    }
    // An expected error, without aborting the test's transaction.
    let n = 0
    const rejects = async (sql, params, pattern) => {
      const sp = `expect_error_${++n}`
      await db.exec(`savepoint ${sp}`)
      try {
        await db.query(sql, params)
      } catch (e) {
        await db.exec(`rollback to savepoint ${sp}`)
        if (pattern && !pattern.test(e.message)) throw new Error(`expected an error matching ${pattern}, got: ${e.message}`)
        return e
      }
      await db.exec(`release savepoint ${sp}`)
      throw new Error(`expected an error matching ${pattern}, but the statement succeeded: ${sql}`)
    }
    return await fn({ q, one, as, rejects })
  } finally {
    await db.exec('rollback')
  }
}

// ── Live schema (needs .env.local with the service-role key) ────────────────
function env() {
  const out = { ...process.env }
  const file = path.join(here, '..', '..', '.env.local')
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !out[m[1]]) out[m[1]] = m[2].replace(/^"|"$/g, '')
    }
  }
  return out
}

// The live DDL, or null when there are no credentials to read it with.
export async function liveSnapshot() {
  const e = env()
  const url = e.NEXT_PUBLIC_SUPABASE_URL, key = e.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const res = await fetch(`${url}/rest/v1/rpc/test_schema_snapshot`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw new Error(`test_schema_snapshot: ${res.status} ${await res.text()}`)
  return await res.json()
}

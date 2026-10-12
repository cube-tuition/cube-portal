/*
 * Writes tests/db/payroll-schema.sql from the live database
 * (public.test_schema_snapshot — see migrations/20261012_test_schema_snapshot.sql).
 *
 *   npm run test:db:snapshot
 *
 * Run it after changing any shift / pay-run function or table, then re-run
 * `npm test`. The drift test fails until the file matches production.
 */
import fs from 'node:fs'
import { liveSnapshot, SNAPSHOT_PATH } from '../tests/db/harness.mjs'

const sql = await liveSnapshot()
if (!sql) { console.error('No .env.local / Supabase credentials — cannot read the live schema.'); process.exit(1) }
fs.writeFileSync(SNAPSHOT_PATH, sql)
console.log(`Wrote ${SNAPSHOT_PATH} (${sql.split('\n').length} lines)`)

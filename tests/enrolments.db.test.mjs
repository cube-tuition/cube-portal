/*
 * Enrolment changes queue an invoice sync (migrations/20261013_invoice_sync_queue.sql),
 * on the in-memory copy of the live schema (tests/db/harness.mjs). The queue is
 * what lets draft invoices follow enrolments (lib/invoiceSync).
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

const ANA = '00000000-0000-0000-0000-0000000000a1'
let db
before(async () => { db = await freshDb() })

async function setup(q) {
  await q(`insert into students (id) values ($1)`, [ANA])
  const [{ id: a }] = await q(`insert into classes (class_name) values ('Y8 Maths') returning id`)
  const [{ id: b }] = await q(`insert into classes (class_name) values ('Y8 English') returning id`)
  return { a, b }
}
const queued = (q) => q(`select student_id, class_id from invoice_sync_queue order by id`)
const run = (name, fn) => test(name, () => inTx(db, async (ctx) => fn({ ...ctx, ...await setup(ctx.q) })))

run('a new enrolment is queued', async ({ q, a }) => {
  await q(`insert into enrolments (student_id, class_id, price) values ($1, $2, 600)`, [ANA, a])
  assert.deepEqual(await queued(q), [{ student_id: ANA, class_id: a }])
})

run('a price change, a status change and a removal are each queued', async ({ q, a }) => {
  await q(`insert into enrolments (student_id, class_id, price) values ($1, $2, 600)`, [ANA, a])
  await q(`delete from invoice_sync_queue`)
  await q(`update enrolments set price = 650 where class_id = $1`, [a])
  await q(`update enrolments set status = 'disenrol' where class_id = $1`, [a])
  await q(`delete from enrolments where class_id = $1`, [a])
  assert.equal((await queued(q)).length, 3)
})

run('moving an enrolment to another class queues both classes', async ({ q, a, b }) => {
  await q(`insert into enrolments (student_id, class_id) values ($1, $2)`, [ANA, a])
  await q(`delete from invoice_sync_queue`)
  await q(`update enrolments set class_id = $1 where class_id = $2`, [b, a])
  assert.deepEqual(await queued(q), [{ student_id: ANA, class_id: a }, { student_id: ANA, class_id: b }])
})

run('changes that cannot affect a bill are not queued', async ({ q, a }) => {
  await q(`insert into enrolments (student_id, class_id, price) values ($1, $2, 600)`, [ANA, a])
  await q(`delete from invoice_sync_queue`)
  await q(`update enrolments set next_term_status = 'confirmed', started_at = '2026-10-12' where class_id = $1`, [a])
  await q(`update enrolments set price = 600, status = 'active' where class_id = $1`, [a])   // same values
  assert.deepEqual(await queued(q), [])
})

run('the queue is closed to signed-in users (RLS on, no policies)', async ({ one }) => {
  const r = await one(`select relrowsecurity rls, (select count(*)::int from pg_policies where tablename = 'invoice_sync_queue') policies
    from pg_class where relname = 'invoice_sync_queue'`)
  assert.deepEqual(r, { rls: true, policies: 0 })
})

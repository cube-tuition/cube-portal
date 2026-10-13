/*
 * The trial pipeline's activity clock (migrations/20261014_trial_activity.sql),
 * on the in-memory copy of the live schema (tests/db/harness.mjs).
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

let db
before(async () => { db = await freshDb() })
const run = (name, fn) => test(name, () => inTx(db, fn))
const row = (one, id) => one(`select last_activity_at::text a, stale_notified_at::text n from trial_submissions where id = $1`, [id])

run('a new enquiry starts its clock when it was submitted', async ({ one }) => {
  const { id } = await one(`insert into trial_submissions (student_name, status, submitted_at) values ('Kim', 'new', '2026-10-10 09:00+11') returning id`)
  assert.equal((await one(`select last_activity_at = submitted_at same from trial_submissions where id = $1`, [id])).same, true)
})

run('acting on a case restarts the clock and clears the "told the directors" mark', async ({ q, one }) => {
  const { id: cls } = await one(`insert into classes (class_name) values ('Y8 Maths') returning id`)
  const { id } = await one(`insert into trial_submissions (student_name, status, submitted_at, stale_notified_at)
    values ('Kim', 'new', '2026-10-01 09:00+10', '2026-10-05 08:00+11') returning id`)
  for (const change of [`status = 'contacted'`, `admin_notes = 'Called mum'`, `trial_class_id = ${cls}`, `invitation_sent_at = now()`]) {
    await q(`update trial_submissions set last_activity_at = '2026-10-01', stale_notified_at = '2026-10-05' where id = $1`, [id])
    await q(`update trial_submissions set ${change} where id = $1`, [id])
    const r = await one(`select last_activity_at > '2026-10-02' restarted, stale_notified_at from trial_submissions where id = $1`, [id])
    assert.equal(r.restarted, true, `${change} should restart the clock`)
    assert.equal(r.stale_notified_at, null, `${change} should clear the notified mark`)
  }
})

run('marking the directors as told, or touching nothing that matters, is not activity', async ({ q, one }) => {
  const { id } = await one(`insert into trial_submissions (student_name, status, submitted_at) values ('Kim', 'new', '2026-10-01 09:00+10') returning id`)
  const before = (await row(one, id)).a
  await q(`update trial_submissions set stale_notified_at = now() where id = $1`, [id])
  await q(`update trial_submissions set school = 'Chatswood High' where id = $1`, [id])
  const r = await row(one, id)
  assert.equal(r.a, before)
  assert.ok(r.n)
})

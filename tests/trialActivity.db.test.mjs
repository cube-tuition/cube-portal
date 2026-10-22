/*
 * Rescheduling a trial (its first lesson date or its class, both kept on the
 * enrolment) counts as acting on the case —
 * migrations/20261022_trial_enrolment_counts_as_activity.sql.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

let db
before(async () => { db = await freshDb() })
const AARON = '00000000-0000-0000-0000-0000000007a1'

test('moving the first trial lesson or the trial class restarts the case’s clock; other edits do not', () => inTx(db, async ({ q }) => {
  const [{ id: term }] = await q(`insert into terms (name, year, term_number, start_date, end_date) values ('T4', 2026, 4, current_date - 10, current_date + 60) returning id`)
  const cls = async (n) => (await q(`insert into classes (class_name, teacher, term_id) values ($1, 'Amber', $2) returning id`, [n, term]))[0].id
  const a = await cls('Y8 English 1:1 B'), b = await cls('Y8 English')
  await q(`insert into students (id, full_name) values ($1, 'Aaron Wang')`, [AARON])
  const [{ id: enrol }] = await q(`insert into enrolments (student_id, class_id, status, trial_start_date) values ($1, $2, 'trial', current_date + 2) returning id`, [AARON, a])
  const [{ id: sub }] = await q(`insert into trial_submissions (student_name, status, converted_student_id, enrolment_id, trial_class_id, last_activity_at, stale_notified_at)
    values ('Aaron Wang', 'trial_scheduled', $1, $2, $3, now() - interval '87 days', now() - interval '9 days') returning id`, [AARON, enrol, a])
  const clock = async () => (await q(`select last_activity_at > now() - interval '1 minute' fresh, stale_notified_at from trial_submissions where id = $1`, [sub]))[0]

  await q(`update enrolments set price = 600 where id = $1`, [enrol])
  assert.equal((await clock()).fresh, false, 'an unrelated edit leaves it')

  await q(`update enrolments set trial_start_date = current_date + 9 where id = $1`, [enrol])
  assert.deepEqual(await clock(), { fresh: true, stale_notified_at: null }, 'new first lesson date')

  await q(`update trial_submissions set last_activity_at = now() - interval '30 days' where id = $1`, [sub])
  await q(`update enrolments set class_id = $1 where id = $2`, [b, enrol])
  assert.equal((await clock()).fresh, true, 'new trial class')
}))

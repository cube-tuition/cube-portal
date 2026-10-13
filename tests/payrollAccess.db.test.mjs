/*
 * Who may read and write payroll money — row-level security on the in-memory
 * copy of the live schema, signed in through the API (tests/db/harness.mjs).
 * migrations/20261013_payroll_admin_only.sql: admins everything; a tutor only
 * reads their own shifts and rates; students nothing.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

const MONICA = '00000000-0000-0000-0000-00000000000a'   // tutor
const JAMES  = '00000000-0000-0000-0000-00000000000b'   // another tutor
const RYAN   = '00000000-0000-0000-0000-00000000000d'   // director (admin)
const KIM    = '00000000-0000-0000-0000-0000000000c1'   // student

let db
before(async () => { db = await freshDb() })

async function seed(q) {
  await q(`insert into tutors (id, full_name) values ($1, 'Monica Chen'), ($2, 'James Wu')`, [MONICA, JAMES])
  await q(`insert into directors (id, full_name) values ($1, 'Ryan Park')`, [RYAN])
  await q(`insert into tutor_rate_matrix (tutor_id, year_band, mode, hourly_rate) values ($1, '7-8', 'class', 40), ($2, '7-8', 'class', 45)`, [MONICA, JAMES])
  await q(`insert into shifts (tutor_id, work_date, hours, kind, rate_snapshot, status) values
    ($1, '2026-10-14', 2, 'class', 40, 'draft'), ($2, '2026-10-14', 2, 'class', 45, 'draft')`, [MONICA, JAMES])
  await q(`insert into pay_runs (period_start, period_end) values ('2026-10-12', '2026-10-25')`)
  await q(`insert into cash_log (date, direction, type, amount) values ('2026-10-13', 'inflow', 'tuition', 600)`)
  await q(`insert into director_balances (staff_id, staff_name, kind, amount) values ($1, 'Ryan Park', 'debt', 100)`, [RYAN])
}
const count = async (q, sql, params) => (await q(sql, params))[0].n
const run = (name, fn) => test(name, () => inTx(db, async (ctx) => { await seed(ctx.q); await fn(ctx) }))

run('a tutor reads only their own shifts and rates', async ({ q, signIn }) => {
  await signIn(MONICA, 'tutor')
  assert.deepEqual((await q(`select tutor_id from shifts`)).map(r => r.tutor_id), [MONICA])
  assert.deepEqual((await q(`select hourly_rate::float r from tutor_rate_matrix`)).map(r => r.r), [40])
})

run('a tutor cannot change their pay rate, or anyone\'s', async ({ q, signIn, rejects }) => {
  await signIn(MONICA, 'tutor')
  await q(`update tutor_rate_matrix set hourly_rate = 400`)              // RLS: matches no rows
  await q(`delete from tutor_rate_matrix`)
  await rejects(`insert into tutor_rate_matrix (tutor_id, year_band, mode, hourly_rate) values ($1, '9-10', 'class', 400)`, [MONICA], /row-level security/)
  await q(`reset role`)
  assert.deepEqual((await q(`select hourly_rate::float r from tutor_rate_matrix order by tutor_id`)).map(r => r.r), [40, 45])
})

run('a tutor cannot create, edit, approve or delete shifts directly', async ({ q, signIn, rejects }) => {
  await signIn(MONICA, 'tutor')
  await rejects(`insert into shifts (tutor_id, work_date, hours, kind, rate_snapshot, status) values ($1, '2026-10-15', 10, 'other', 500, 'draft')`, [MONICA], /row-level security/)
  await q(`update shifts set rate_snapshot = 500, hours = 12, status = 'approved'`)
  await q(`delete from shifts`)
  await q(`reset role`)
  assert.deepEqual((await q(`select tutor_id, rate_snapshot::float r, hours::float h, status from shifts order by tutor_id`)),
    [{ tutor_id: MONICA, r: 40, h: 2, status: 'draft' }, { tutor_id: JAMES, r: 45, h: 2, status: 'draft' }])
})

run('a tutor sees no pay runs, cash log or director balances, and cannot add to them', async ({ q, signIn, rejects }) => {
  await signIn(MONICA, 'tutor')
  for (const t of ['pay_runs', 'cash_log', 'director_balances']) assert.equal(await count(q, `select count(*)::int n from ${t}`), 0, t)
  await rejects(`insert into cash_log (date, direction, type, amount) values ('2026-10-13', 'outflow', 'wages', 5000)`, undefined, /row-level security/)
  await rejects(`insert into pay_runs (period_start, period_end) values ('2026-10-26', '2026-11-08')`, undefined, /row-level security/)
})

run('marking the roll still creates the tutor\'s shift (the trigger runs as its owner)', async ({ q, signIn }) => {
  const [{ id }] = await q(`insert into classes (class_name, teacher, start_time, end_time) values ('Y8 Maths', 'Monica', '4:00', '6:00') returning id`)
  await q(`insert into lessons (class_id, lesson_date) values ($1, '2026-10-21')`, [id])
  await signIn(MONICA, 'tutor')
  await q(`insert into attendance (student_id, class_id, session_date, status) values ($1, $2, '2026-10-21', 'present')`, [KIM, id])
  assert.equal(await count(q, `select count(*)::int n from shifts where work_date = '2026-10-21'`), 1)
})

run('a tutor can still save their own drop-in shift (save_dropin_shift runs as its owner)', async ({ q, signIn }) => {
  const [{ id }] = await q(`insert into dropin_sessions (session_date, start_time, end_time, tutors) values ('2026-10-15', '15:30', '18:00', '{Monica}') returning id`)
  await q(`delete from shifts where source_table = 'dropin_sessions'`)
  await signIn(MONICA, 'tutor')
  const [s] = await q(`select hours::float h from save_dropin_shift($1, '16:00', '17:30')`, [id])
  assert.equal(s.h, 1.5)
  assert.equal(await count(q, `select count(*)::int n from shifts where source_table = 'dropin_sessions'`), 1)
})

run('a director (admin) reads and writes all of it', async ({ q, signIn }) => {
  await signIn(RYAN, 'admin')
  assert.equal(await count(q, `select count(*)::int n from shifts`), 2)
  assert.equal(await count(q, `select count(*)::int n from tutor_rate_matrix`), 2)
  await q(`update tutor_rate_matrix set hourly_rate = 42 where tutor_id = $1`, [MONICA])
  await q(`insert into cash_log (date, direction, type, amount) values ('2026-10-13', 'outflow', 'wages', 80)`)
  await q(`update director_balances set amount = 120`)
  for (const t of ['pay_runs', 'cash_log', 'director_balances']) assert.ok(await count(q, `select count(*)::int n from ${t}`) > 0, t)
})

run('a student sees none of it', async ({ q, signIn }) => {
  await signIn(KIM, 'student')
  for (const t of ['shifts', 'tutor_rate_matrix', 'pay_runs', 'cash_log', 'director_balances']) {
    assert.equal(await count(q, `select count(*)::int n from ${t}`), 0, t)
  }
})

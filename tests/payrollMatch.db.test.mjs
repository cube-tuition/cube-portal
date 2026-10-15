/*
 * Payroll matching (migrations/20261013_payroll_matching.sql): shifts that
 * match the timetable approve themselves; everything else is listed. On the
 * in-memory copy of the live schema (tests/db/harness.mjs).
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

const MONICA = '00000000-0000-0000-0000-00000000000a'   // tutor
const JAMES  = '00000000-0000-0000-0000-00000000000b'   // tutor
const RYAN   = '00000000-0000-0000-0000-00000000000d'   // director
const ADMIN  = '00000000-0000-0000-0000-0000000000ad'
const STU = ['5a', '5b'].map(s => `00000000-0000-0000-0000-0000000000${s}`)
const T4 = '00000000-0000-0000-0000-0000000000f4'
const P = ['2026-10-12', '2026-10-25']             // Term 4, fortnight 1
const TODAY = '2026-10-23'

let db
before(async () => { db = await freshDb() })

async function seed(q) {
  await q(`insert into students (id) select unnest($1::uuid[])`, [STU])
  await q(`insert into terms (id, name, year, term_number, start_date, end_date) values ($1, 'Term 4 2026', 2026, 4, '2026-10-12', '2026-12-19')`, [T4])
  await q(`insert into tutors (id, full_name) values ($1, 'Monica Chen'), ($2, 'James Wu')`, [MONICA, JAMES])
  await q(`insert into directors (id, full_name) values ($1, 'Ryan Park')`, [RYAN])
  await q(`insert into tutor_rate_matrix (tutor_id, year_band, mode, hourly_rate) values
    ($1, '7-8', 'class', 40), ($1, '9-10', 'class', 42), ($2, '7-8', 'class', 38), ($3, '7-8', 'class', 60)`, [MONICA, JAMES, RYAN])
}
// A class with a lesson on each date.
async function cls(q, { name = 'Y8 Maths', teacher = 'Monica', start = '4:00', end = '6:00', dates = ['2026-10-14'] } = {}) {
  const [{ id }] = await q(`insert into classes (class_name, teacher, start_time, end_time, term_id) values ($1, $2, $3, $4, $5) returning id`, [name, teacher, start, end, T4])
  for (const d of dates) await q(`insert into lessons (class_id, lesson_date) values ($1, $2)`, [id, d])
  return id
}
const mark = (q, classId, date, status = 'present', student = STU[0]) =>
  q(`insert into attendance (student_id, class_id, session_date, status) values ($1, $2, $3, $4)
     on conflict (student_id, class_id, session_date) do update set status = excluded.status`, [student, classId, date, status])
const match = (q) => q(`select category, kind, tutor_name, work_date::text, title, problems from payroll_match($1, $2, $3) order by work_date, kind, title`, [...P, TODAY])
const approve = async (q) => (await q(`select auto_approve_matched_shifts($1, $2, $3) n`, [...P, TODAY]))[0].n
const run = (name, fn) => test(name, () => inTx(db, async (ctx) => { await seed(ctx.q); await ctx.as(ADMIN, 'admin'); await fn(ctx) }))

describe('class shifts', () => {
  run('a marked lesson that ran as scheduled matches and approves itself', async ({ q, one }) => {
    const c = await cls(q)
    await mark(q, c, '2026-10-14')
    assert.deepEqual(await match(q), [{ category: 'match', kind: 'class', tutor_name: 'Monica Chen', work_date: '2026-10-14', title: 'Y8 Maths', problems: [] }])
    assert.equal(await approve(q), 1)
    const s = await one(`select status, pay_run_id is not null in_run from shifts`)
    assert.deepEqual(s, { status: 'approved', in_run: true })
    const r = await one(`select total_hours::float h, total_amount::float a from pay_runs where period_start = $1`, [P[0]])
    assert.deepEqual(r, { h: 2, a: 80 })
    assert.deepEqual(await match(q), [])                       // approved shifts are done
  })

  run('a cover teacher set on the lesson matches', async ({ q }) => {
    const c = await cls(q)
    await q(`update lessons set scheduled_teacher_id = $1`, [JAMES])
    await mark(q, c, '2026-10-14')
    assert.equal((await match(q))[0].category, 'match')
  })

  run('hours, teacher or rate changed by hand on the shift → listed, not approved', async ({ q }) => {
    const c = await cls(q, { dates: ['2026-10-14', '2026-10-15', '2026-10-16'] })
    for (const d of ['2026-10-14', '2026-10-15', '2026-10-16']) await mark(q, c, d)
    await q(`update shifts set hours = 3 where work_date = '2026-10-14'`)
    await q(`update shifts set tutor_id = $1 where work_date = '2026-10-15'`, [JAMES])
    await q(`update shifts set rate_snapshot = 55 where work_date = '2026-10-16'`)
    const m = await match(q)
    assert.deepEqual(m.map(r => [r.work_date, r.category, r.problems]), [
      ['2026-10-14', 'issue', ['Scheduled for 2h, the shift is 3h']],
      ['2026-10-15', 'issue', ['The lesson\'s teacher is Monica Chen', 'The rate table says $38/h']],
      ['2026-10-16', 'issue', ['The rate table says $40/h']],
    ])
    assert.equal(await approve(q), 0)
  })

  run('no rate in the table → listed', async ({ q }) => {
    const c = await cls(q, { name: 'Y12 Chemistry' })                // Monica has no 11-12 rate
    await mark(q, c, '2026-10-14')
    assert.deepEqual((await match(q))[0].problems, ['No rate set'])
  })

  run('a shift for a cancelled lesson, or a day with no lesson, is listed', async ({ q }) => {
    const c = await cls(q, { dates: ['2026-10-14'] })
    await mark(q, c, '2026-10-14')
    await mark(q, c, '2026-10-16')                                    // an extra session, not on the timetable
    // Cancelling the lesson drops a draft shift outright, so only one approved
    // first (and taken out of approval afterwards) can sit on a cancelled lesson.
    await q(`update shifts set status = 'approved' where work_date = '2026-10-14'`)
    await q(`update lessons set status = 'cancelled'`)
    await q(`update shifts set status = 'draft' where work_date = '2026-10-14'`)
    const m = await match(q)
    assert.deepEqual(m.map(r => r.problems[0]), ['The lesson was cancelled', 'No lesson was scheduled for this class on this day'])
  })

  run('a matched shift an admin un-approves is listed, not re-approved behind their back', async ({ q }) => {
    const c = await cls(q)
    await mark(q, c, '2026-10-14')
    assert.equal(await approve(q), 1)
    await q(`select unapprove_shift(id) from shifts`)
    assert.deepEqual((await match(q))[0].problems, ['Taken out of approval by hand — approve it when it\'s right'])
    assert.equal(await approve(q), 0)
  })

  run('a shift dated after today waits (not listed, not approved)', async ({ q }) => {
    const c = await cls(q, { dates: ['2026-10-24'] })
    await mark(q, c, '2026-10-24')
    assert.deepEqual(await match(q), [])
  })
})

describe('lessons with no shift', () => {
  run('a past lesson whose roll was never marked is listed', async ({ q }) => {
    const c = await cls(q, { dates: ['2026-10-14'] })
    const m = await match(q)
    assert.deepEqual(m.map(r => [r.kind, r.title, r.tutor_name, r.problems]), [['missing', 'Y8 Maths', 'Monica Chen', ['No shift — the roll hasn\'t been marked']]])
    assert.ok(c)
  })

  run('every student cancelled → the lesson did not run, nothing to pay or list', async ({ q }) => {
    const c = await cls(q)
    await mark(q, c, '2026-10-14', 'cancelled', STU[0])
    await mark(q, c, '2026-10-14', 'makeup', STU[1])
    assert.deepEqual(await match(q), [])
  })

  run('a cancelled lesson, today\'s lesson and an inactive class are not listed', async ({ q }) => {
    await cls(q, { dates: ['2026-10-14'] }).then(id => q(`update lessons set status = 'cancelled' where class_id = $1`, [id]))
    await cls(q, { dates: [TODAY] })
    await cls(q, { dates: ['2026-10-15'] }).then(id => q(`update classes set status = 'inactive' where id = $1`, [id]))
    assert.deepEqual(await match(q), [])
  })

  run('marked but no shift could be made (unknown teacher) says why', async ({ q }) => {
    const c = await cls(q, { teacher: 'Substitute' })
    await mark(q, c, '2026-10-14')
    assert.deepEqual((await match(q))[0].problems, ['The roll was marked but no shift was created', 'No staff member matches the teacher "Substitute"'])
  })
})

describe('drop-ins and hand-added shifts', () => {
  const dropin = (q, tutors = ['Monica']) => q(`insert into dropin_sessions (session_date, start_time, end_time, tutors, year_groups)
    values ('2026-10-15', '15:30', '18:00', $1, '{"Year 9"}') returning id`, [tutors]).then(r => r[0].id)

  run('a rostered drop-in matches, shortened inside the session too', async ({ q }) => {
    const id = await dropin(q)
    assert.equal((await match(q))[0].category, 'match')
    await q(`update shifts set start_time = '16:00', end_time = '17:30', hours = 1.5 where source_table = 'dropin_sessions'`)
    assert.equal((await match(q))[0].category, 'match')
    assert.equal(await approve(q), 1)
    assert.ok(id)
  })

  run('a drop-in shift outside the session, or for someone not rostered, is listed', async ({ q }) => {
    await dropin(q)
    await q(`update shifts set end_time = '19:00', hours = 3.5`)
    await q(`insert into shifts (tutor_id, work_date, start_time, end_time, hours, kind, source_table, source_id, rate_snapshot)
      select $1::uuid, session_date, start_time, end_time, 2.5, 'dropin', 'dropin_sessions', id || '_' || $1::text, 38 from dropin_sessions`, [JAMES])
    const probs = (await match(q)).map(r => r.problems)
    assert.ok(probs.some(p => p.includes('Outside the session\'s times (3:30pm–6:00pm)')))
    assert.ok(probs.some(p => p.includes('Not rostered on this drop-in')))
  })

  run('a shift added by hand always waits for a person', async ({ q }) => {
    await q(`insert into shifts (tutor_id, work_date, hours, kind, rate_snapshot) values ($1, '2026-10-16', 1, 'admin', 30)`, [MONICA])
    assert.deepEqual((await match(q)).map(r => [r.kind, r.problems]), [['manual', ['Added by hand']]])
    assert.equal(await approve(q), 0)
  })
})

describe('pay runs and access', () => {
  run('a shift left out of a paid pay run is flagged as still owed, not approved', async ({ q }) => {
    const c = await cls(q)
    await mark(q, c, '2026-10-14')
    await q(`insert into pay_runs (period_start, period_end, status) values ($1, $2, 'paid')`, P)
    assert.deepEqual((await match(q))[0].problems, ['Left out of this fortnight\'s pay run, which is already paid — it still needs paying'])
    assert.equal(await approve(q), 0)
  })

  run('the daily job approves this fortnight and the last', async ({ q }) => {
    const a = await cls(q, { dates: ['2026-10-14'] })
    const b = await cls(q, { dates: ['2026-10-28'] })
    await mark(q, a, '2026-10-14')
    await mark(q, b, '2026-10-28')
    assert.equal((await q(`select auto_approve_due_shifts('2026-10-30') n`))[0].n, 2)
  })

  run('a tutor cannot run matching; the service role (daily job) can', async ({ q, as, rejects }) => {
    await as(MONICA, 'tutor')
    await rejects(`select * from payroll_match($1, $2)`, P, /forbidden/)
    await rejects(`select auto_approve_matched_shifts($1, $2)`, P, /forbidden/)
    await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
    await q(`select auto_approve_due_shifts()`)
  })
})

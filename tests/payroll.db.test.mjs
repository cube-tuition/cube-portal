/*
 * Shifts and pay runs — the REAL database functions and triggers, run on an
 * in-memory Postgres loaded with the live schema (tests/db/harness.mjs).
 * Nothing here touches production. Every test runs in its own rolled-back
 * transaction, so each starts from the same seeded state.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { freshDb, inTx, liveSnapshot, SNAPSHOT_PATH } from './db/harness.mjs'

// ── Seed ────────────────────────────────────────────────────────────────────
const MONICA = '00000000-0000-0000-0000-00000000000a'   // tutor
const JAMES  = '00000000-0000-0000-0000-00000000000b'   // tutor, no rates set
const RYAN   = '00000000-0000-0000-0000-00000000000d'   // director (also teaches)
const ADMIN  = '00000000-0000-0000-0000-0000000000ad'
const T3 = '00000000-0000-0000-0000-0000000000f3'
const T4 = '00000000-0000-0000-0000-0000000000f4'
const STUDENTS = ['5a', '5b', '5c'].map(s => `00000000-0000-0000-0000-0000000000${s}`)

async function seed(q) {
  await q(`insert into students (id) select unnest($1::uuid[])`, [STUDENTS])
  await q(`insert into terms (id, name, year, term_number, start_date, end_date) values
    ($1, 'Term 3 2026', 2026, 3, '2026-07-14', '2026-09-19'),   -- a Tuesday start
    ($2, 'Term 4 2026', 2026, 4, '2026-10-12', '2026-12-19'),
    (gen_random_uuid(), 'Holiday program', 2026, 12, '2026-09-28', '2026-10-02')`, [T3, T4])
  await q(`insert into tutors (id, full_name) values ($1, 'Monica Chen'), ($2, 'James Wu')`, [MONICA, JAMES])
  await q(`insert into directors (id, full_name) values ($1, 'Ryan Park')`, [RYAN])
  await q(`insert into tutor_rate_matrix (tutor_id, year_band, mode, hourly_rate, effective_from) values
    ($1, '7-8',  'class', 40, '1970-01-01'),
    ($1, '7-8',  'class', 45, '2026-10-19'),     -- pay rise from week 2 of Term 4
    ($1, '7-8',  'tutor', 55, '1970-01-01'),     -- 1:1 rate
    ($1, '9-10', 'class', 42, '1970-01-01'),
    ($1, 'other','class', 35, '1970-01-01'),
    ($2, '1-6',  'class', 60, '1970-01-01')`, [MONICA, RYAN])
}

// A class with one lesson on `date`; returns the class id.
async function classWithLesson(q, { name = 'Y8 Maths', teacher = 'Monica', start = '4:00', end = '6:00', date = '2026-10-14', scheduledTeacher = null } = {}) {
  const [{ id }] = await q(`insert into classes (class_name, teacher, start_time, end_time, term_id)
    values ($1, $2, $3, $4, $5) returning id`, [name, teacher, start, end, T4])
  await q(`insert into lessons (class_id, lesson_date, scheduled_teacher_id) values ($1, $2, $3)`, [id, date, scheduledTeacher])
  return id
}
const mark = (q, classId, date, status, student = STUDENTS[0]) =>
  q(`insert into attendance (student_id, class_id, session_date, status) values ($1, $2, $3, $4)
     on conflict (student_id, class_id, session_date) do update set status = excluded.status`, [student, classId, date, status])
const shiftsOf = (q, where = 'true', params = []) =>
  q(`select tutor_id, work_date::text, start_time::text, end_time::text, hours::float, rate_snapshot::float,
            kind, status, source_table, source_id, pay_run_id
       from shifts where ${where} order by work_date, tutor_id`, params)

let db
const t = (name, fn) => test(name, () => inTx(db, async (ctx) => { await seed(ctx.q); await fn(ctx) }))

before(async () => { db = await freshDb() })

// ── The snapshot is production ──────────────────────────────────────────────
test('tests/db/schema.sql matches the live database', async (ctx) => {
  let live
  try { live = await liveSnapshot() } catch (e) { return ctx.skip(`live schema unreachable: ${e.message}`) }
  if (live == null) return ctx.skip('no Supabase credentials — drift not checked')
  const msg = 'A payroll function or table changed in production. Run `npm run test:db:snapshot`, then `npm test` again.'
  // In the deploy build this only warns: the database change is already live,
  // so holding back the code deploy would protect nothing.
  if (process.env.VERCEL && live !== fs.readFileSync(SNAPSHOT_PATH, 'utf8')) {
    console.warn(`⚠ ${msg}`)
    return ctx.skip('snapshot out of date (warning only in the deploy build)')
  }
  assert.ok(live === fs.readFileSync(SNAPSHOT_PATH, 'utf8'), msg)
})

// ── Times and rates ─────────────────────────────────────────────────────────
describe('class times and pay rates', () => {
  t('class times: 1–7 o\'clock are afternoon, blanks and junk are no time', async ({ one }) => {
    const r = await one(`select parse_class_time('4:00')::text a, parse_class_time('4:30')::text b, parse_class_time('9:00')::text c,
      parse_class_time('12:15')::text d, parse_class_time('16:00')::text e, parse_class_time('')::text f, parse_class_time('TBC')::text g`)
    assert.deepEqual(r, { a: '16:00:00', b: '16:30:00', c: '09:00:00', d: '12:15:00', e: '16:00:00', f: null, g: null })
  })

  t('the rate comes from the class year band and mode, on the lesson date', async ({ one }) => {
    const r = await one(`select
      resolve_matrix_rate($1, 'Y8 Maths', '2026-10-14')::float      as y8_before_rise,
      resolve_matrix_rate($1, 'Y8 Maths', '2026-10-19')::float      as y8_rise_day,
      resolve_matrix_rate($1, 'Y7 English', '2026-10-14')::float    as y7_same_band,
      resolve_matrix_rate($1, 'Y8 Maths 1:1', '2026-10-14')::float  as one_on_one,
      resolve_matrix_rate($1, 'Y8 Maths 1 on 1', '2026-10-14')::float as one_on_one_words,
      resolve_matrix_rate($1, 'Chess club', '2026-10-14')::float    as no_year,
      resolve_matrix_rate($1, 'Y12 Chemistry', '2026-10-14')::float as no_rate`, [MONICA])
    assert.deepEqual(r, { y8_before_rise: 40, y8_rise_day: 45, y7_same_band: 40, one_on_one: 55, one_on_one_words: 55, no_year: 35, no_rate: null })
  })

  t('teacher names resolve to tutors or directors, full name before first name', async ({ q, one }) => {
    await q(`insert into tutors (id, full_name) values ('00000000-0000-0000-0000-00000000000c', 'Ryan Lee')`)
    const r = await one(`select resolve_tutor_by_first_name('monica') a, resolve_tutor_by_first_name(' Monica Chen ') b,
      resolve_tutor_by_first_name('Ryan Park') c, resolve_tutor_by_first_name('Nobody') d`)
    assert.deepEqual(r, { a: MONICA, b: MONICA, c: RYAN, d: null })
  })
})

// ── Marking the roll creates the class shift ────────────────────────────────
describe('class shifts from attendance', () => {
  t('marking a student present creates one draft shift at the lesson rate', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'present')
    assert.deepEqual(await shiftsOf(q), [{
      tutor_id: MONICA, work_date: '2026-10-14', start_time: '16:00:00', end_time: '18:00:00', hours: 2,
      rate_snapshot: 40, kind: 'class', status: 'draft', source_table: 'class_session', source_id: `${c}_2026-10-14`, pay_run_id: null,
    }])
  })

  t('a whole class marked is still ONE shift (no double pay per student)', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'present', STUDENTS[0])
    await mark(q, c, '2026-10-14', 'late', STUDENTS[1])
    await mark(q, c, '2026-10-14', 'absent', STUDENTS[2])
    assert.equal((await shiftsOf(q)).length, 1)
  })

  t('an absent student still means the lesson ran: the teacher is paid', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'absent')
    assert.equal((await shiftsOf(q)).length, 1)
  })

  t('a cancelled lesson creates no shift', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'cancelled')
    assert.deepEqual(await shiftsOf(q), [])
  })

  t('a student moved to a make-up creates no shift', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'makeup')
    assert.deepEqual(await shiftsOf(q), [])
  })

  t('a cancellation later overridden by marking present does create the shift', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'cancelled')
    await mark(q, c, '2026-10-14', 'present')
    assert.equal((await shiftsOf(q)).length, 1)
  })

  t('in a group class, one cancelled student does not stop the shift', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'cancelled', STUDENTS[0])
    await mark(q, c, '2026-10-14', 'present', STUDENTS[1])
    assert.equal((await shiftsOf(q)).length, 1)
  })

  // The roll was saved first (a comment alone saves as present), then the
  // lesson was cancelled with a credit — the draft shift must not survive.
  t('cancelling a 1:1 after the roll was saved removes the draft shift', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'present')
    assert.equal((await shiftsOf(q)).length, 1)
    await mark(q, c, '2026-10-14', 'cancelled')
    assert.deepEqual(await shiftsOf(q), [])
  })

  t('moving the only student to a make-up removes the draft shift', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'absent')
    await mark(q, c, '2026-10-14', 'makeup')
    assert.deepEqual(await shiftsOf(q), [])
  })

  t('in a group class, cancelling one student keeps the shift; cancelling the last removes it', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'present', STUDENTS[0])
    await mark(q, c, '2026-10-14', 'present', STUDENTS[1])
    await mark(q, c, '2026-10-14', 'cancelled', STUDENTS[0])
    assert.equal((await shiftsOf(q)).length, 1)
    await mark(q, c, '2026-10-14', 'cancelled', STUDENTS[1])
    assert.deepEqual(await shiftsOf(q), [])
  })

  t('cancelling the lesson itself removes its draft shift', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'present', STUDENTS[0])
    await mark(q, c, '2026-10-14', 'present', STUDENTS[1])
    await q(`update lessons set status = 'cancelled' where class_id = $1`, [c])
    assert.deepEqual(await shiftsOf(q), [])
  })

  t('a roll saved on a cancelled lesson creates no shift', async ({ q }) => {
    const c = await classWithLesson(q)
    await q(`update lessons set status = 'cancelled' where class_id = $1`, [c])
    await mark(q, c, '2026-10-14', 'present')
    assert.deepEqual(await shiftsOf(q), [])
  })

  t('an approved shift is never removed by a cancellation', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'present')
    await q(`update shifts set status = 'approved'`)
    await mark(q, c, '2026-10-14', 'cancelled')
    await q(`update lessons set status = 'cancelled' where class_id = $1`, [c])
    assert.deepEqual((await shiftsOf(q)).map(s => s.status), ['approved'])
  })

  t('only that class and date lose their shift', async ({ q }) => {
    const a = await classWithLesson(q)
    const b = await classWithLesson(q, { name: 'Y8 English' })
    await mark(q, a, '2026-10-14', 'present')
    await mark(q, b, '2026-10-14', 'present')
    await q(`update lessons set status = 'cancelled' where class_id = $1`, [a])
    assert.deepEqual((await shiftsOf(q)).map(s => s.source_id), [`${b}_2026-10-14`])
  })

  t('the pay rise applies from its effective date', async ({ q }) => {
    const before = await classWithLesson(q, { date: '2026-10-14' })
    const after = await classWithLesson(q, { date: '2026-10-21' })
    await mark(q, before, '2026-10-14', 'present')
    await mark(q, after, '2026-10-21', 'present')
    assert.deepEqual((await shiftsOf(q)).map(s => s.rate_snapshot), [40, 45])
  })

  t('a 1:1 is paid at the 1:1 rate', async ({ q }) => {
    const c = await classWithLesson(q, { name: 'Y8 Maths 1:1', start: '5:00', end: '6:00' })
    await mark(q, c, '2026-10-14', 'present')
    const [s] = await shiftsOf(q)
    assert.equal(s.rate_snapshot, 55)
    assert.equal(s.hours, 1)
  })

  t('a cover teacher on the lesson is paid instead of the class teacher', async ({ q }) => {
    const c = await classWithLesson(q, { name: 'Y5 Maths', scheduledTeacher: RYAN })
    await mark(q, c, '2026-10-14', 'present')
    const [s] = await shiftsOf(q)
    assert.equal(s.tutor_id, RYAN)
    assert.equal(s.rate_snapshot, 60)
  })

  t('no rate set: the shift is still created, with no rate (approval will refuse it)', async ({ q }) => {
    const c = await classWithLesson(q, { teacher: 'James' })
    await mark(q, c, '2026-10-14', 'present')
    const [s] = await shiftsOf(q)
    assert.equal(s.tutor_id, JAMES)
    assert.equal(s.rate_snapshot, null)
  })

  t('an unknown teacher, or a class with no times, creates nothing', async ({ q }) => {
    const ghost = await classWithLesson(q, { teacher: 'Substitute' })
    const untimed = await classWithLesson(q, { start: '', end: '' })
    await mark(q, ghost, '2026-10-14', 'present')
    await mark(q, untimed, '2026-10-14', 'present')
    assert.deepEqual(await shiftsOf(q), [])
  })

  t('a lesson of no length, or over 12 hours, creates nothing', async ({ q }) => {
    const zero = await classWithLesson(q, { start: '9:00', end: '9:00' })
    const marathon = await classWithLesson(q, { start: '8:00', end: '21:00' })
    await mark(q, zero, '2026-10-14', 'present')
    await mark(q, marathon, '2026-10-14', 'present')
    assert.deepEqual(await shiftsOf(q), [])
  })

  t('an approved shift is never rewritten by a later re-mark', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'present')
    await q(`update shifts set status = 'approved'`)
    await q(`update classes set end_time = '7:00' where id = $1`, [c])
    await mark(q, c, '2026-10-14', 'present', STUDENTS[1])
    assert.equal((await shiftsOf(q))[0].hours, 2)
  })

  t('a draft shift follows a corrected class time', async ({ q }) => {
    const c = await classWithLesson(q)
    await mark(q, c, '2026-10-14', 'present')
    await q(`update classes set end_time = '7:00' where id = $1`, [c])
    await mark(q, c, '2026-10-14', 'present', STUDENTS[1])
    assert.equal((await shiftsOf(q))[0].hours, 3)
  })
})

// ── Drop-in shifts ──────────────────────────────────────────────────────────
describe('drop-in shifts', () => {
  const dropin = (q, { tutors = ['Monica', 'Ryan'], years = ['Year 9', 'Year 10'], start = '15:30', end = '18:00' } = {}) =>
    q(`insert into dropin_sessions (session_date, start_time, end_time, tutors, year_groups, location)
       values ('2026-10-15', $1, $2, $3, $4, 'Chatswood centre') returning id`, [start, end, tutors, years]).then(r => r[0].id)

  t('one shift per rostered tutor, at their class rate for the year band', async ({ q }) => {
    await dropin(q)
    const s = await shiftsOf(q)
    assert.equal(s.length, 2)
    assert.deepEqual(s.map(x => [x.tutor_id, x.hours, x.kind]), [[MONICA, 2.5, 'dropin'], [RYAN, 2.5, 'dropin']])
    assert.equal(s.find(x => x.tutor_id === MONICA).rate_snapshot, 42)   // 9–10 band
  })

  t('mixed year bands use the "other" rate; unknown names are skipped', async ({ q }) => {
    await dropin(q, { tutors: ['Monica', 'Stranger'], years: ['Year 8', 'Year 11'] })
    const s = await shiftsOf(q)
    assert.equal(s.length, 1)
    assert.equal(s[0].rate_snapshot, 35)
  })

  t('editing the session does not duplicate or rewrite the shifts', async ({ q }) => {
    const id = await dropin(q)
    await q(`update dropin_sessions set end_time = '19:00' where id = $1`, [id])
    const s = await shiftsOf(q)
    assert.equal(s.length, 2)
    assert.ok(s.every(x => x.hours === 2.5))
  })

  t('a rostered tutor can shorten their own drop-in shift, within the session only', async ({ q, one, as, rejects }) => {
    const id = await dropin(q)
    await as(MONICA)
    const s = await one(`select hours::float, rate_snapshot::float from save_dropin_shift($1, '16:00', '17:30')`, [id])
    assert.deepEqual(s, { hours: 1.5, rate_snapshot: 42 })
    await rejects(`select save_dropin_shift($1, '15:00', '17:00')`, [id], /cannot start before/)
    await rejects(`select save_dropin_shift($1, '16:00', '18:30')`, [id], /past the end/)
    await rejects(`select save_dropin_shift($1, '17:00', '16:00')`, [id], /finish time must be after/)
  })

  t('only a rostered, signed-in tutor can save a drop-in shift', async ({ q, as, rejects }) => {
    const id = await dropin(q, { tutors: ['Ryan'] })
    await as(MONICA)
    await rejects(`select save_dropin_shift($1)`, [id], /Only a tutor rostered/)
    await as(null)
    await rejects(`select save_dropin_shift($1)`, [id], /Not signed in/)
  })

  t('an approved drop-in shift cannot be edited by the tutor', async ({ q, one, as, rejects }) => {
    const id = await dropin(q)
    await q(`update shifts set status = 'approved'`)
    await as(MONICA)
    const s = await one(`select hours::float from save_dropin_shift($1, '16:00', '16:30')`, [id])
    assert.equal(s.hours, 2.5)
  })
})

// ── Pay periods ─────────────────────────────────────────────────────────────
describe('pay periods', () => {
  const period = (one, d) => one(`select period_start::text s, period_end::text e, fortnight_index i from pay_period_for($1)`, [d])

  t('term fortnights run from the Monday of week 1', async ({ one }) => {
    assert.deepEqual(await period(one, '2026-10-12'), { s: '2026-10-12', e: '2026-10-25', i: 1 })
    assert.deepEqual(await period(one, '2026-10-25'), { s: '2026-10-12', e: '2026-10-25', i: 1 })
    assert.deepEqual(await period(one, '2026-10-26'), { s: '2026-10-26', e: '2026-11-08', i: 2 })
    assert.deepEqual(await period(one, '2026-12-19'), { s: '2026-12-07', e: '2026-12-20', i: 5 })
  })

  t('a Tuesday-start term: its Monday is fortnight 1, not the holidays', async ({ one }) => {
    assert.deepEqual(await period(one, '2026-07-13'), { s: '2026-07-13', e: '2026-07-26', i: 1 })
  })

  t('the holidays are one period up to the next term, ignoring holiday programs', async ({ one }) => {
    assert.deepEqual(await period(one, '2026-09-20'), { s: '2026-09-20', e: '2026-10-11', i: 0 })
    assert.deepEqual(await period(one, '2026-09-30'), { s: '2026-09-20', e: '2026-10-11', i: 0 })
  })
})

// ── Pay runs ────────────────────────────────────────────────────────────────
describe('pay runs', () => {
  // Two marked lessons in fortnight 1 (Monica 2h@40, James 2h@no rate), one in fortnight 2.
  async function fortnight(q, as, one) {
    await mark(q, await classWithLesson(q, { date: '2026-10-14' }), '2026-10-14', 'present')
    await mark(q, await classWithLesson(q, { teacher: 'James', date: '2026-10-15' }), '2026-10-15', 'present')
    await mark(q, await classWithLesson(q, { date: '2026-10-28' }), '2026-10-28', 'present')
    await as(ADMIN, 'admin')
    return one(`select id from ensure_pay_run('2026-10-14')`).then(r => r.id)
  }
  const shiftOn = (one, date) => one(`select id from shifts where work_date = $1`, [date]).then(r => r.id)
  const run = (one, id) => one(`select status, total_hours::float h, total_amount::float a from pay_runs where id = $1`, [id])

  t('only an admin can open, approve, un-approve or export a pay run', async ({ q, one, as, rejects }) => {
    const pr = await fortnight(q, as, one)
    const s = await shiftOn(one, '2026-10-14')
    for (const who of [[null], [MONICA], [RYAN, 'director']]) {
      await as(...who)
      await rejects(`select ensure_pay_run('2026-10-14')`, undefined, /forbidden/)
      await rejects(`select approve_shift($1, $2)`, [s, pr], /forbidden/)
      await rejects(`select unapprove_shift($1)`, [s], /forbidden/)
      await rejects(`select approve_pay_run($1)`, [pr], /forbidden/)
      await rejects(`select mark_pay_run_exported($1)`, [pr], /forbidden/)
    }
  })

  t('opening a pay run is idempotent and uses the term fortnight', async ({ one, as }) => {
    await as(ADMIN, 'admin')
    const a = await one(`select id, period_start::text s, period_end::text e from ensure_pay_run('2026-10-14')`)
    const b = await one(`select id from ensure_pay_run('2026-10-20')`)
    assert.equal(a.id, b.id)
    assert.deepEqual([a.s, a.e], ['2026-10-12', '2026-10-25'])
  })

  t('approving one shift attaches it and updates the run totals', async ({ q, one, as, rejects }) => {
    const pr = await fortnight(q, as, one)
    await q(`select approve_shift($1, $2)`, [await shiftOn(one, '2026-10-14'), pr])
    assert.deepEqual(await run(one, pr), { status: 'open', h: 2, a: 80 })
  })

  t('a shift with no rate, or from another fortnight, cannot be approved into the run', async ({ q, one, as, rejects }) => {
    const pr = await fortnight(q, as, one)
    await rejects(`select approve_shift($1, $2)`, [await shiftOn(one, '2026-10-15'), pr], /no rate/)
    await rejects(`select approve_shift($1, $2)`, [await shiftOn(one, '2026-10-28'), pr], /not in this pay period/)
  })

  t('a shift cannot be approved twice', async ({ q, one, as, rejects }) => {
    const pr = await fortnight(q, as, one)
    const s = await shiftOn(one, '2026-10-14')
    await q(`select approve_shift($1, $2)`, [s, pr])
    await rejects(`select approve_shift($1, $2)`, [s, pr], /already approved/)
  })

  t('un-approving takes the shift back out and the totals with it', async ({ q, one, as, rejects }) => {
    const pr = await fortnight(q, as, one)
    const s = await shiftOn(one, '2026-10-14')
    await q(`select approve_shift($1, $2)`, [s, pr])
    await q(`select unapprove_shift($1)`, [s])
    assert.deepEqual(await one(`select status, pay_run_id from shifts where id = $1`, [s]), { status: 'submitted', pay_run_id: null })
    assert.deepEqual(await run(one, pr), { status: 'open', h: 0, a: 0 })
  })

  t('approving the run sweeps in its priced shifts only — never unpriced, void or next fortnight', async ({ q, one, as, rejects }) => {
    const pr = await fortnight(q, as, one)
    await q(`insert into shifts (tutor_id, work_date, hours, kind, rate_snapshot, status) values ($1, '2026-10-16', 1, 'admin', 30, 'void')`, [MONICA])
    await q(`select approve_pay_run($1)`, [pr])
    assert.deepEqual(await run(one, pr), { status: 'approved', h: 2, a: 80 })
    const byDate = Object.fromEntries((await q(`select work_date::text d, status from shifts where kind <> 'admin'`)).map(r => [r.d, r.status]))
    assert.deepEqual(byDate, { '2026-10-14': 'approved', '2026-10-15': 'draft', '2026-10-28': 'draft' })
  })

  t('approving without the sweep needs at least one approved shift', async ({ q, one, as, rejects }) => {
    const pr = await fortnight(q, as, one)
    await rejects(`select approve_pay_run($1, false)`, [pr], /no approved shifts/)
  })

  t('the pay-run view prices each shift as hours × rate', async ({ q, one, as, rejects }) => {
    await fortnight(q, as, one)
    const rows = await q(`select tutor_name, amount::float, period_start::text from pay_run_shifts order by work_date`)
    assert.deepEqual(rows.map(r => [r.tutor_name, r.amount, r.period_start]), [
      ['Monica Chen', 80, '2026-10-12'], ['James Wu', 0, '2026-10-12'], ['Monica Chen', 90, '2026-10-26'],
    ])
  })

  t('export needs an approved run; after export the run and its shifts are locked', async ({ q, one, as, rejects }) => {
    const pr = await fortnight(q, as, one)
    await rejects(`select mark_pay_run_exported($1)`, [pr], /must be approved/)
    await q(`select approve_pay_run($1)`, [pr])
    await q(`select mark_pay_run_exported($1)`, [pr])
    assert.equal((await run(one, pr)).status, 'exported')
    await rejects(`select approve_pay_run($1)`, [pr], /already exported/)
    await q(`update shifts set rate_snapshot = 40 where work_date = '2026-10-15'`)
    await rejects(`select approve_shift($1, $2)`, [await shiftOn(one, '2026-10-15'), pr], /already exported/)
    await rejects(`select unapprove_shift($1)`, [await shiftOn(one, '2026-10-14')], /cannot be pulled back/)
  })
})

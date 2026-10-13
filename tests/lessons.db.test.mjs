/*
 * Lesson schedulers — add / update / sync_lessons_for_class — on the
 * in-memory copy of the live schema (tests/db/harness.mjs).
 *
 * They are SECURITY DEFINER (full rights whoever calls), so the only thing
 * standing between a logged-in student and the timetable is their own staff
 * check. These tests pin that check, and that staff still get the behaviour.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

const TUTOR   = '00000000-0000-0000-0000-00000000000a'
const STUDENT = '00000000-0000-0000-0000-0000000000c1'
const FUNCS = [
  `select add_lessons_for_class($1, false)`,
  `select add_lessons_for_class($1, true)`,
  `select update_lessons_for_class($1, false)`,
  `select update_lessons_for_class($1, true)`,
  `select sync_lessons_for_class($1)`,
]

let db
before(async () => { db = await freshDb() })

// A term running now, and a Monday + Thursday class in it with no lessons yet.
async function setup(q) {
  await q(`insert into tutors (id, full_name, email) values ($1, 'Monica Chen', 'monica@example.com')`, [TUTOR])
  const [{ id: term }] = await q(`insert into terms (name, year, term_number, start_date, end_date)
    values ('Now', 2026, 4, current_date - 14, current_date + 60) returning id`)
  const [{ id }] = await q(`insert into classes (class_name, day_of_week, start_time, end_time, teacher, term_id)
    values ('Y8 Maths', 'Monday, Thursday', '4:00', '6:00', 'Monica', $1) returning id`, [term])
  return id
}
const lessonCount = async (q, cls) => (await q(`select count(*)::int n from lessons where class_id = $1`, [cls]))[0].n
// Future Mondays and Thursdays to the end of the term (what Add should create).
const expectedFuture = async (q) => (await q(`select count(*)::int n from generate_series(current_date, current_date + 60, '1 day') d
  where extract(dow from d) in (1, 4)`))[0].n
const run = (t) => test(t.name, () => inTx(db, t.fn))

run({ name: 'a logged-in student cannot run any lesson scheduler, even as a preview', fn: async ({ q, as, rejects }) => {
  const cls = await setup(q)
  await as(STUDENT, 'student')
  for (const sql of FUNCS) await rejects(sql, [cls], /forbidden: staff only/)
  assert.equal(await lessonCount(q, cls), 0)
} })

run({ name: 'a caller with no login at all is refused too', fn: async ({ q, as, rejects }) => {
  const cls = await setup(q)
  await as(null)
  for (const sql of FUNCS) await rejects(sql, [cls], /forbidden: staff only/)
} })

run({ name: 'staff: a tutor (by role or by staff record), a director and an admin may run them', fn: async ({ q, as }) => {
  const cls = await setup(q)
  for (const who of [[TUTOR, 'tutor'], [TUTOR], ['00000000-0000-0000-0000-0000000000ad', 'admin'], ['00000000-0000-0000-0000-0000000000dd', 'director']]) {
    await as(...who)
    for (const sql of FUNCS) await q(sql, [cls])
  }
} })

// (sync_lessons_for_class has always been staff-only, service role included.)
run({ name: 'server scripts (service role) may run Add and Update', fn: async ({ q }) => {
  const cls = await setup(q)
  await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
  for (const sql of FUNCS.filter(f => !f.includes('sync_'))) await q(sql, [cls])
} })

run({ name: 'Add: preview writes nothing; apply creates the future lessons once', fn: async ({ q, one, as }) => {
  const cls = await setup(q)
  await as(TUTOR, 'tutor')
  const preview = (await one(`select add_lessons_for_class($1, false) r`, [cls])).r
  const want = await expectedFuture(q)
  assert.equal(preview.count, want)
  assert.equal(await lessonCount(q, cls), 0)
  const applied = (await one(`select add_lessons_for_class($1, true) r`, [cls])).r
  assert.equal(applied.added, want)
  assert.equal(await lessonCount(q, cls), want)
  assert.equal((await one(`select add_lessons_for_class($1, true) r`, [cls])).r.added, 0)
} })

run({ name: 'Update: a class moved to a new day moves its future lessons — never deletes them', fn: async ({ q, one, as }) => {
  const cls = await setup(q)
  await as(TUTOR, 'tutor')
  await q(`select add_lessons_for_class($1, true)`, [cls])
  const before = await lessonCount(q, cls)
  await q(`update classes set day_of_week = 'Tuesday, Thursday' where id = $1`, [cls])
  const r = (await one(`select update_lessons_for_class($1, true) r`, [cls])).r
  assert.ok(r.updated > 0)
  assert.equal(await lessonCount(q, cls), before)
  const onMonday = (await one(`select count(*)::int n from lessons where class_id = $1 and extract(dow from lesson_date) = 1
    and lesson_date >= current_date`, [cls])).n
  assert.equal(onMonday, r.stranded.length)          // any Monday left is reported, not lost
} })

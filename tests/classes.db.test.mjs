/*
 * A class's year must match its course's year — the classes / courses
 * triggers (migrations/20261013_class_year_matches_course.sql), on the
 * in-memory copy of the live schema (tests/db/harness.mjs).
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

let db
before(async () => { db = await freshDb() })

async function setup(q) {
  await q(`insert into courses (id, course_name, course_code, delivery_mode) values
    (41, 'Y11 Advanced Maths',     '11.M2C', 'Class'),
    (42, 'Y11 Advanced Maths 1:1', '11.M2T', '1:1'),
    (53, 'Y12 Advanced Maths 1:1', '12.M2T', '1:1'),
    (58, 'HW Help/Mentoring 1:1',  'HWGLS',  '1:1')`)
}
const addClass = (q, name, courseId) =>
  q(`insert into classes (class_name, course_id) values ($1, $2) returning id`, [name, courseId]).then(r => r[0].id)
const run = (name, fn) => test(name, () => inTx(db, async (ctx) => { await setup(ctx.q); await fn(ctx) }))

run('a Year 12 class cannot be put on a Year 11 course', async ({ rejects }) => {
  const e = await rejects(`insert into classes (class_name, course_id) values ('Y12 Adv Maths 1:1', 42)`, [], /is Year 12, but its course "Y11 Advanced Maths 1:1" \(11\.M2T\) is Year 11/)
  assert.match(e.hint, /Choose the Year 12 course, or rename the class/)
})

run('matching years are fine, at any course', async ({ q }) => {
  await addClass(q, 'Y12 Adv Maths 1:1', 53)
  await addClass(q, 'Y11 Adv Maths', 41)
  await addClass(q, 'y11 maths (small group)', 41)
})

run('classes or courses with no year in their name are not checked', async ({ q }) => {
  await addClass(q, 'HW Help/Mentoring 1:1', 58)
  await addClass(q, 'Year 12 holiday revision', 42)     // "Year 12 …" is not the Y12 naming, so not read
  await addClass(q, 'Y9 Homework Help', 58)
  await addClass(q, 'Y8 Maths', null)
})

run('renaming a class into another year, or moving it to another year\'s course, is refused', async ({ q, rejects }) => {
  const id = await addClass(q, 'Y11 Adv Maths', 41)
  await rejects(`update classes set class_name = 'Y12 Adv Maths' where id = $1`, [id], /is Year 12/)
  await rejects(`update classes set course_id = 53 where id = $1`, [id], /is Year 11, but its course/)
})

run('renaming and moving together (a Year 11 → 12 promotion) is fine', async ({ q, one }) => {
  const id = await addClass(q, 'Y11 Adv Maths 1:1', 42)
  await q(`update classes set class_name = 'Y12 Adv Maths 1:1', course_id = 53 where id = $1`, [id])
  assert.equal((await one(`select course_id from classes where id = $1`, [id])).course_id, 53)
})

run('an existing mismatched class can still have its time or teacher edited', async ({ q, one }) => {
  // Rows from before the rule: let one in by switching the trigger off.
  await q(`alter table classes disable trigger classes_year_matches_course`)
  const id = await addClass(q, 'Y9 Science', 42)
  await q(`alter table classes enable trigger classes_year_matches_course`)
  await q(`update classes set start_time = '5:00', teacher = 'Ryan', day_of_week = 'Tuesday' where id = $1`, [id])
  await q(`update classes set class_name = 'Y9 Science', course_id = 42 where id = $1`, [id])   // same values: not a change
  assert.equal((await one(`select start_time from classes where id = $1`, [id])).start_time, '5:00')
})

run('a course\'s name and code must agree on the year', async ({ q, rejects }) => {
  await rejects(`insert into courses (course_name, course_code) values ('Y11 English 1:1', '12.ET')`, [], /says Year 11 in its name but Year 12 in its code/)
  await q(`insert into courses (course_name, course_code) values ('Y11 English 1:1', '11.E2T')`)
  await q(`insert into courses (course_name, course_code) values ('Speaking Development 1:1', 'SpeakDev')`)
})

run('changing a course\'s year cannot strand its classes; a course with none can change', async ({ q, rejects }) => {
  await addClass(q, 'Y11 Adv Maths', 41)
  await rejects(`update courses set course_name = 'Y12 Advanced Maths', course_code = '12.M2C' where id = 41`, [],
    /would leave classes of another year on it: Y11 Adv Maths/)
  await q(`update courses set course_name = 'Y12 Advanced Maths 1:1 (old)', course_code = '12.M2X' where id = 42`)
  await q(`update courses set course_name = 'Y11 Advanced Maths (renamed)' where id = 41`)   // same year: fine
})

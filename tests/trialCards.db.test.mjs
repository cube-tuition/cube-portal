/*
 * A trial enrolment drives its own pipeline card, never another subject's —
 * migrations/20261023_trial_cards_per_enrolment.sql (William's case: a Maths
 * trial revived his closed English enquiry instead of getting its own card).
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

let db
before(async () => { db = await freshDb() })
const WILL = '00000000-0000-0000-0000-0000000007b1'

async function setup(q) {
  const [{ id: term }] = await q(`insert into terms (name, year, term_number, start_date, end_date) values ('T4', 2026, 4, current_date - 10, current_date + 60) returning id`)
  const cls = async (n) => (await q(`insert into classes (class_name, teacher, term_id) values ($1, 'Amber', $2) returning id`, [n, term]))[0].id
  await q(`insert into students (id, full_name, year) values ($1, 'William', 5)`, [WILL])
  await q(`insert into guardians (student_id, full_name, email, phone) values ($1, 'Smona', 'smona@example.com', '0400000000')`, [WILL])
  return { english: await cls('Y5 English'), maths: await cls('Y5 Maths') }
}
const cards = (q) => q(`select id, subjects, status, enrolment_id, parent_name, parent_email from trial_submissions where converted_student_id = $1 order by id`, [WILL])

test('a new subject’s trial gets its own card; the closed enquiry for another subject stays Enrolled', () => inTx(db, async ({ q }) => {
  const { english, maths } = await setup(q)
  const [{ id: eng }] = await q(`insert into enrolments (student_id, class_id, status) values ($1, $2, 'active') returning id`, [WILL, english])
  await q(`insert into trial_submissions (student_name, subjects, status, converted_student_id, enrolment_id, trial_class_id)
    values ('William', '{English}', 'enrolled', $1, $2, $3)`, [WILL, eng, english])

  const [{ id: mat }] = await q(`insert into enrolments (student_id, class_id, status) values ($1, $2, 'active') returning id`, [WILL, maths])
  await q(`update enrolments set status = 'trial' where id = $1`, [mat])

  const [e, m, ...rest] = await cards(q)
  assert.equal(rest.length, 0)
  assert.equal(e.status, 'enrolled', 'English enquiry untouched')
  assert.deepEqual({ subjects: m.subjects, status: m.status, enrolment_id: m.enrolment_id, parent_name: m.parent_name, parent_email: m.parent_email },
    { subjects: ['Maths'], status: 'trial_scheduled', enrolment_id: mat, parent_name: 'Smona', parent_email: 'smona@example.com' })

  await q(`update enrolments set status = 'trial complete' where id = $1`, [mat])
  const after = await cards(q)
  assert.equal(after[0].status, 'enrolled', 'still untouched')
  assert.equal(after[1].status, 'trial_completed', 'only the Maths card moves')
}))

test('a web enquiry waiting for its class is not duplicated when the trial enrolment is made', () => inTx(db, async ({ q }) => {
  await setup(q)
  await q(`insert into trial_submissions (student_name, subjects, status, converted_student_id) values ('William', '{Maths}', 'new', $1)`, [WILL])
  const [{ id: enrol }] = await q(`insert into enrolments (student_id, status) values ($1, 'trial') returning id`, [WILL])
  assert.equal((await cards(q)).length, 1)

  await q(`update enrolments set status = 'trial complete' where id = $1`, [enrol])
  const all = await cards(q)
  assert.equal(all.length, 1)
  assert.equal(all[0].status, 'trial_completed', 'the only, unlinked enquiry follows the enrolment')
}))

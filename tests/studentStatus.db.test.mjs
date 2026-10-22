/*
 * A student's status is worked out from their enrolments —
 * migrations/20261021_student_status_automatic.sql (derived_student_status,
 * the two triggers and refresh_student_statuses).
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

let db
before(async () => { db = await freshDb() })

const HANNAH = '00000000-0000-0000-0000-0000000005a1'
const LEO    = '00000000-0000-0000-0000-0000000005a2'

// Terms around today (the triggers use today's Sydney date): last term, its
// holidays, this term, and next term.
async function seed(q) {
  const term = async (name, num, from, to) => (await q(
    `insert into terms (name, year, term_number, start_date, end_date)
     values ($1, 2026, $2, current_date + $3::int, current_date + $4::int) returning id`, [name, num, from, to]))[0].id
  const past = await term('Last term', 3, -120, -40)
  const hols = await term('Last holidays', 13, -35, -20)
  const now = await term('This term', 4, -10, 60)
  const next = await term('Next term', 1, 100, 170)
  const cls = async (name, t) => (await q(`insert into classes (class_name, teacher, term_id) values ($1, 'Amber', $2) returning id`, [name, t]))[0].id
  return { past: await cls('Y10 English', past), hols: await cls('Y10 English holiday', hols), now: await cls('Y10 English', now), next: await cls('Y10 English', next) }
}
const run = (name, fn) => test(name, () => inTx(db, async (ctx) => fn({ ...ctx, ...await seed(ctx.q) })))
const statusOf = async (q, id) => (await q('select status from students where id = $1', [id]))[0].status
const enrol = (q, student, cls, status = 'active', extra = {}) => q(
  `insert into enrolments (student_id, class_id, status, ended_at, end_reason) values ($1, $2, $3, $4, $5) returning id`,
  [student, cls, status, extra.ended_at ?? null, extra.end_reason ?? null])
const addStudent = (q, id, status = 'active') => q(`insert into students (id, full_name, status) values ($1, 'Student', $2)`, [id, status])

run('a new student with no enrolment is pending, whatever the page sends', async ({ q }) => {
  await addStudent(q, HANNAH, 'active')
  assert.equal(await statusOf(q, HANNAH), 'pending')
})

run('enrolling in this term makes them active; pausing (disenrolled) makes them inactive', async ({ q, now, past }) => {
  await addStudent(q, HANNAH)
  await enrol(q, HANNAH, past)                       // history
  const [{ id }] = await enrol(q, HANNAH, now)
  assert.equal(await statusOf(q, HANNAH), 'active')
  await q(`update enrolments set status = 'disenrol', ended_at = current_date - 5, end_reason = 'Paused' where id = $1`, [id])
  assert.equal(await statusOf(q, HANNAH), 'inactive')
})

run('leaving at a future date stays active until that date', async ({ q, now }) => {
  await addStudent(q, HANNAH)
  await enrol(q, HANNAH, now, 'disenrol', { ended_at: '2999-01-01', end_reason: 'Leaving end of term' })
  assert.equal(await statusOf(q, HANNAH), 'active')
})

run('only last term or its holidays → inactive; a class next term → active', async ({ q, past, hols, next }) => {
  await addStudent(q, HANNAH)
  await enrol(q, HANNAH, past)
  await enrol(q, HANNAH, hols)
  assert.equal(await statusOf(q, HANNAH), 'inactive')
  await enrol(q, HANNAH, next)
  assert.equal(await statusOf(q, HANNAH), 'active')
})

run('trial enrolments → trial, a trial enquiry with no class yet included; converting makes them active', async ({ q, now }) => {
  await addStudent(q, HANNAH); await addStudent(q, LEO)
  await enrol(q, HANNAH, now, 'trial')
  await q(`insert into enrolments (student_id, class_id, status) values ($1, null, 'trial')`, [LEO])
  assert.equal(await statusOf(q, HANNAH), 'trial')
  assert.equal(await statusOf(q, LEO), 'trial')
  await q(`update enrolments set status = 'active' where student_id = $1`, [HANNAH])   // the trial converts
  assert.equal(await statusOf(q, HANNAH), 'active')
})

run('a hand-set status does not stick', async ({ q, now }) => {
  await addStudent(q, HANNAH)
  await enrol(q, HANNAH, now)
  await q(`update students set status = 'pending' where id = $1`, [HANNAH])
  assert.equal(await statusOf(q, HANNAH), 'active')
})

run('removing the last enrolment row leaves pending; moving it to another student updates both', async ({ q, now }) => {
  await addStudent(q, HANNAH); await addStudent(q, LEO)
  const [{ id }] = await enrol(q, HANNAH, now)
  await q('update enrolments set student_id = $1 where id = $2', [LEO, id])
  assert.equal(await statusOf(q, HANNAH), 'pending')
  assert.equal(await statusOf(q, LEO), 'active')
  await q('delete from enrolments where id = $1', [id])
  assert.equal(await statusOf(q, LEO), 'pending')
})

run('the summer break keeps last term’s students active until the next term starts', async ({ q }) => {
  // Fixed calendar, read through derived_student_status's date argument.
  const t = async (name, num, a, b) => (await q(`insert into terms (name, year, term_number, start_date, end_date) values ($1, 2030, $2, $3, $4) returning id`, [name, num, a, b]))[0].id
  const t4 = await t('T4 2030', 4, '2030-10-14', '2030-12-19')
  const t1 = await t('T1 2031', 1, '2031-02-03', '2031-04-11')
  const c4 = (await q(`insert into classes (class_name, teacher, term_id) values ('Y9 Maths', 'Amber', $1) returning id`, [t4]))[0].id
  const c1 = (await q(`insert into classes (class_name, teacher, term_id) values ('Y9 Maths', 'Amber', $1) returning id`, [t1]))[0].id
  await addStudent(q, HANNAH); await addStudent(q, LEO)
  await enrol(q, HANNAH, c4); await enrol(q, LEO, c4); await enrol(q, LEO, c1)
  const at = async (id, day) => (await q('select derived_student_status($1, $2::date) s', [id, day]))[0].s
  assert.equal(await at(HANNAH, '2030-12-28'), 'active', 'holidays: still a Term 4 student')
  assert.equal(await at(HANNAH, '2031-02-03'), 'inactive', 'Term 1 starts with no Term 1 class')
  assert.equal(await at(LEO, '2031-02-03'), 'active', 'carried into Term 1')
})

run('the morning refresh fixes any student left out of step, and says how many', async ({ q, now }) => {
  await addStudent(q, HANNAH)
  await enrol(q, HANNAH, now)
  await q('alter table students disable trigger students_status_derived')
  await q(`update students set status = 'pending' where id = $1`, [HANNAH])
  await q('alter table students enable trigger students_status_derived')
  assert.equal(await statusOf(q, HANNAH), 'pending')
  assert.equal((await q('select refresh_student_statuses() n'))[0].n, 1)
  assert.equal(await statusOf(q, HANNAH), 'active')
  assert.equal((await q('select refresh_student_statuses() n'))[0].n, 0)
})

// ── Inactive students are locked out (migrations/20261022_inactive_students_locked_out.sql)
const login = async (q, id) => (await q(`select banned_until, (select count(*)::int from auth.sessions s where s.user_id = $1) sessions from auth.users where id = $1`, [id]))[0]
const locked = async (q, id) => { const l = await login(q, id); return !!l.banned_until && new Date(l.banned_until) > new Date() }

run('pausing a student suspends their login and ends their sessions; re-enrolling reopens it', async ({ q, now }) => {
  await q(`insert into auth.users (id) values ($1)`, [HANNAH])
  await addStudent(q, HANNAH)
  assert.equal(await locked(q, HANNAH), true, 'no class yet (pending) → locked')
  const [{ id }] = await enrol(q, HANNAH, now)
  assert.equal(await locked(q, HANNAH), false, 'enrolled → open')
  await q(`insert into auth.sessions (user_id) values ($1), ($1)`, [HANNAH])
  await q(`update enrolments set status = 'disenrol', ended_at = current_date - 1, end_reason = 'Paused' where id = $1`, [id])
  assert.equal(await locked(q, HANNAH), true, 'paused → locked')
  assert.equal((await login(q, HANNAH)).sessions, 0, 'signed out everywhere')
  await q(`update enrolments set status = 'active', ended_at = null where id = $1`, [id])
  assert.equal(await locked(q, HANNAH), false, 'back in a class → open again')
})

run('a trial student can sign in', async ({ q, now }) => {
  await q(`insert into auth.users (id) values ($1)`, [LEO])
  await addStudent(q, LEO)
  await enrol(q, LEO, now, 'trial')
  assert.equal(await statusOf(q, LEO), 'trial')
  assert.equal(await locked(q, LEO), false)
})

run('a staff account is never suspended, whatever a students row says', async ({ q }) => {
  await q(`insert into auth.users (id, raw_app_meta_data) values ($1, '{"role":"tutor"}')`, [LEO])
  await addStudent(q, LEO)                              // pending: would lock a student
  assert.equal(await locked(q, LEO), false)
})

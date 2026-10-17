/*
 * Who may read and write what — row-level security, signed in through the API
 * as a tutor, a student and a director (tests/db/harness.mjs).
 * migrations/20261013_tighten_staff_and_student_access.sql.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb, inTx } from './db/harness.mjs'

const MONICA = '00000000-0000-0000-0000-00000000000a'   // tutor
const RYAN   = '00000000-0000-0000-0000-00000000000d'   // director (admin)
const KIM    = '00000000-0000-0000-0000-0000000000c1'   // student in Y8 Maths
const ANA    = '00000000-0000-0000-0000-0000000000c2'   // student in Y9 English
const T4     = '00000000-0000-0000-0000-0000000000f4'

let db
before(async () => { db = await freshDb() })

async function seed(q) {
  await q(`insert into terms (id, name, year, term_number, start_date, end_date) values ($1, 'Term 4', 2026, 4, '2026-10-12', '2026-12-19')`, [T4])
  await q(`insert into tutors (id, full_name) values ($1, 'Monica Chen')`, [MONICA])
  await q(`insert into directors (id, full_name) values ($1, 'Ryan Park')`, [RYAN])
  await q(`insert into students (id, full_name) values ($1, 'Kim Lee'), ($2, 'Ana Cho')`, [KIM, ANA])
  await q(`insert into guardians (student_id, full_name) values ($1, 'Mrs Lee'), ($2, 'Mr Cho')`, [KIM, ANA])
  const [{ id: maths }] = await q(`insert into classes (class_name, teacher, term_id) values ('Y8 Maths', 'Monica', $1) returning id`, [T4])
  const [{ id: english }] = await q(`insert into classes (class_name, teacher, term_id) values ('Y9 English', 'Monica', $1) returning id`, [T4])
  await q(`insert into enrolments (student_id, class_id, price) values ($1, $2, 600), ($3, $4, 650)`, [KIM, maths, ANA, english])
  await q(`insert into lessons (class_id, lesson_date, notes, report_comment) values
    ($1, '2026-10-14', 'Kim struggled', 'Kim report'), ($2, '2026-10-15', 'Ana notes', 'Ana report')`, [maths, english])
  await q(`insert into lessons (class_id, lesson_date, is_makeup, makeup_student_id) values ($1, '2026-10-16', true, $2)`, [english, KIM])
  await q(`insert into invoices (term_id, student_id, total, status) values ($1, $2, 600, 'draft'), ($1, $3, 650, 'draft')`, [T4, KIM, ANA])
  await q(`insert into student_credits (student_id, amount, reason) values ($1, 60, 'absence'), ($2, 65, 'absence')`, [KIM, ANA])
  await q(`insert into fixed_costs (name, amount) values ('Rent', 4000)`)
  await q(`insert into portal_settings (key, value) values ('invoice_email_template', 'x'), ('chat_pins:' || $1, '[]'),
    ('level_test_email_template', 'y'), ('chat_pins:' || $2, '[]')`, [MONICA, RYAN])
  // Question bank: a Y8 Maths practice question (Kim's subject), a Y12 Ext 1
  // practice question (nobody's), and an exam question in Kim's subject.
  const [{ id: y8 }] = await q(`insert into qbank_subjects (year_level, name) values (8, 'Maths') returning id`)
  const [{ id: ext1 }] = await q(`insert into qbank_subjects (year_level, name) values (12, 'Ext 1 Maths') returning id`)
  const [{ id: y8Topic }] = await q(`insert into qbank_topics (subject_id, name) values ($1, 'Algebra') returning id`, [y8])
  const [{ id: ext1Topic }] = await q(`insert into qbank_topics (subject_id, name) values ($1, 'Vectors') returning id`, [ext1])
  const [{ id: practice }] = await q(`insert into qbank_questions (stem_latex, solution_latex, audience, topic_id) values ('2+2', '4', 'student', $1) returning id`, [y8Topic])
  const [{ id: other }] = await q(`insert into qbank_questions (stem_latex, solution_latex, audience, topic_id) values ('Ext 1 Q', 'Ext 1 answer', 'student', $1) returning id`, [ext1Topic])
  const [{ id: exam }] = await q(`insert into qbank_questions (stem_latex, solution_latex, audience, topic_id) values ('Exam Q', 'Exam answer', 'exam', $1) returning id`, [y8Topic])
  await q(`insert into qbank_question_parts (question_id, prompt_latex, solution_latex) values ($1, 'a', 'a sol'), ($2, 'b', 'b sol'), ($3, 'c', 'c sol')`, [practice, exam, other])
  const [{ id: y8Sub }] = await q(`insert into qbank_subtopics (topic_id, name) values ($1, 'Expanding brackets') returning id`, [y8Topic])
  const [{ id: ext1Sub }] = await q(`insert into qbank_subtopics (topic_id, name) values ($1, 'Projections') returning id`, [ext1Topic])
  await q(`insert into qbank_question_subtopics (question_id, subtopic_id) values ($1, $2), ($3, $2), ($4, $5)`, [practice, y8Sub, exam, other, ext1Sub])
  await q(`insert into online_resources (title, url) values ('Staff link', 'https://example.com')`)
  await q(`insert into stimulus_texts (title, body) values ('Passage', 'text')`)
  return { maths, english, exam, other, practice }
}
const n = async (q, sql, params) => (await q(sql, params))[0].n
const run = (name, fn) => test(name, () => inTx(db, async (ctx) => fn({ ...ctx, ...await seed(ctx.q) })))

describe('a tutor', () => {
  run('reads students, guardians, enrolments, directors and courses (their class pages need them)', async ({ q, signIn }) => {
    await signIn(MONICA, 'tutor')
    for (const t of ['students', 'guardians', 'enrolments', 'directors']) assert.ok(await n(q, `select count(*)::int n from ${t}`) > 0, t)
  })

  run('cannot touch invoices, credits, fixed costs or cash-pay records', async ({ q, signIn, rejects }) => {
    await signIn(MONICA, 'tutor')
    for (const t of ['invoices', 'student_credits', 'fixed_costs', 'cash_pay_status']) assert.equal(await n(q, `select count(*)::int n from ${t}`), 0, t)
    await q(`update invoices set total = 1`)
    await rejects(`insert into student_credits (student_id, amount, reason) values ($1, 500, 'x')`, [KIM], /row-level security/)
    await q(`reset role`)
    assert.deepEqual((await q(`select total::float t from invoices order by total`)).map(r => r.t), [600, 650])
  })

  run('cannot change enrolments, students, guardians, directors or courses', async ({ q, signIn, rejects }) => {
    await signIn(MONICA, 'tutor')
    await q(`update enrolments set price = 1`)
    await q(`update students set payment_method = 'cash'`)
    await q(`update guardians set email = 'evil@example.com'`)
    await q(`update directors set full_name = 'X'`)
    await rejects(`insert into enrolments (student_id, class_id) select $1, id from classes limit 1`, [ANA], /row-level security/)
    await q(`reset role`)
    assert.equal(await n(q, `select count(*)::int n from enrolments where price = 1`), 0)
    assert.equal(await n(q, `select count(*)::int n from students where payment_method = 'cash'`), 0)
    assert.equal(await n(q, `select count(*)::int n from guardians where email is not null`), 0)
    assert.equal(await n(q, `select count(*)::int n from directors where full_name = 'X'`), 0)
  })

  run('in portal settings: only their own chat pins and the level-test templates', async ({ q, signIn, rejects }) => {
    await signIn(MONICA, 'tutor')
    assert.deepEqual((await q(`select key from portal_settings order by key`)).map(r => r.key).sort(),
      [`chat_pins:${MONICA}`, 'level_test_email_template'].sort())
    await q(`update portal_settings set value = '[1]' where key = 'chat_pins:' || $1`, [MONICA])
    await q(`insert into portal_settings (key, value) values ('level_test_family_email_template', 'z')`)
    await rejects(`insert into portal_settings (key, value) values ('invoice_email_subject', 'hacked')`, [], /row-level security/)
    await q(`update portal_settings set value = 'hacked'`)               // others' rows: not visible, not touched
    await q(`reset role`)
    // Only her three rows (pins + both templates) changed; the invoice template and Ryan's pins did not.
    assert.equal(await n(q, `select count(*)::int n from portal_settings where value = 'hacked'`), 3)
    assert.equal(await n(q, `select count(*)::int n from portal_settings where key = 'invoice_email_template' and value = 'x'`), 1)
    assert.equal(await n(q, `select count(*)::int n from portal_settings where key = 'chat_pins:' || $1 and value = '[]'`, [RYAN]), 1)
  })

  run('still reads every question, exam ones included', async ({ q, signIn }) => {
    await signIn(MONICA, 'tutor')
    assert.equal(await n(q, `select count(*)::int n from qbank_questions`), 3)
    assert.equal(await n(q, `select count(*)::int n from online_resources`), 1)
  })
})

describe('a student', () => {
  run('sees the lessons of their own classes and their own makeups — nobody else\'s', async ({ q, signIn, maths }) => {
    await signIn(KIM, 'student')
    const rows = await q(`select class_id, lesson_date::text d, is_makeup from lessons order by lesson_date`)
    assert.deepEqual(rows.map(r => [r.class_id === maths ? 'Y8 Maths' : 'other', r.d, r.is_makeup]),
      [['Y8 Maths', '2026-10-14', false], ['other', '2026-10-16', true]])
    assert.equal(await n(q, `select count(*)::int n from lessons where report_comment = 'Ana report'`), 0)
  })

  run('gets practice questions in their own subject only — never an exam question, never another course', async ({ q, signIn, exam, other }) => {
    await signIn(KIM, 'student')   // enrolled in Y8 Maths
    assert.deepEqual((await q(`select stem_latex from qbank_questions`)).map(r => r.stem_latex), ['2+2'])
    assert.deepEqual((await q(`select prompt_latex from qbank_question_parts`)).map(r => r.prompt_latex), ['a'])
    assert.equal(await n(q, `select count(*)::int n from qbank_questions where id = $1`, [exam]), 0)
    assert.equal(await n(q, `select count(*)::int n from qbank_questions where id = $1`, [other]), 0)
    await signIn(ANA, 'student')   // Y9 English: no practice questions in her subject
    assert.equal(await n(q, `select count(*)::int n from qbank_questions`), 0)
  })

  run('sees the inquiry-question tags of its own practice questions only', async ({ q, signIn, practice, exam, other }) => {
    await signIn(KIM, 'student')   // enrolled in Y8 Maths
    assert.deepEqual((await q(`select question_id from qbank_question_subtopics`)).map(r => r.question_id), [practice])
    assert.equal(await n(q, `select count(*)::int n from qbank_question_subtopics where question_id in ($1, $2)`, [exam, other]), 0)
    await q(`insert into qbank_question_subtopics (question_id, subtopic_id) select $1, subtopic_id from qbank_question_subtopics`, [practice])
      .then(() => assert.fail('a student must not add tags'), () => {})
  })

  run('a trial enrolment opens the subject; a finished one closes it', async ({ q, signIn, maths }) => {
    await q(`update enrolments set status = 'trial' where class_id = $1`, [maths])
    await signIn(KIM, 'student')
    assert.equal(await n(q, `select count(*)::int n from qbank_questions`), 1)
    await q(`reset role`)
    await q(`update enrolments set status = 'disenrol', ended_at = '2026-10-20' where class_id = $1`, [maths])
    await signIn(KIM, 'student')
    assert.equal(await n(q, `select count(*)::int n from qbank_questions`), 0)
  })

  run('cannot read or change staff resources, invoices or anyone else\'s credits', async ({ q, signIn, rejects }) => {
    await signIn(KIM, 'student')
    for (const t of ['online_resources', 'stimulus_texts', 'invoices', 'guardians', 'fixed_costs', 'portal_settings']) {
      assert.equal(await n(q, `select count(*)::int n from ${t}`), 0, t)
    }
    assert.deepEqual((await q(`select amount::float a from student_credits`)).map(r => r.a), [60])   // their own
    await rejects(`insert into online_resources (title, url) values ('x', 'y')`, [], /row-level security/)
    await q(`delete from stimulus_texts`)
    await q(`reset role`)
    assert.equal(await n(q, `select count(*)::int n from stimulus_texts`), 1)
  })

  run('still reads their own profile and enrolments', async ({ q, signIn }) => {
    await signIn(KIM, 'student')
    assert.deepEqual((await q(`select id from students`)).map(r => r.id), [KIM])
    assert.equal(await n(q, `select count(*)::int n from enrolments`), 1)
  })
})

describe('practice ratings (Resources) — private to the student', () => {
  run('a student rates questions they can see, and reads only their own ratings', async ({ q, signIn, rejects, practice, other, exam }) => {
    await signIn(KIM, 'student')
    await q(`insert into practice_ratings (student_id, question_id, rating) values ($1, $2, 'hard')`, [KIM, practice])
    assert.equal(await n(q, `select count(*)::int n from practice_ratings`), 1)
    // Not someone else's name, not a question they can't see, not a made-up difficulty.
    await rejects(`insert into practice_ratings (student_id, question_id, rating) values ($1, $2, 'easy')`, [ANA, practice], /row-level security/)
    await rejects(`insert into practice_ratings (student_id, question_id, rating) values ($1, $2, 'easy')`, [KIM, exam], /row-level security/)
    await rejects(`insert into practice_ratings (student_id, question_id, rating) values ($1, $2, 'easy')`, [KIM, other], /row-level security/)
    await rejects(`insert into practice_ratings (student_id, question_id, rating) values ($1, $2, 'trivial')`, [KIM, practice], /check constraint/)
    // Undo: they can delete their own.
    await q(`delete from practice_ratings where student_id = $1`, [KIM])
    assert.equal(await n(q, `select count(*)::int n from practice_ratings`), 0)
  })

  run('nobody else reads them — not another student, a tutor or a director', async ({ q, signIn, practice }) => {
    await q(`insert into practice_ratings (student_id, question_id, rating) values ($1, $2, 'very_hard')`, [KIM, practice])
    for (const who of [[ANA, 'student'], [MONICA, 'tutor'], [RYAN, 'admin']]) {
      await signIn(...who)
      assert.equal(await n(q, `select count(*)::int n from practice_ratings`), 0, who[1])
      await q(`delete from practice_ratings`)
    }
    await q(`reset role`)
    assert.equal(await n(q, `select count(*)::int n from practice_ratings`), 1)
  })
})

describe('the job log (system monitoring)', () => {
  run('only directors read it; nobody writes it through the API (the server does)', async ({ q, signIn, rejects }) => {
    await q(`insert into job_runs (job, ok) values ('daily', true)`)
    await signIn(MONICA, 'tutor')
    assert.equal(await n(q, `select count(*)::int n from job_runs`), 0)
    await rejects(`insert into job_runs (job, ok) values ('daily', false)`, [], /row-level security/)
    await signIn(KIM, 'student')
    assert.equal(await n(q, `select count(*)::int n from job_runs`), 0)
    await signIn(RYAN, 'admin')
    assert.equal(await n(q, `select count(*)::int n from job_runs`), 1)
    await rejects(`insert into job_runs (job, ok) values ('daily', false)`, [], /row-level security/)
  })
})

describe('a director', () => {
  run('reads and writes all of it', async ({ q, signIn }) => {
    await signIn(RYAN, 'admin')
    for (const t of ['invoices', 'student_credits', 'fixed_costs', 'guardians', 'lessons', 'qbank_questions', 'portal_settings']) {
      assert.ok(await n(q, `select count(*)::int n from ${t}`) > 0, t)
    }
    await q(`update invoices set total = total + 1`)
    await q(`update enrolments set price = 700`)
    await q(`update portal_settings set value = 'new' where key = 'invoice_email_template'`)
    await q(`insert into fixed_costs (name, amount) values ('Insurance', 100)`)
    assert.equal(await n(q, `select count(*)::int n from enrolments where price = 700`), 2)
  })
})

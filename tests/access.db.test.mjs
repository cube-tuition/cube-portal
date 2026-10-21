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

  run('an Ext 1 enrolment also opens the linked Year 11 Adv practice questions — never their exam questions', async ({ q, signIn }) => {
    const JO = '00000000-0000-0000-0000-0000000000c3'
    await q(`insert into students (id, full_name) values ($1, 'Jo Park')`, [JO])
    const [{ id: course }] = await q(`insert into courses (course_name, course_code) values ('Y11 Ext 1 Maths', '11.M3') returning id`)
    const [{ id: cls }] = await q(`insert into classes (class_name, course_id, term_id) values ('Y11 Ext 1 Maths', $1, $2) returning id`, [course, T4])
    await q(`insert into enrolments (student_id, class_id, price) values ($1, $2, 700)`, [JO, cls])
    const [{ id: e1 }] = await q(`insert into qbank_subjects (year_level, name) values (11, 'Ext 1 Maths') returning id`)
    const [{ id: adv }] = await q(`insert into qbank_subjects (year_level, name) values (11, 'Adv Maths') returning id`)
    const [{ id: e1Topic }] = await q(`insert into qbank_topics (subject_id, name) values ($1, 'Binomial theorem') returning id`, [e1])
    const [{ id: advTopic }] = await q(`insert into qbank_topics (subject_id, name) values ($1, 'Calculus') returning id`, [adv])
    await q(`insert into qbank_questions (stem_latex, solution_latex, audience, topic_id) values
      ('Ext 1 practice', 's', 'student', $1), ('Adv practice', 's', 'student', $2), ('Adv exam', 's', 'exam', $2)`, [e1Topic, advTopic])
    const stems = async () => (await q(`select stem_latex from qbank_questions where stem_latex like '%practice' or stem_latex like 'Adv%' order by stem_latex`)).map(r => r.stem_latex)
    await signIn(JO, 'student')
    assert.deepEqual(await stems(), ['Ext 1 practice'])           // not linked yet: Ext 1 only
    await q(`reset role`)
    await q(`insert into qbank_subject_links (subject_id, shows_subject_id) values ($1, $2)`, [e1, adv])
    await signIn(JO, 'student')
    assert.deepEqual(await stems(), ['Adv practice', 'Ext 1 practice'])
    await q(`insert into qbank_subject_links (subject_id, shows_subject_id) values ($1, $1)`, [adv])
      .then(() => assert.fail('a student must not add links'), () => {})
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

describe('level test invitations (the parent form’s link tokens)', () => {
  run('only directors read or write them — a tutor or student never sees a token', async ({ q, signIn, rejects }) => {
    const [{ id: sub }] = await q(`insert into trial_submissions (student_name, parent_email) values ('Akari', 'p@example.com') returning id`)
    await q(`insert into level_test_invites (token, submission_id, slots) values ('tok-secret', $1, '[{"date":"2026-10-24","start":"10:00"}]')`, [sub])
    for (const who of [[MONICA, 'tutor'], [KIM, 'student']]) {
      await signIn(...who)
      assert.equal(await n(q, `select count(*)::int n from level_test_invites`), 0, who[1])
      await rejects(`insert into level_test_invites (token, submission_id) values ('x', $1)`, [sub], /row-level security/)
    }
    await signIn(RYAN, 'admin')
    assert.equal(await n(q, `select count(*)::int n from level_test_invites`), 1)
    await q(`update level_test_invites set parent_note = 'Sundays'`)
    assert.equal(await n(q, `select count(*)::int n from level_test_invites where parent_note = 'Sundays'`), 1)
  })
})

describe('the automatic reminder log (families’ emails)', () => {
  run('directors read it; nobody signed in writes it — only the service role sends', async ({ q, signIn, rejects }) => {
    await q(`insert into auto_reminders (key, kind, to_email) values ('trial:e1:2026-10-24', 'trial', 'p@example.com')`)
    for (const who of [[MONICA, 'tutor'], [KIM, 'student']]) {
      await signIn(...who)
      assert.equal(await n(q, `select count(*)::int n from auto_reminders`), 0, who[1])
      await rejects(`insert into auto_reminders (key, kind) values ('x', 'trial')`, [], /row-level security/)
    }
    await signIn(RYAN, 'admin')
    assert.equal(await n(q, `select count(*)::int n from auto_reminders`), 1)
    await rejects(`insert into auto_reminders (key, kind) values ('y', 'trial')`, [], /row-level security/)
  })
})

describe('trial class pickers (the token in a family’s email)', () => {
  run('directors only — the family’s form goes through the service role', async ({ q, signIn, rejects }) => {
    await q(`insert into trial_invites (token, submission_ids, sections) values ('t-1', '{1}', '[]')`)
    for (const who of [[MONICA, 'tutor'], [KIM, 'student']]) {
      await signIn(...who)
      assert.equal(await n(q, `select count(*)::int n from trial_invites`), 0, who[1])
      await rejects(`insert into trial_invites (token, submission_ids, sections) values ('t-2', '{1}', '[]')`, [], /row-level security/)
    }
    await signIn(RYAN, 'admin')
    assert.equal(await n(q, `select count(*)::int n from trial_invites`), 1)
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

/*
 * Student messaging (migrations/20261021_chat_students_live.sql): a student
 * sees only their own student channels, is named from their record, is
 * bounded in what they send, and can never reach the staff chat.
 */
describe('student messaging', () => {
  const SUPA_IMG = 'https://abcdefghijkl.supabase.co/storage/v1/object/public/chat-uploads/'
  // A director opens both class channels; the students are in Years 8 and 9.
  async function chatSeed({ q, signIn, asOwner, maths, english }) {
    await q(`update students set year = '8' where id = $1`, [KIM])
    await q(`update students set year = '9' where id = $1`, [ANA])
    await signIn(RYAN, 'admin')
    const [{ id: mathsChan }] = await q(`select chat_class_channel($1) as id`, [maths])
    const [{ id: englishChan }] = await q(`select chat_class_channel($1) as id`, [english])
    const [{ id: staffChan }] = await q(`select chat_create_channel('staff-room') as id`)
    await asOwner()
    return { mathsChan, englishChan, staffChan }
  }

  run('a student sees only the student channels they are in, with first names and CUBE', async (ctx) => {
    const { q, signIn } = ctx
    const { mathsChan } = await chatSeed(ctx)
    await signIn(KIM)
    const chans = await q(`select id, audience from chat_channels`)
    assert.deepEqual(chans.map(c => c.id), [mathsChan])
    const members = await q(`select distinct channel_id from chat_members`)
    assert.deepEqual(members.map(m => m.channel_id), [mathsChan])
    const names = await q(`select user_id, display_name, role from chat_member_names() order by role`)
    assert.deepEqual(names.map(r => [r.role, r.display_name]).sort(), [['director', 'CUBE'], ['student', 'Kim'], ['tutor', 'Monica']])
    await signIn(ANA)
    assert.equal(await n(q, `select count(*)::int n from chat_channels`), 1)
    assert.equal(await n(q, `select count(*)::int n from chat_channels where id = $1`, [mathsChan]), 0)
    // Staff keep full names.
    await signIn(RYAN, 'admin')
    assert.ok((await q(`select display_name from chat_member_names()`)).some(r => r.display_name === 'Kim Lee'))
  })

  run('a student opens their own thread with CUBE, nobody else’s', async (ctx) => {
    const { q, signIn, rejects } = ctx
    await chatSeed(ctx)
    await signIn(KIM)
    const [{ id }] = await q(`select chat_open_my_thread() as id`)
    const [{ id: again }] = await q(`select chat_open_my_thread() as id`)
    assert.equal(again, id)
    const members = await q(`select user_id from chat_members where channel_id = $1 order by user_id`, [id])
    assert.deepEqual(members.map(m => m.user_id).sort(), [KIM, RYAN].sort())
    await rejects(`select chat_open_student_dm($1)`, [ANA], /directors only/)
    // Their thread is always open to them.
    await q(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Kim', 'Hi, a question about homework')`, [id, KIM])
    assert.equal(await n(q, `select count(*)::int n from chat_messages where channel_id = $1`, [id]), 1)
  })

  run('a primary student has no messaging', async (ctx) => {
    const { q, signIn, rejects } = ctx
    await chatSeed(ctx)
    await q(`update students set year = '5' where id = $1`, [KIM])
    await signIn(KIM)
    await rejects(`select chat_open_my_thread()`, [], /Years 7–12/)
  })

  run('a class channel is announcements-only until a director lets students reply', async (ctx) => {
    const { q, signIn, rejects, asOwner } = ctx
    const { mathsChan } = await chatSeed(ctx)
    await signIn(KIM)
    await rejects(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Kim', 'hello')`, [mathsChan, KIM], /row-level security/)
    await signIn(RYAN, 'admin')
    await q(`select chat_set_student_replies($1, true)`, [mathsChan])
    await signIn(KIM)
    // The name on the message is the student's record, whatever the client sent; never CUBE.
    await q(`insert into chat_messages (channel_id, sender_id, sender_name, body, as_cube) values ($1, $2, 'CUBE', 'hello', true)`, [mathsChan, KIM])
    await asOwner()
    const [m] = await q(`select sender_name, as_cube from chat_messages where channel_id = $1`, [mathsChan])
    assert.deepEqual([m.sender_name, m.as_cube], ['Kim Lee', false])
  })

  run('what a student sends is bounded: length, rate, outside attachments', async (ctx) => {
    const { q, signIn, rejects } = ctx
    await chatSeed(ctx)
    await signIn(KIM)
    const [{ id }] = await q(`select chat_open_my_thread() as id`)
    await rejects(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Kim', repeat('x', 4001))`, [id, KIM], /4000 characters/)
    await rejects(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Kim', '[[img:https://evil.example/x.png]]')`, [id, KIM], /uploaded through the chat/)
    await q(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Kim', $3)`, [id, KIM, `[[img:${SUPA_IMG}${id}/photo.jpg]]`])
    for (let i = 0; i < 19; i++) await q(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Kim', 'm')`, [id, KIM])
    await rejects(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Kim', 'one too many')`, [id, KIM], /Too many messages/)
  })

  run('a student cannot leave a class channel, see the staff chat, or report in it', async (ctx) => {
    const { q, signIn, rejects, asOwner } = ctx
    const { mathsChan, staffChan } = await chatSeed(ctx)
    await signIn(RYAN, 'admin')
    await q(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Ryan', 'staff only')`, [staffChan, RYAN])
    await asOwner()
    const [{ id: staffMsg }] = await q(`select id from chat_messages where channel_id = $1`, [staffChan])
    await signIn(KIM)
    await q(`delete from chat_members where user_id = $1`, [KIM])
    assert.equal(await n(q, `select count(*)::int n from chat_channels where id = $1`, [mathsChan]), 1, 'still a member')
    assert.equal(await n(q, `select count(*)::int n from chat_channels where id = $1`, [staffChan]), 0)
    assert.equal(await n(q, `select count(*)::int n from chat_messages where id = $1`, [staffMsg]), 0)
    await rejects(`select chat_report_message($1, 'x')`, [staffMsg], /own conversations/)
    await rejects(`select chat_create_channel('mine')`, [], /staff only/)
    await rejects(`select chat_class_channel(1)`, [], /directors only/)
  })

  run('a director takes a message down and its text is kept, for directors only', async (ctx) => {
    const { q, signIn, asOwner, rejects } = ctx
    await chatSeed(ctx)
    await signIn(KIM)
    const [{ id }] = await q(`select chat_open_my_thread() as id`)
    await q(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Kim', 'something unkind')`, [id, KIM])
    await asOwner()
    const [{ id: msg }] = await q(`select id from chat_messages where channel_id = $1`, [id])
    await signIn(KIM)
    await rejects(`select chat_hide_message($1)`, [msg], /directors only/)
    await signIn(RYAN, 'admin')
    await q(`select chat_hide_message($1)`, [msg])
    assert.equal(await n(q, `select count(*)::int n from chat_messages where id = $1 and deleted_at is not null`, [msg]), 1)
    const hist = await q(`select body, action from chat_message_history where message_id = $1`, [msg])
    assert.deepEqual(hist, [{ body: 'something unkind', action: 'deleted' }])
    await signIn(KIM)
    assert.equal(await n(q, `select count(*)::int n from chat_message_history`), 0)
  })

  run('a class channel is hidden from its students until a director opens it (soft launch)', async (ctx) => {
    const { q, signIn, rejects, asOwner } = ctx
    const { mathsChan } = await chatSeed(ctx)
    await q(`update chat_channels set student_visible = false where id = $1`, [mathsChan])
    await signIn(RYAN, 'admin')
    await q(`insert into chat_messages (channel_id, sender_id, sender_name, body) values ($1, $2, 'Ryan', 'welcome')`, [mathsChan, RYAN])
    await signIn(KIM)
    assert.equal(await n(q, `select count(*)::int n from chat_channels`), 0)
    assert.equal(await n(q, `select count(*)::int n from chat_messages`), 0)
    assert.equal(await n(q, `select count(*)::int n from chat_members`), 0)
    assert.equal(await n(q, `select count(*)::int n from chat_unread_counts()`), 0)
    await rejects(`select chat_set_student_visible($1, true)`, [mathsChan], /director/)
    // The teacher still sees it.
    await signIn(MONICA, 'tutor')
    assert.equal(await n(q, `select count(*)::int n from chat_channels where id = $1`, [mathsChan]), 1)
    await signIn(RYAN, 'admin')
    await q(`select chat_set_student_visible($1, true)`, [mathsChan])
    await signIn(KIM)
    assert.equal(await n(q, `select count(*)::int n from chat_channels where id = $1`, [mathsChan]), 1)
    assert.equal(await n(q, `select count(*)::int n from chat_messages`), 1)
    assert.deepEqual(await q(`select n::int from chat_unread_counts()`), [{ n: 1 }])
    await asOwner()
  })

  run('the class teacher is in the class channel; a student’s message is visible to them', async (ctx) => {
    const { q, signIn } = ctx
    const { mathsChan, englishChan } = await chatSeed(ctx)
    await signIn(MONICA, 'tutor')
    const chans = (await q(`select id from chat_channels where audience = 'students' order by id`)).map(c => c.id).sort()
    assert.deepEqual(chans, [mathsChan, englishChan].sort())
  })
})

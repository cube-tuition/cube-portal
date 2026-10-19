/*
 * The 24-hours-before reminders — lib/autoReminders.js. Pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sydneyTime, isDue, trialItems, levelTestItems, dueReminders, reminderEmail } from '../lib/autoReminders.js'

test('Sydney wall-clock times, either side of daylight saving', () => {
  assert.equal(sydneyTime('2026-10-24', '13:00').toISOString(), '2026-10-24T02:00:00.000Z')   // AEDT +11
  assert.equal(sydneyTime('2026-06-20', '13:00').toISOString(), '2026-06-20T03:00:00.000Z')   // AEST +10
})

test('due inside the 24 hours before the start, never after it starts', () => {
  const start = sydneyTime('2026-10-24', '13:00')
  assert.equal(isDue(start, sydneyTime('2026-10-23', '12:59')), false)
  assert.equal(isDue(start, sydneyTime('2026-10-23', '13:00')), true)
  assert.equal(isDue(start, sydneyTime('2026-10-24', '12:00')), true)
  assert.equal(isDue(start, sydneyTime('2026-10-24', '13:00')), false)
})

const base = {
  enrolments: [{ id: 'e1', student_id: 's1', class_id: 7, trial_start_date: '2026-10-24' }],
  lessons: [
    { class_id: 7, lesson_date: '2026-10-17', start_time: '13:00:00', end_time: '14:30:00' },
    { class_id: 7, lesson_date: '2026-10-24', start_time: '13:00:00', end_time: '14:30:00', room: 'Room 2' },
    { class_id: 7, lesson_date: '2026-10-31', start_time: null, end_time: null },
    { class_id: 7, lesson_date: '2026-11-07', start_time: '13:00:00', end_time: '14:30:00' },
  ],
  classes: [{ id: 7, class_name: 'Y5 Maths', start_time: '13:15:00', end_time: '14:45:00' }],
  students: [{ id: 's1', full_name: 'Akari Lee' }],
  subs: [{ id: 51, enrolment_id: 'e1', converted_student_id: 's1', trial_class_id: 7, status: 'trial_scheduled', parent_name: 'Emiko Lee', parent_email: 'emiko@example.com' }],
  guardians: [],
}

test('a reminder for each of the two trial lessons, from the trial start', () => {
  const items = trialItems(base)
  assert.deepEqual(items.map(i => [i.key, i.lessonNo, i.slot.start, i.slot.room, i.nextDate]), [
    ['trial:e1:2026-10-24', 1, '13:00', 'Room 2', '2026-10-31'],
    // no lesson time on the day: the class's time
    ['trial:e1:2026-10-31', 2, '13:15', '', null],
  ])
  assert.equal(items[0].email, 'emiko@example.com')
  assert.equal(items[0].submissionId, 51)
})

test('no trial reminders for a paused enquiry, or with no email anywhere', () => {
  assert.equal(trialItems({ ...base, subs: [{ ...base.subs[0], status: 'on_hold' }] }).length, 0)
  assert.equal(trialItems({ ...base, subs: [] }).length, 0)
  // …but the guardian's email will do
  assert.equal(trialItems({ ...base, subs: [], guardians: [{ student_id: 's1', full_name: 'Emiko', email: 'g@example.com' }] })[0].email, 'g@example.com')
})

test('each subject of a two-subject trial is matched to its own submission', () => {
  const items = trialItems({
    ...base,
    enrolments: [...base.enrolments, { id: 'e2', student_id: 's1', class_id: 8, trial_start_date: '2026-10-24' }],
    lessons: [...base.lessons, { class_id: 8, lesson_date: '2026-10-24', start_time: '15:00', end_time: '16:30' }],
    classes: [...base.classes, { id: 8, class_name: 'Y5 English' }],
    subs: [...base.subs, { id: 52, enrolment_id: 'e2', converted_student_id: 's1', trial_class_id: 8, status: 'declined', parent_email: 'emiko@example.com' }],
  })
  // English was declined: Maths only
  assert.deepEqual([...new Set(items.map(i => i.submissionId))], [51])
})

test('level tests: booked through an invitation, not one booked inside the window', () => {
  const lessons = [
    { id: 1, lesson_date: '2026-10-23', start_time: '16:00:00', end_time: '17:30:00', room: null, status: 'scheduled', student_name: 'Luke Hong' },
    { id: 2, lesson_date: '2026-10-23', start_time: '10:00:00', end_time: '11:30:00', status: 'cancelled' },
    { id: 3, lesson_date: '2026-10-23', start_time: '12:00:00', end_time: '13:30:00', status: 'scheduled' },   // no invite: no family email
    { id: 4, lesson_date: '2026-10-23', start_time: '18:00:00', end_time: '19:30:00', status: 'scheduled', student_name: 'Mia' },
  ]
  const invites = [
    { lesson_id: 1, submission_id: 40, responded_at: '2026-10-19T03:00:00Z' },
    { lesson_id: 2, submission_id: 41, responded_at: '2026-10-19T03:00:00Z' },
    { lesson_id: 4, submission_id: 42, responded_at: '2026-10-23T01:00:00Z' },   // booked that morning
  ]
  const subs = [{ id: 40, parent_name: 'Yoon Hong', parent_email: 'yoon@example.com' }, { id: 41, parent_email: 'x@example.com' }, { id: 42, parent_email: 'm@example.com' }]
  const items = levelTestItems({ lessons, invites, subs })
  assert.deepEqual(items.map(i => [i.key, i.bookedLate]), [['level_test:1:2026-10-23:16:00', false], ['level_test:4:2026-10-23:18:00', true]])
  const now = sydneyTime('2026-10-22', '17:00')
  assert.deepEqual(dueReminders(items, { now }).map(i => i.key), ['level_test:1:2026-10-23:16:00'])
  // …and once sent, never again
  assert.deepEqual(dueReminders(items, { now, sentKeys: new Set(['level_test:1:2026-10-23:16:00']) }), [])
  const { subject, html } = reminderEmail(items[0])
  assert.equal(subject, 'Reminder: Luke’s level test on Friday 23 October')
  assert.match(html, /4:00pm – 5:30pm/)
  assert.match(html, /about 90 minutes/)
  assert.doesNotMatch(html, /free of charge/)
})

test('trial reminder emails name the lesson and, for the first, the second date', () => {
  const [l1, l2] = trialItems(base)
  assert.equal(reminderEmail(l1).subject, 'Reminder: Akari’s first trial lesson on Saturday 24 October')
  assert.match(reminderEmail(l1).html, /second trial lesson is on Saturday 31 October/)
  assert.equal(reminderEmail(l2).subject, 'Reminder: Akari’s second trial lesson on Saturday 31 October')
  assert.match(reminderEmail(l2).html, /in touch after the lesson/)
})

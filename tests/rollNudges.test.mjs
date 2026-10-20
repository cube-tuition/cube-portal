/*
 * Unmarked rolls → the tutor who ran the lesson — lib/rollNudges.js. Pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unmarkedByTutor, unmarkedLessons, rollNudgeEmail, rollNudgePush } from '../lib/rollNudges.js'

const now = new Date('2026-10-20T08:00:00+11:00')     // Tue 20 Oct, 8am Sydney
const staff = [
  { id: 'kevin', full_name: 'Kevin Park', email: 'kevin@example.com' },
  { id: 'amber', full_name: 'Amber Kim', email: 'amber@example.com' },
  { id: 'ryan',  full_name: 'Ryan Park', email: 'ryan@example.com' },
]
const classes = [
  { id: 1, class_name: 'Y8 English', teacher: 'Kevin', end_time: '18:00' },
  { id: 2, class_name: 'Y6 Maths', teacher: 'Amber', end_time: '17:00' },
  { id: 3, class_name: 'Y12 Adv', teacher: 'Ryan', end_time: '20:00' },
  { id: 4, class_name: 'Empty class', teacher: 'Kevin', end_time: '18:00' },
]
const L = (over) => ({ status: 'scheduled', is_makeup: false, lesson_type: null, main_teacher: null, scheduled_teacher_id: null, start_time: '16:00', end_time: null, ...over })
const base = { classes, staff, enrolled: new Set([1, 2, 3]), directorIds: new Set(['ryan']), now }

test('a finished lesson with no roll goes to the tutor who ran it', () => {
  const r = unmarkedByTutor({ ...base, lessons: [L({ class_id: 1, lesson_date: '2026-10-19' })] })
  assert.deepEqual(r.map(g => [g.tutor.id, g.lessons.map(l => l.lesson_date)]), [['kevin', ['2026-10-19']]])
})

test('a scheduled cover teacher gets it, not the class’s main teacher', () => {
  const r = unmarkedByTutor({ ...base, lessons: [L({ class_id: 1, lesson_date: '2026-10-19', scheduled_teacher_id: 'amber' })] })
  assert.deepEqual(r.map(g => g.tutor.id), ['amber'])
})

test('nothing for marked, cancelled, makeup, level test, empty, director, older than a week or not yet finished', () => {
  const lessons = [
    L({ class_id: 1, lesson_date: '2026-10-18' }),                          // marked
    L({ class_id: 1, lesson_date: '2026-10-17', status: 'cancelled' }),
    L({ class_id: 1, lesson_date: '2026-10-16', is_makeup: true }),
    L({ class_id: 1, lesson_date: '2026-10-15', lesson_type: 'level_test' }),
    L({ class_id: 4, lesson_date: '2026-10-19' }),                          // nobody enrolled
    L({ class_id: 3, lesson_date: '2026-10-19' }),                          // director's class
    L({ class_id: 1, lesson_date: '2026-10-12' }),                          // more than a week ago
    L({ class_id: 2, lesson_date: '2026-10-20' }),                          // today, ends 5pm
  ]
  assert.deepEqual(unmarkedByTutor({ ...base, lessons, marked: new Set(['1|2026-10-18']) }), [])
})

test('today’s lesson once it has finished', () => {
  const evening = new Date('2026-10-20T17:30:00+11:00')
  const r = unmarkedByTutor({ ...base, now: evening, lessons: [L({ class_id: 2, lesson_date: '2026-10-20' })] })
  assert.deepEqual(r.map(g => g.tutor.id), ['amber'])
})

test('one nudge per tutor listing every lesson, oldest first, linking to each roll', () => {
  const [g] = unmarkedByTutor({ ...base, lessons: [L({ class_id: 1, lesson_date: '2026-10-19' }), L({ class_id: 1, lesson_date: '2026-10-14' })] })
  assert.deepEqual(g.lessons.map(l => l.lesson_date), ['2026-10-14', '2026-10-19'])
  const { subject, html } = rollNudgeEmail(g, 'https://portal.example')
  assert.equal(subject, 'Please mark 2 rolls')
  assert.match(html, /Hi Kevin,/)
  assert.match(html, /href="https:\/\/portal\.example\/tutor\/classes\/1\/2026-10-14"/)
  assert.equal(rollNudgePush(g).title, '📋 2 rolls to mark')
  assert.equal(rollNudgePush({ ...g, lessons: [g.lessons[0]] }).url, '/tutor/classes/1/2026-10-14')
})

test('the term list follows the real lessons: a lesson moved to another day is expected only on the day it ran', () => {
  // Amber's Wednesday 1:1 ran on Monday 12 Oct that week; there is no lesson
  // row on Wednesday 14 Oct, so nothing is owed for the 14th.
  const r = unmarkedLessons({ ...base, from: '2026-10-12', lessons: [
    L({ class_id: 2, lesson_date: '2026-10-12', start_time: '18:00' }),
    L({ class_id: 2, lesson_date: '2026-10-13', status: 'cancelled' }),
    L({ class_id: 1, lesson_date: '2026-10-05' }),                       // before the term
  ] })
  assert.deepEqual(r.map(l => [l.class_id, l.lesson_date, l.start_time, l.teacher.id]), [[2, '2026-10-12', '18:00', 'amber']])
})

/*
 * Level test invitation — lib/levelTestInvite.js. Pure: the composer, the
 * send route, the parent's form and its API all share these rules.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseSlots, openSlots, testEnd, availabilitySlots, slotLabel, matchLevelTests, planInviteResponse,
  buildLevelTestInvitationEmailHtml, buildLevelTestBookedEmailHtml,
} from '../lib/levelTestInvite.js'

const SAT = { date: '2026-10-24', start: '10:00', end: '11:00', room: null }
const TUE = { date: '2026-10-27', start: '16:30', end: '17:30', room: 'Room 2' }

test('suggested times are cleaned, deduplicated and sorted', () => {
  const out = normaliseSlots([
    TUE,
    { date: '2026-10-24', start: '10:00:00', end: '11:00' },   // same as SAT, db-style time
    SAT,
    { date: '', start: '10:00' },                              // no date
    { date: '2026-10-25', start: 'later' },                     // no start
    { date: '2026-10-26', start: '9:00', end: '08:00', room: '  ' },   // end before start
  ])
  assert.deepEqual(out, [
    SAT,
    { date: '2026-10-26', start: '09:00', end: null, room: null },
    TUE,
  ])
})

test('only times from today on can be picked', () => {
  assert.deepEqual(openSlots([SAT, TUE], '2026-10-25'), [TUE])
  assert.deepEqual(openSlots([SAT, TUE], '2026-10-24').length, 2)
})

test('a level test defaults to an hour', () => {
  assert.equal(testEnd('10:00'), '11:30')
  assert.equal(testEnd('16:45'), '18:15')
  assert.equal(testEnd(''), '')
  // every window of the family's availability, on the next such day
  assert.deepEqual(
    availabilitySlots({ Saturday: ['10:00am – 12:00pm'], Friday: ['4:00pm – 6:00pm'], Monday: ['6:00pm – 8:00pm', '12:00pm – 2:00pm'] }, '2026-10-20'),
    [
      { date: '2026-10-23', start: '16:00', end: '17:30', room: '' },
      { date: '2026-10-24', start: '10:00', end: '11:30', room: '' },
      { date: '2026-10-26', start: '12:00', end: '13:30', room: '' },
      { date: '2026-10-26', start: '18:00', end: '19:30', room: '' },
    ])
  assert.deepEqual(availabilitySlots(null, '2026-10-20'), [])
})

test('a slot reads as a day and a time', () => {
  assert.equal(slotLabel(SAT), 'Saturday 24 October · 10:00am – 11:00am')
  assert.equal(slotLabel({ date: '2026-10-27', start: '16:30' }), 'Tuesday 27 October · 4:30pm')
})

test('the tests to sit are the year’s level tests in the enquiry subjects', () => {
  const tests = [
    { id: 'm9', year: 9, subject: 'Maths' }, { id: 'e9', year: 9, subject: 'English' },
    { id: 'm10', year: 10, subject: 'Maths' },
  ]
  assert.deepEqual(matchLevelTests(tests, 'Year 9', ['Maths Advanced']), ['m9'])
  assert.deepEqual(matchLevelTests(tests, '9', ['English', 'Maths']), ['m9', 'e9'])
  assert.deepEqual(matchLevelTests(tests, '11', ['Maths']), [])
})

const invite = { slots: [SAT, TUE] }
const today = '2026-10-20'

test('picking a time books it; picking another moves it; the same one changes nothing', () => {
  assert.deepEqual(planInviteResponse({ invite, choice: { slot: { date: SAT.date, start: '10:00' } }, today }), { action: 'book', slot: SAT })
  const lesson = { lesson_date: SAT.date, start_time: '10:00:00', status: 'scheduled' }
  assert.equal(planInviteResponse({ invite, lesson, choice: { slot: TUE }, today }).action, 'move')
  assert.equal(planInviteResponse({ invite, lesson, choice: { slot: SAT }, today }).action, 'keep')
})

test('a time that was not offered, or has passed, is refused', () => {
  assert.ok(planInviteResponse({ invite, choice: { slot: { date: SAT.date, start: '11:00' } }, today }).error)
  assert.ok(planInviteResponse({ invite, choice: { slot: SAT }, today: '2026-10-25' }).error)
})

test('none suit: their note is recorded, and a booking they had is dropped', () => {
  assert.deepEqual(planInviteResponse({ invite, choice: { none: true, note: 'Weekdays after 4' }, today }), { action: 'note' })
  const lesson = { lesson_date: SAT.date, start_time: '10:00', status: 'scheduled' }
  assert.deepEqual(planInviteResponse({ invite, lesson, choice: { none: true, note: 'Sundays' }, today }), { action: 'cancel' })
  assert.ok(planInviteResponse({ invite, choice: { none: true, note: '  ' }, today }).error)
})

test('a level test that has been marked or has passed cannot be changed from the form', () => {
  const lesson = { lesson_date: SAT.date, start_time: '10:00', status: 'scheduled' }
  assert.ok(planInviteResponse({ invite, lesson, marked: true, choice: { slot: TUE }, today }).error)
  assert.ok(planInviteResponse({ invite, lesson, choice: { none: true, note: 'x' }, today: '2026-10-26' }).error)
})

test('the invitation lists the times, links the form and escapes what staff type', () => {
  const html = buildLevelTestInvitationEmailHtml({ parentName: 'Emiko', studentName: 'Akari' }, [TUE, SAT],
    'https://portal.example/level-test/abc', { personalNote: 'See you <soon>' })
  assert.match(html, /Hi Emiko,/)
  assert.match(html, /Akari/)
  assert.ok(html.indexOf('Saturday 24 October') < html.indexOf('Tuesday 27 October'))
  assert.match(html, /4:30pm – 5:30pm · Room 2/)
  assert.match(html, /href="https:\/\/portal\.example\/level-test\/abc"/)
  assert.match(html, /<strong>90 minutes<\/strong>/)
  assert.match(html, /See you &lt;soon&gt;/)
})

test('the confirmation names the booked time and links back to change it', () => {
  const html = buildLevelTestBookedEmailHtml({ parentName: 'Emiko', studentName: 'Akari', slot: SAT, link: 'https://x/level-test/t' })
  assert.match(html, /Akari’s level test is booked/)
  assert.match(html, /Saturday 24 October/)
  assert.match(html, /Change it here/)
  assert.match(buildLevelTestBookedEmailHtml({ studentName: 'Akari', slot: SAT, moved: true }), /moved Akari’s level test/)
})

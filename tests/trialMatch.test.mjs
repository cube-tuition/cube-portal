/*
 * Matching trial classes to an enquiry — lib/trialInvitationEmail.js
 * matchTrialClasses(). Pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchTrialClasses } from '../lib/trialInvitationEmail.js'

const classes = [
  { id: 1, class_name: 'Y7 Maths', day_of_week: 'Friday', start_time: '16:00', end_time: '17:30' },
  { id: 2, class_name: 'Y8 Maths', day_of_week: 'Friday', start_time: '16:00', end_time: '17:30' },
  { id: 3, class_name: 'Y6 Maths', day_of_week: 'Monday', start_time: '18:00', end_time: '19:30' },
  { id: 4, class_name: 'Y7 English', day_of_week: 'Friday', start_time: '16:00', end_time: '17:30' },
  { id: 5, class_name: 'Y7 Maths 1:1', day_of_week: 'Friday', start_time: '16:00', end_time: '17:30' },
]
const luke = { year: '7', subject: 'Maths', availability: { Friday: ['4:00pm – 6:00pm'] } }

test('by default only the student’s own year, subject matched, 1:1s left out', () => {
  assert.deepEqual(matchTrialClasses(luke, classes).map(c => c.id), [1])
})

test('anyYear lists other years too, flagged, after the student’s own year', () => {
  const r = matchTrialClasses(luke, classes, { anyYear: true })
  assert.deepEqual(r.map(c => [c.id, c.otherYear]), [[1, false], [2, true], [3, true]])
  // The automatic offer (own year, best four) is unchanged by the flag.
  assert.deepEqual(r.filter(c => !c.otherYear).slice(0, 4).map(c => c.id), [1])
})

/*
 * Trial cases waiting on us — lib/trialPipeline.js staleTrials(). Pure.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { staleTrials, trialNudgePush } from '../lib/trialPipeline.js'
import { earliestTrialStart, trialDatesFor } from '../lib/trialDates.js'

const now = new Date('2026-10-14T21:00:00Z')                    // Thu 15 Oct, 8am Sydney
const hoursAgo = (h) => new Date(now.getTime() - h * 3600e3).toISOString()
const sub = (over) => ({ id: 1, student_name: 'Kim Lee', submitted_at: hoursAgo(100), last_activity_at: hoursAgo(100), ...over })
const ids = (r) => r.map(x => [x.id, x.action])

describe('new and contacted', () => {
  test('untouched for 2 days → waiting on us; for less → not yet', () => {
    const r = staleTrials({ now, subs: [
      sub({ id: 1, status: 'new', last_activity_at: hoursAgo(49) }),
      sub({ id: 2, status: 'new', last_activity_at: hoursAgo(47) }),
      sub({ id: 3, status: 'contacted', last_activity_at: hoursAgo(60) }),
    ] })
    assert.deepEqual(ids(r), [[3, 'book the trial'], [1, 'contact the family']])
  })

  test('closed cases are never nudged', () => {
    const r = staleTrials({ now, subs: [sub({ status: 'enrolled' }), sub({ id: 2, status: 'declined' })] })
    assert.deepEqual(r, [])
  })
})

describe('trial scheduled', () => {
  const lessonsByClass = { 7: ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'] }
  const enrol = (start) => [{ student_id: 'kim', class_id: 7, trial_start_date: start }]

  test('a trial still running (a lesson to come) is not due', () => {
    const r = staleTrials({ now, lessonsByClass, trialEnrolments: enrol('2026-10-13'),
      subs: [sub({ status: 'trial_scheduled', converted_student_id: 'kim', last_activity_at: hoursAgo(24 * 10) })] })
    assert.deepEqual(r, [])                                          // trial lessons 13 & 20 Oct
  })

  test('the clock starts when the last trial lesson ends — 2 days later it is due', () => {
    const r = staleTrials({ now, lessonsByClass, trialEnrolments: enrol('2026-10-06'),
      subs: [sub({ status: 'trial_scheduled', converted_student_id: 'kim', last_activity_at: hoursAgo(500) })] })
    // trial lessons 6 & 13 Oct; the 13th ended (23:59 Sydney) ~31h before now → not yet
    assert.deepEqual(r, [])
    const later = staleTrials({ now: new Date('2026-10-15T15:00:00Z'), lessonsByClass, trialEnrolments: enrol('2026-10-06'),
      subs: [sub({ status: 'trial_scheduled', converted_student_id: 'kim', last_activity_at: hoursAgo(500) })] })
    assert.deepEqual(ids(later), [[1, 'follow up — the trial has finished']])
  })

  test('a "scheduled" case with no update in 3 weeks is flagged, even with a trial lesson to come', () => {
    const r = staleTrials({ now, lessonsByClass, trialEnrolments: enrol('2026-10-13'),       // lessons 13 & 20 Oct
      subs: [sub({ status: 'trial_scheduled', converted_student_id: 'kim', last_activity_at: '2026-07-27T00:00:00Z' })] })
    assert.deepEqual(ids(r), [[1, 'check this trial — no update in 11 weeks']])
    const recent = staleTrials({ now, lessonsByClass, trialEnrolments: enrol('2026-10-13'),
      subs: [sub({ status: 'trial_scheduled', converted_student_id: 'kim', last_activity_at: hoursAgo(24 * 20) })] })
    assert.deepEqual(recent, [])
  })

  test('scheduled but no trial class or lessons → waiting to be booked, from the last action', () => {
    const r = staleTrials({ now, subs: [sub({ status: 'trial_scheduled', converted_student_id: 'kim', last_activity_at: hoursAgo(72) })] })
    assert.deepEqual(ids(r), [[1, 'book the trial lessons — no trial class or dates yet']])
  })

  test('an action after the trial ended restarts the clock', () => {
    const r = staleTrials({ now: new Date('2026-10-20T21:00:00Z'), lessonsByClass, trialEnrolments: enrol('2026-10-06'),
      subs: [sub({ status: 'trial_scheduled', converted_student_id: 'kim', last_activity_at: '2026-10-20T01:00:00Z' })] })
    assert.deepEqual(r, [])
  })
})

test('trial completed waits for enrol-or-decline, 2 days after the last action', () => {
  const r = staleTrials({ now, subs: [sub({ status: 'trial_completed', last_activity_at: hoursAgo(50) })] })
  assert.deepEqual(ids(r), [[1, 'enrol or decline']])
})

test('the morning push names the first few, by first name and stage', () => {
  const push = trialNudgePush([
    { student_name: 'Kim Lee', status: 'new' }, { student_name: 'Ana Cho', status: 'trial_scheduled' },
  ], 'trials-x')
  assert.equal(push.title, '📞 2 trials waiting on you for 2+ days')
  assert.equal(push.body, 'Kim (New), Ana (Trial scheduled).')
  assert.equal(push.url, '/tutor/trials')
})

test('a trial defaults to the class’s earliest lesson from today; with none scheduled, today', () => {
  const lessons = ['2026-10-10', '2026-10-17', '2026-10-24']
  assert.equal(earliestTrialStart(lessons, '2026-10-15'), '2026-10-17')
  assert.equal(earliestTrialStart(lessons, '2026-10-17'), '2026-10-17')   // a lesson today still counts
  assert.equal(earliestTrialStart(lessons, '2026-10-25'), '2026-10-25')
  assert.equal(earliestTrialStart([], '2026-10-15'), '2026-10-15')
  // A later first lesson moves both trial lessons along.
  assert.deepEqual(trialDatesFor(lessons, '2026-10-24'), ['2026-10-24'])
  assert.deepEqual(trialDatesFor([...lessons, '2026-10-31'], '2026-10-24'), ['2026-10-24', '2026-10-31'])
})

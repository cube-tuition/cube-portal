/*
 * Trial cases waiting on us — lib/trialPipeline.js staleTrials(). Pure.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { staleTrials, trialNudgePush, heldTrialsDue } from '../lib/trialPipeline.js'
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

  test('a level test still to come → nothing due; once sat, due 2 days later as a level-test follow-up', () => {
    const subs = [sub({ id: 1, status: 'contacted', converted_student_id: 'luke', last_activity_at: hoursAgo(80) })]
    assert.deepEqual(staleTrials({ now, subs, levelTests: { luke: ['2026-10-16'] } }), [])
    assert.deepEqual(staleTrials({ now, subs, levelTests: { luke: ['2026-10-14'] } }), [])           // sat yesterday: not 2 days yet
    assert.deepEqual(ids(staleTrials({ now, subs, levelTests: { luke: ['2026-10-12'] } })),
      [[1, 'follow up the level test — results and a trial']])
  })

  test('a child’s second enquiry is not “uncontacted” once the first has moved on', () => {
    const r = staleTrials({ now, subs: [
      sub({ id: 1, status: 'contacted', converted_student_id: 'luke', last_activity_at: hoursAgo(60) }),   // Maths
      sub({ id: 2, status: 'new', converted_student_id: 'luke', last_activity_at: hoursAgo(70) }),         // English
      sub({ id: 3, status: 'new', converted_student_id: 'mia', last_activity_at: hoursAgo(70) }),
    ] })
    assert.deepEqual(ids(r), [[3, 'contact the family'], [1, 'book the trial']])
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

describe('trial feedback emails', () => {
  // now = Thu 15 Oct, 8am Sydney. Lesson days end 23:59 Sydney.
  const lessonsByClass = { 7: ['2026-10-06', '2026-10-13', '2026-10-20'] }
  const trialEnrolments = [{ student_id: 'kim', class_id: 7, trial_start_date: '2026-10-06' }]
  const base = { status: 'trial_scheduled', converted_student_id: 'kim', last_activity_at: hoursAgo(1) }

  test('lesson 1 marked and its feedback not sent → due 2 days after that lesson', () => {
    const trialLessons = { kim: { 7: ['2026-10-06'] } }
    const r = staleTrials({ now, lessonsByClass, trialEnrolments: [{ ...trialEnrolments[0], trial_start_date: '2026-10-13' }], trialLessons, subs: [sub(base)] })
    assert.deepEqual(ids(r), [[1, 'send the lesson 1 feedback email']])
    // …even though the case was touched an hour ago: the email itself is what's owed.
    const notYet = staleTrials({ now: new Date('2026-10-07T12:00:00Z'), lessonsByClass, trialEnrolments, trialLessons, subs: [sub(base)] })
    assert.deepEqual(notYet, [])
  })

  test('once lesson 1 feedback is sent, nothing is owed until lesson 2 is marked', () => {
    const trialLessons = { kim: { 7: ['2026-10-06'] } }
    const r = staleTrials({ now, lessonsByClass, trialEnrolments: [{ ...trialEnrolments[0], trial_start_date: '2026-10-13' }], trialLessons,
      subs: [sub({ ...base, lesson1_feedback_sent_at: hoursAgo(150) })] })
    assert.deepEqual(r, [])
  })

  test('lesson 2 marked → the outcome email is owed (and replaces an unsent lesson 1 email)', () => {
    const trialLessons = { kim: { 7: ['2026-10-06', '2026-10-13'] } }
    const later = new Date('2026-10-15T15:00:00Z')                   // 2 days after the 13th ended
    assert.deepEqual(ids(staleTrials({ now: later, lessonsByClass, trialEnrolments, trialLessons, subs: [sub(base)] })),
      [[1, 'send the trial outcome email']])
    assert.deepEqual(staleTrials({ now, lessonsByClass, trialEnrolments, trialLessons, subs: [sub(base)] }), [])   // only ~31h
  })

  test('with the outcome sent, the case falls back to the usual follow-up', () => {
    const trialLessons = { kim: { 7: ['2026-10-06', '2026-10-13'] } }
    const later = new Date('2026-10-15T15:00:00Z')
    const r = staleTrials({ now: later, lessonsByClass, trialEnrolments, trialLessons,
      subs: [sub({ ...base, outcome_sent_at: hoursAgo(10), last_activity_at: hoursAgo(500) })] })
    assert.deepEqual(ids(r), [[1, 'follow up — the trial has finished']])
  })

  test('two subjects: lesson 2 in either one makes the outcome due', () => {
    const trialLessons = { kim: { 7: ['2026-10-06', '2026-10-13'], 9: ['2026-10-09'] } }
    const r = staleTrials({ now: new Date('2026-10-15T15:00:00Z'), lessonsByClass, trialEnrolments, trialLessons, subs: [sub(base)] })
    assert.deepEqual(ids(r), [[1, 'send the trial outcome email']])
  })
})

test('a hold is due from its check-back date, never before, and not without one', () => {
  const now = new Date('2026-11-16T09:00:00+11:00')   // Mon 16 Nov, Sydney
  const subs = [
    { id: 1, status: 'on_hold', student_name: 'Noah Hew', hold_until: '2026-11-16', hold_notified_at: null },
    { id: 2, status: 'on_hold', student_name: 'Ava Li', hold_until: '2026-11-17' },
    { id: 3, status: 'on_hold', student_name: 'Ben Ng', hold_until: null },
    { id: 4, status: 'contacted', student_name: 'Cal Wu', hold_until: '2026-11-01' },
    { id: 5, status: 'on_hold', student_name: 'Dee Yu', hold_until: '2026-11-02', hold_notified_at: '2026-11-02T08:00:00Z' },
  ]
  assert.deepEqual(heldTrialsDue(subs, now), [
    { id: 5, student_name: 'Dee Yu', hold_until: '2026-11-02', notified: true },
    { id: 1, student_name: 'Noah Hew', hold_until: '2026-11-16', notified: false },
  ])
  // on hold is not an open case: no stale nudge however long it sits
  assert.deepEqual(staleTrials({ subs: [{ id: 6, status: 'on_hold', student_name: 'X', submitted_at: '2026-01-01T00:00:00Z' }], now }), [])
})

/*
 * A trial card's next step — lib/trialNextStep.js. Pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextStep } from '../lib/trialNextStep.js'

const today = '2026-10-20'
const step = (over) => nextStep({ status: 'new', trial_class_id: null, ...over }, today)
const key = (over) => step(over)?.key ?? null
const wait = (over) => step(over)?.wait ?? null

test('a new enquiry: send the trial invitation (or a level test invitation)', () => {
  assert.equal(key({}), 'first')
})

test('the level test path follows the family and the test', () => {
  const lt = { status: 'contacted', level_test_invitation_sent_at: '2026-10-18T00:00:00Z' }
  assert.match(wait(lt), /pick a level test time/)
  assert.match(wait({ ...lt, _levelTest: { booked: { date: '2026-10-23', start: '16:00' } } }), /Level test booked · Fri 23 Oct/)
  assert.equal(key({ ...lt, _levelTest: { booked: { date: '2026-10-19' } } }), 'lt_results')
  assert.equal(key({ ...lt, _levelTest: { booked: { date: '2026-10-19' }, reportSent: true } }), 'invitation')
  assert.equal(key({ ...lt, _levelTest: { note: 'Sundays only' } }), 'level_test')
})

test('invited but no class yet: assign the trial class', () => {
  assert.equal(key({ status: 'contacted', invitation_sent_at: '2026-10-18T00:00:00Z' }), 'assign')
})

test('a booked trial waits for its lessons, then asks for each email', () => {
  const booked = { status: 'trial_scheduled', trial_class_id: 7, _trialDates: ['2026-10-24', '2026-10-31'] }
  assert.match(wait(booked), /Waiting for trial lesson 1 · Sat 24 Oct — reminder sends automatically/)
  assert.match(wait({ ...booked, _trialDates: ['2026-10-17', '2026-10-24'] }), /was Sat 17 Oct — waiting for the tutor to mark the roll/)
  assert.equal(key({ ...booked, status: 'trial_1_completed' }), 'lesson1')
  assert.match(wait({ ...booked, status: 'trial_1_completed', lesson1_feedback_sent_at: 'x' }), /Waiting for trial lesson 2 · Sat 31 Oct/)
  assert.equal(key({ ...booked, status: 'trial_completed' }), 'outcome')
  assert.equal(key({ ...booked, status: 'trial_completed', outcome_sent_at: 'x' }), 'decide')
})

test('nothing for decided or paused trials', () => {
  for (const status of ['enrolled', 'declined', 'on_hold']) assert.equal(step({ status }), null)
})

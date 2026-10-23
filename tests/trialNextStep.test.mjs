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
  // On the day, the step turns over when the slot ends (5:30), not at midnight.
  const onDay = { status: 'contacted', trial_class_id: null, ...lt, _levelTest: { booked: { date: today, start: '16:00', end: '17:30' } } }
  assert.match(nextStep(onDay, today, '17:15').wait, /Level test booked/)
  assert.equal(nextStep(onDay, today, '17:45').key, 'lt_results')
  assert.ok(nextStep(onDay, today).wait)   // no clock given: the date alone decides, as before
  assert.equal(key({ ...lt, _levelTest: { booked: { date: '2026-10-19' } } }), 'lt_results')
  assert.equal(key({ ...lt, _levelTest: { booked: { date: '2026-10-19' }, reportSent: true } }), 'invitation')
  assert.equal(key({ ...lt, _levelTest: { note: 'Sundays only' } }), 'level_test')
})

test('invited but no class yet: assign the trial class', () => {
  assert.equal(key({ status: 'contacted', invitation_sent_at: '2026-10-18T00:00:00Z' }), 'assign')
})

test('the class picker: a class books itself, a 1:1 time or a note needs staff', () => {
  const inv = { status: 'contacted', invitation_sent_at: '2026-10-18T00:00:00Z' }
  assert.match(wait({ ...inv, _trialInvite: { pick: null, note: '' } }), /pick a class/)
  assert.deepEqual(step({ ...inv, _trialInvite: { pick: { kind: 'slot', date: '2026-10-25', start: '15:00' } } }), { key: 'assign', label: 'Set up 1:1 trial · Sun 25 Oct 15:00' })
  assert.equal(key({ ...inv, _trialInvite: { pick: null, note: 'Mondays after 5' } }), 'invitation')
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

test('the card names one stage, with the action it needs', async () => {
  const { trialStage } = await import('../lib/trialNextStep.js')
  const st = (over) => trialStage({ status: 'new', trial_class_id: null, ...over }, today)
  const lt = { status: 'contacted', level_test_invitation_sent_at: 'x' }
  assert.deepEqual([st({}).label, st({}).action.key], ['New', 'first'])
  assert.deepEqual([st(lt).label, st(lt).action], ['Level test invited', null])
  assert.equal(st({ ...lt, _levelTest: { note: 'Sundays' } }).action.key, 'level_test')
  assert.equal(st({ ...lt, _levelTest: { booked: { date: '2026-10-23' } } }).label, 'Level test booked')
  assert.deepEqual([st({ ...lt, _levelTest: { booked: { date: '2026-10-18' } } }).label, st({ ...lt, _levelTest: { booked: { date: '2026-10-18' } } }).action.key], ['Level test completed', 'lt_results'])
  assert.deepEqual([st({ status: 'contacted', invitation_sent_at: 'x' }).label, st({ status: 'contacted', invitation_sent_at: 'x' }).action], ['Trial invitation sent', null])
  const booked = { status: 'trial_scheduled', trial_class_id: 7, _trialDates: ['2026-10-24', '2026-10-31'] }
  assert.match(st(booked).note, /trial lesson 1 · Sat 24 Oct/)
  assert.deepEqual([st({ ...booked, status: 'trial_1_completed' }).label, st({ ...booked, status: 'trial_1_completed' }).action.label], ['Trial lesson 1/2 completed', '✉ Send feedback'])
  assert.equal(st({ ...booked, status: 'trial_completed' }).action.key, 'outcome')
  assert.deepEqual([st({ ...booked, status: 'trial_completed', outcome_sent_at: 'x' }).label, st({ ...booked, status: 'trial_completed', outcome_sent_at: 'x' }).action.key], ['Awaiting decision', 'decide'])
  assert.equal(st({ status: 'on_hold', hold_until: '2026-11-16' }).note, 'check back Mon 16 Nov')
})

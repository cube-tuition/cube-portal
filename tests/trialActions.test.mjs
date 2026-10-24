/*
 * Trial actionables for the Action Centre — lib/trialActions.js. Pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trialActionables } from '../lib/trialActions.js'

const today = '2026-10-24'
const sub = (over) => ({ status: 'new', trial_class_id: null, subjects: ['Maths'], submitted_at: '2026-10-01', ...over })

test('a new enquiry asks for the first email, once per student', () => {
  const a = trialActionables([
    sub({ id: 1, student_name: 'Mia Chen', parent_email: 'p@x.com' }),
    sub({ id: 2, student_name: 'Mia Chen', parent_email: 'p@x.com', subjects: ['English'], submitted_at: '2026-10-02' }),
  ], today)
  assert.equal(a.length, 1)
  assert.match(a[0].label, /^Mia Chen — /)
  assert.equal(a[0].stage.id, 'new')
})

test('waiting stages have nothing to action; closed and held trials are left out', () => {
  const a = trialActionables([
    sub({ id: 3, student_name: 'Leo', status: 'contacted', invitation_sent_at: 'x', _trialInvite: { pick: null, note: '' } }),
    sub({ id: 4, student_name: 'Ava', status: 'enrolled' }),
    sub({ id: 5, student_name: 'Zoe', status: 'on_hold' }),
  ], today)
  assert.deepEqual(a, [])
})

test('subjects at different trial stages get one item each, named by subject', () => {
  const a = trialActionables([
    sub({ id: 6, converted_student_id: 's1', student_name: 'Noah', status: 'trial_1_completed', trial_class_id: 7, _trialDates: ['2026-10-17', '2026-10-31'] }),
    sub({ id: 7, converted_student_id: 's1', student_name: 'Noah', subjects: ['English'], status: 'trial_completed', trial_class_id: 8, _trialDates: ['2026-10-10', '2026-10-17'], submitted_at: '2026-10-02' }),
  ], today)
  assert.deepEqual(a.map(x => x.label), ['Noah — Maths: ✉ Send feedback', 'Noah — English: ✉ Trial outcome'])
})

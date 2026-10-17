import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MATHS_STAGES, mathsStageOf, mathsStageLabel, groupRowsByName } from '../lib/mathsStages.js'

test('Maths Years 5–10 fall in Stages 3–5; senior courses and other subjects in none', () => {
  assert.equal(mathsStageOf({ name: 'Maths', year_level: 6 }).stage, 3)
  assert.equal(mathsStageOf({ name: 'Maths', year_level: 7 }).stage, 4)
  assert.equal(mathsStageOf({ name: 'Maths', year_level: 10 }).stage, 5)
  assert.equal(mathsStageOf({ name: 'Adv Maths', year_level: 11 }), null)
  assert.equal(mathsStageOf({ name: 'Maths', year_level: 11 }), null)
  assert.equal(mathsStageOf({ name: 'Chemistry', year_level: 9 }), null)
  assert.equal(mathsStageLabel(MATHS_STAGES[0]), 'Stage 3 (Years 5–6)')
})

test('two years’ rows show as one list: same names merge, order follows the lowest sort', () => {
  const year = { a: 7, b: 8 }
  const rows = [
    { id: 1, subject: 'a', name: 'Algebra', sort_order: 1 }, { id: 2, subject: 'b', name: 'algebra ', sort_order: 0 },
    { id: 3, subject: 'a', name: 'Angles', sort_order: 2 }, { id: 4, subject: 'b', name: 'Probability', sort_order: 5 },
  ]
  const g = groupRowsByName(rows, (r) => year[r.subject])
  assert.deepEqual(g.map(x => [x.name, x.rows.map(r => r.id), x.years]), [['Algebra', [1, 2], [7, 8]], ['Angles', [3], [7]], ['Probability', [4], [8]]])
})

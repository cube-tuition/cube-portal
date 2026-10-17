import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignLanes, peakConcurrent, toMinutes } from '../lib/dayLanes.js'
import { teacherColour, paletteStaff, GREY_CHIP, CHIP_COLORS, COLOR_OVERRIDES } from '../lib/teacherColours.js'

const ev = (id, s, e) => ({ id, s, e })
const lanes = (evs) => Object.fromEntries(assignLanes(evs).map(x => [x.id, [x._lane, x._lanes]]))

test('sessions that do not overlap each take the full width', () => {
  assert.deepEqual(lanes([ev('a', 900, 960), ev('b', 960, 1020)]), { a: [0, 1], b: [0, 1] })
})

test('overlapping sessions sit side by side; a later lone session is full width again', () => {
  const out = lanes([ev('a', 960, 1080), ev('b', 990, 1050), ev('c', 1020, 1080), ev('d', 1140, 1200)])
  assert.deepEqual(out, { a: [0, 3], b: [1, 3], c: [2, 3], d: [0, 1] })
})

test('a freed lane is reused within the same cluster', () => {
  const out = lanes([ev('a', 900, 1080), ev('b', 900, 960), ev('c', 960, 1020)])
  assert.deepEqual(out, { b: [0, 2], a: [1, 2], c: [0, 2] })   // b ends first, so c reuses its lane
})

test('events come back sorted by start time', () => {
  assert.deepEqual(assignLanes([ev('late', 1100, 1150), ev('early', 900, 950)]).map(x => x.id), ['early', 'late'])
})

test('peak counts sessions running at once; back-to-back is not an overlap', () => {
  assert.deepEqual(peakConcurrent([ev('a', 960, 1020), ev('b', 1020, 1080)]), { count: 1, at: 960 })
  assert.deepEqual(peakConcurrent([ev('a', 960, 1080), ev('b', 990, 1050), ev('c', 1000, 1100)]), { count: 3, at: 1000 })
  assert.deepEqual(peakConcurrent([]), { count: 0, at: null })
})

test('stored times read as minutes; a bare 1–7 o’clock is the afternoon', () => {
  assert.equal(toMinutes('16:00:00'), 960)
  assert.equal(toMinutes('09:30'), 570)
  assert.equal(toMinutes('4:30'), 990)
  assert.equal(toMinutes('4:30 pm'), 990)
  assert.equal(toMinutes('12:00 am'), 0)
  assert.equal(toMinutes(''), null)
  assert.equal(toMinutes('TBC'), null)
})

test('teacher colours follow palette position, with fixed overrides and grey for unknowns', () => {
  const palette = paletteStaff(
    [{ id: 't1', full_name: 'Amber Kim' }, { id: 'tx', full_name: 'Old Tutor', active: false }, { id: 't2', full_name: 'David Lee' }],
    [{ id: 'd1', full_name: 'Ryan Park' }],
  )
  assert.deepEqual(palette.map(p => p.id), ['t1', 't2', 'd1'])
  assert.equal(teacherColour('t1', palette), CHIP_COLORS[0])
  assert.equal(teacherColour('t2', palette), CHIP_COLORS[1])
  assert.equal(teacherColour('d1', palette), COLOR_OVERRIDES['ryan park'])
  assert.equal(teacherColour('tx', palette), GREY_CHIP)
  assert.equal(teacherColour(null, palette), GREY_CHIP)
})

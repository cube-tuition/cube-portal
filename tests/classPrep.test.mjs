/*
 * Class prep — lib/classPrep.js. Pure parts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPrepRows, groupPrep, prepNudges, prepWindow, dayLabel, bookletDueNudges, lessonStartUtc } from '../lib/classPrep.js'

const classes = [
  { id: 1, class_name: 'Y9 Maths', start_time: '16:30', materials_owner: 'Ryan', term_id: 't4' },
  { id: 2, class_name: 'Y10 English', start_time: '18:00', materials_owner: 'Aiden', term_id: 't4' },
  { id: 3, class_name: 'Y6 Maths 1:1', start_time: '10:00', materials_owner: null, term_id: 't4' },
]
const lessons = [
  { id: 10, class_id: 1, lesson_date: '2026-10-23', start_time: '16:30', week: 2, status: 'scheduled' },
  { id: 11, class_id: 2, lesson_date: '2026-10-23', start_time: '18:00', week: 2, status: 'scheduled' },
  { id: 12, class_id: 3, lesson_date: '2026-10-24', start_time: '10:00', week: 2, status: 'scheduled' },
  { id: 13, class_id: 1, lesson_date: '2026-10-24', week: 2, status: 'cancelled' },
  { id: 14, class_id: 1, lesson_date: '2026-10-24', week: 2, status: 'scheduled', is_makeup: true },
  { id: 15, class_id: 1, lesson_date: '2026-10-24', week: 2, status: 'scheduled', lesson_type: 'level_test' },
]
const rows = buildPrepRows({
  lessons, classes, termNumberById: { t4: 4 },
  assignments: [{ class_id: 1, term_number: 4, week: 2, booklet_id: 'b1' }, { class_id: 2, term_number: 4, week: 2, booklet_id: 'b2' }],
  booklets: [{ id: 'b1', file_paths: ['x.pdf'] }, { id: 'b2', file_paths: [] }],
  students: { 3: ['Monica Lee'] },
  preps: [{ lesson_id: 11, prepared_by_name: 'Aiden', prepared_at: 'x', printed_by_name: 'Aiden', printed_at: 'y' },
          { lesson_id: 10, printed_by_name: 'Ryan', printed_at: 'z' }],
})

test('one row per real lesson: no cancelled, makeup or level test lessons', () => {
  assert.deepEqual(rows.map(r => r.lessonId), [10, 11, 12])
})

test('prepared is automatic: a booklet allocated for the week (published or not)', () => {
  assert.deepEqual(rows.map(r => r.booklet), ['ready', 'unpublished', 'none'])
  assert.deepEqual(rows.map(r => r.allocated), [true, true, false])
})

test('a 1:1 is named by its student; printed lessons carry who ticked them', () => {
  assert.equal(rows[2].label, 'Y6 Maths 1:1 · Monica')
  assert.equal(rows[1].printed.by, 'Aiden')
  assert.equal(rows[0].printed.by, 'Ryan')
  assert.equal(rows[2].printed, null)
})

test('grouped by materials owner, unassigned kept separately', () => {
  const g = groupPrep(rows)
  assert.deepEqual([g.Ryan.length, g.Aiden.length, g.Unassigned.length], [1, 1, 1])
})

test('the window rolls: today to six days ahead', () => {
  assert.deepEqual(prepWindow('2026-10-24'), ['2026-10-24', '2026-10-30'])
  assert.equal(dayLabel('2026-10-25', '2026-10-24'), 'Tomorrow')
})

test('the nudge: tomorrow’s lessons missing a booklet or printing; unassigned to both', () => {
  assert.deepEqual(prepNudges(rows, '2026-10-23'), [])   // both have a booklet allocated and are printed
  const n = Object.fromEntries(prepNudges(rows, '2026-10-24').map(x => [x.owner, x.push]))
  assert.match(n.Ryan.body, /Y6 Maths 1:1 · Monica · 10:00am — no booklet allocated, not printed/)
  const sat = prepNudges(rows, '2026-10-24').map(x => x.owner).sort()
  assert.deepEqual(sat, ['Aiden', 'Ryan'])              // the unassigned 1:1 goes to both
})

test('a lesson starts at its Sydney time: 4:30pm on 23 Oct 2026 (AEDT) is 05:30 UTC', () => {
  assert.equal(lessonStartUtc('2026-10-23', '16:30').toISOString(), '2026-10-23T05:30:00.000Z')
  assert.equal(lessonStartUtc('2026-06-10', '09:00').toISOString(), '2026-06-09T23:00:00.000Z')   // AEST
})

test('24 hours before a lesson, an unpublished or missing booklet nudges its owner once', () => {
  // Rows: lesson 10 (Y9 Maths, Ryan, booklet ready), 11 (Y10 English, Aiden, allocated but unpublished), 12 (1:1, unassigned, none).
  const at = (iso) => new Date(iso)
  // 23 Oct 2026, 6pm Sydney lesson (11) = 07:00Z. 25 hours before → nothing; 23 hours before → due.
  assert.deepEqual(bookletDueNudges(rows, { now: at('2026-10-22T06:00:00Z') }), [])
  const due = bookletDueNudges(rows, { now: at('2026-10-22T08:00:00Z') })
  assert.deepEqual(due.map(n => [n.key, n.owners]), [['booklet:11', ['Aiden']]])
  assert.match(due[0].push.body, /allocated but its PDFs aren’t published/)
  assert.equal(due[0].push.url, '/tutor/classes/2')
  // Lesson 10's booklet is published: never nudged. Lesson 12 (24 Oct 10am = 23:00Z on the 23rd) is unassigned → both directors.
  const later = bookletDueNudges(rows, { now: at('2026-10-23T00:00:00Z') })
  assert.deepEqual(later.map(n => [n.key, n.owners]), [['booklet:11', ['Aiden']], ['booklet:12', ['Ryan', 'Aiden']]])
  assert.match(later[1].push.body, /no booklet allocated/)
  // Already claimed → not again; a lesson that has started → not at all.
  assert.deepEqual(bookletDueNudges(rows, { now: at('2026-10-23T00:00:00Z'), sentKeys: new Set(['booklet:11', 'booklet:12']) }), [])
  assert.deepEqual(bookletDueNudges(rows, { now: at('2026-10-24T12:00:00Z') }), [])
})

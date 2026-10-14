/*
 * The practice stream's rules — lib/practice.js. Pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestRatings, streamOf, shuffleOrder, tabOf, tabCounts } from '../lib/practice.js'

const q = (id) => ({ id })
const rows = [
  { question_id: 'a', rating: 'hard',      rated_at: '2026-10-10T10:00:00Z' },
  { question_id: 'a', rating: 'easy',      rated_at: '2026-10-14T10:00:00Z' },   // re-rated: now Easy
  { question_id: 'b', rating: 'very_hard', rated_at: '2026-10-12T10:00:00Z' },
  { question_id: 'c', rating: 'hard',      rated_at: '2026-10-13T10:00:00Z' },
]

test('a question sits under its latest rating; every rating counts as a time done', () => {
  const l = latestRatings(rows)
  assert.deepEqual(l.a, { rating: 'easy', ratedAt: '2026-10-14T10:00:00Z', times: 2 })
  assert.equal(l.b.rating, 'very_hard')
})

test('latest wins whatever order the rows arrive in', () => {
  assert.equal(latestRatings([...rows].reverse()).a.rating, 'easy')
})

test('the stream holds only unrated questions, in the fixed shuffle order', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map(q)
  const order = { f: 0, d: 1, a: 2, e: 3 }
  assert.deepEqual(streamOf(pool, order, latestRatings(rows)).map(x => x.id), ['f', 'd', 'e'])
})

test('rating a question removes it without reshuffling the rest', () => {
  const pool = ['d', 'e', 'f'].map(q)
  const order = shuffleOrder(['d', 'e', 'f'])
  const before = streamOf(pool, order, {}).map(x => x.id)
  const after = streamOf(pool, order, { [before[0]]: { rating: 'hard' } }).map(x => x.id)
  assert.deepEqual(after, before.slice(1))
})

test('the shuffle covers every question exactly once', () => {
  const ids = Array.from({ length: 50 }, (_, i) => `q${i}`)
  const order = shuffleOrder(ids)
  assert.deepEqual(Object.values(order).sort((x, y) => x - y), ids.map((_, i) => i))
})

test('a tab lists its questions, most recently rated first; counts per tab', () => {
  const qs = ['a', 'b', 'c', 'd'].map(q)
  const l = latestRatings([...rows, { question_id: 'd', rating: 'hard', rated_at: '2026-10-14T09:00:00Z' }])
  assert.deepEqual(tabOf(qs, l, 'hard').map(x => x.id), ['d', 'c'])
  assert.deepEqual(tabOf(qs, l, 'easy').map(x => x.id), ['a'])
  assert.deepEqual(tabCounts(qs, l), { easy: 1, medium: 0, hard: 2, very_hard: 1 })
})

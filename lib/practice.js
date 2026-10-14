/*
 * Practice stream (Resources) — the rules, pure.
 *
 * A student picks a subject and filters; unrated questions stream in a random,
 * mixed order. Rating a question (Easy · Medium · Hard · Very hard) takes it
 * out of the stream and files it under that tab; rating it again from a tab
 * moves it. Every rating is kept (practice_ratings); a question sits under its
 * LATEST rating. Private to the student.
 */

export const RATINGS = [
  { id: 'easy',      label: 'Easy' },
  { id: 'medium',    label: 'Medium' },
  { id: 'hard',      label: 'Hard' },
  { id: 'very_hard', label: 'Very hard' },
]
export const RATING_LABEL = Object.fromEntries(RATINGS.map(r => [r.id, r.label]))

/*
 * practice_ratings rows (any order) → { questionId: { rating, ratedAt, times } }
 * — where each question sits now (its latest rating) and how often it's been done.
 */
export function latestRatings(rows = []) {
  const out = {}
  for (const r of rows) {
    const cur = out[r.question_id]
    if (!cur) { out[r.question_id] = { rating: r.rating, ratedAt: r.rated_at, times: 1 }; continue }
    cur.times++
    if (r.rated_at > cur.ratedAt) { cur.rating = r.rating; cur.ratedAt = r.rated_at }
  }
  return out
}

/*
 * The stream: questions matching the filters that have never been rated, in
 * the given order (a shuffle fixed when the filters change, so rating one
 * question doesn't reshuffle the rest).
 *   pool     matching questions
 *   order    { questionId: position } — the shuffle
 *   latest   latestRatings()
 */
export function streamOf(pool, order, latest) {
  return pool
    .filter(q => !latest[q.id])
    .sort((a, b) => (order[a.id] ?? Infinity) - (order[b.id] ?? Infinity))
}

// A random position for each question (Fisher–Yates over the ids).
export function shuffleOrder(ids, rand = Math.random) {
  const a = [...ids]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return Object.fromEntries(a.map((id, i) => [id, i]))
}

/*
 * One difficulty tab: the questions (from `questions`, e.g. the subject's)
 * whose latest rating is `rating`, most recently rated first.
 */
export function tabOf(questions, latest, rating) {
  return questions
    .filter(q => latest[q.id]?.rating === rating)
    .sort((a, b) => String(latest[b.id].ratedAt).localeCompare(String(latest[a.id].ratedAt)))
}

// { easy: n, medium: n, hard: n, very_hard: n } for the given questions.
export function tabCounts(questions, latest) {
  const out = Object.fromEntries(RATINGS.map(r => [r.id, 0]))
  for (const q of questions) { const r = latest[q.id]?.rating; if (r in out) out[r]++ }
  return out
}

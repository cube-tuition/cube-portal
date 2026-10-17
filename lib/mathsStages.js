/*
 * lib/mathsStages.js — Maths topic stages (NSW): the two years of a stage share ONE topic list.
 * Each year keeps its own topic rows — a question keeps its year, so students
 * still see only their own year's practice questions — but both hold the same
 * names in the same order, and the Topics page edits them together
 * (scripts/maths-stage-topics.mjs lined them up). Not the skills grouping
 * above, which is primary vs high school.
 */
export const MATHS_STAGES = [
  { stage: 3, years: [5, 6] },
  { stage: 4, years: [7, 8] },
  { stage: 5, years: [9, 10] },
]
export const mathsStageOf = (subject) => (subject?.name === 'Maths'
  ? MATHS_STAGES.find((st) => st.years.includes(Number(subject.year_level))) || null
  : null)
export const mathsStageLabel = (st) => `Stage ${st.stage} (Years ${st.years[0]}–${st.years[st.years.length - 1]})`

/*
 * Several years' rows (topics or subtopics) shown as one list: rows with the
 * same name (case-insensitive) are one item. Ordered by the lowest sort_order
 * among them, then name.  → [{ key, name, rows, years, sort_order }]
 */
export function groupRowsByName(rows = [], yearOf = () => null) {
  const byKey = new Map()
  for (const r of rows) {
    const key = String(r.name || '').trim().toLowerCase()
    const g = byKey.get(key) || { key, name: r.name, rows: [], years: [], sort_order: Infinity }
    g.rows.push(r)
    const y = yearOf(r)
    if (y != null && !g.years.includes(y)) g.years.push(y)
    g.sort_order = Math.min(g.sort_order, r.sort_order ?? 0)
    byKey.set(key, g)
  }
  return [...byKey.values()]
    .map((g) => ({ ...g, years: g.years.sort((a, b) => a - b) }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}

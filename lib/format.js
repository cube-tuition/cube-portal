/**
 * Normalize a day-of-week value coming from the DB.
 *
 * Accepts:
 *   - "Monday"           → "Monday"
 *   - "[\"Monday\"]"     → "Monday"   (string that looks like a JSON array)
 *   - ["Monday"]         → "Monday"   (real JS array, e.g. from text[]/jsonb)
 *   - ["Monday","Wed"]   → "Monday"   (first item)
 *   - null / undefined   → ""
 */
export function normalizeDay(value) {
  const days = normalizeDays(value)
  return days[0] || ''
}

/**
 * Same as normalizeDay but returns EVERY day a class runs on.
 *
 * A class with `day_of_week = "[\"Tuesday\",\"Thursday\"]"` runs twice a week,
 * and the tutor classes view needs to render it on both days. normalizeDay()
 * silently drops the second day, so use normalizeDays() any time you care
 * about full coverage.
 *
 * Returns an array of trimmed day strings, e.g. ["Tuesday", "Thursday"].
 * Always returns an array — empty if there's nothing to parse.
 */
export function normalizeDays(value) {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean)
  }
  if (typeof value !== 'string') {
    const s = String(value).trim()
    return s ? [s] : []
  }

  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v).trim()).filter(Boolean)
      }
    } catch {
      // Not valid JSON — strip brackets/quotes manually
    }
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(s => s.replace(/['"]/g, '').trim())
      .filter(Boolean)
  }
  return [trimmed]
}

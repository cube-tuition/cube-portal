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
  if (value == null) return ''
  if (Array.isArray(value)) return value[0] ? String(value[0]).trim() : ''
  if (typeof value !== 'string') return String(value)

  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed[0] ? String(parsed[0]).trim() : ''
    } catch {
      // Not valid JSON — strip brackets/quotes manually
    }
    return trimmed
      .slice(1, -1)
      .split(',')[0]
      .replace(/['"]/g, '')
      .trim()
  }
  return trimmed
}

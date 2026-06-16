/**
 * Single source of truth for "is this a 1:1 class or a group class?".
 *
 * The robust signal is courses.delivery_mode ('1:1' | 'Class'), which classes
 * inherit via course_id. For any class whose course isn't tagged yet (or that
 * has no course_id), we fall back to matching the class name — the old
 * heuristic — so nothing silently breaks during the transition.
 */

const ONE_TO_ONE_NAME_RE = /\b1:1\b|1-on-1|one[ .-]?on[ .-]?one/i

/** Name-only heuristic (fallback). */
export function isOneToOneByName(name) {
  return ONE_TO_ONE_NAME_RE.test(name || '')
}

/**
 * Robust check for a single class.
 * @param cls                  a class row (needs course_id and/or class_name)
 * @param deliveryModeByCourse map of course_id -> '1:1' | 'Class' (optional)
 */
export function isOneToOneClass(cls, deliveryModeByCourse) {
  const mode = deliveryModeByCourse?.[cls?.course_id]
  if (mode === '1:1') return true
  if (mode === 'Class') return false
  return isOneToOneByName(cls?.class_name)   // course not tagged → fall back to name
}

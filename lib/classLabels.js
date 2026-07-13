/**
 * buildClassLabelMap
 * ──────────────────
 * Given an array of class objects ({ id, class_name }),
 * returns a Map<id, labelledName>.
 *
 * Rules:
 *   - Classes are siblings if they share the same normalised class_name
 *     (which always equals the course name — set on creation, never changed)
 *     AND the same term (classes are per-term rows — the rollover copies each
 *     class into every new term, and those copies are the SAME class, not
 *     parallel groups; without term scoping "Y6 English" would letter up to
 *     E just from existing across five terms).
 *   - Only one class for a course in a term → no letter appended.
 *   - Two or more → append " A", " B", " C" … ordered by id (stable).
 *
 * Requires only id + class_name; pass term_id too whenever the input can
 * span terms, so lettering stays within each term.
 */
export function buildClassLabelMap(classes) {
  if (!classes || classes.length === 0) return new Map()

  // Group by term + normalised class_name
  const groups = new Map()
  for (const c of classes) {
    const key = `${c.term_id ?? ''}|${c.class_name?.trim().toLowerCase() ?? String(c.id)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }

  const labelMap = new Map()
  for (const group of groups.values()) {
    if (group.length === 1) {
      labelMap.set(group[0].id, group[0].class_name ?? '')
    } else {
      // Sort by id (string comparison) for a stable, consistent ordering
      const sorted = [...group].sort((a, b) => String(a.id).localeCompare(String(b.id)))
      sorted.forEach((c, i) => {
        labelMap.set(c.id, `${c.class_name ?? ''} ${String.fromCharCode(65 + i)}`)
      })
    }
  }
  return labelMap
}

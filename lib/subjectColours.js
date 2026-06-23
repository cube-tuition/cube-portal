/*
 * Subject → pill colour. Shared by the weekly calendar and the full month view
 * so a class is the same colour everywhere. Matched by substring of the class
 * name (longest key first), falling back to the CUBE blue.
 */
export const SUBJECT_COLOR = {
  Maths:     { bg: '#DEE7FF', fg: '#062E63' },
  Math:      { bg: '#DEE7FF', fg: '#062E63' },
  English:   { bg: '#FCE7F3', fg: '#9D174D' },
  EALD:      { bg: '#FCE7F3', fg: '#9D174D' },
  SpeakDev:  { bg: '#EDE9FE', fg: '#5B21B6' },
  Chemistry: { bg: '#D1FAE5', fg: '#065F46' },
  Chem:      { bg: '#D1FAE5', fg: '#065F46' },
  Physics:   { bg: '#E0E7FF', fg: '#3730A3' },
  Biology:   { bg: '#D1FAE5', fg: '#065F46' },
  Economics: { bg: '#FEF3C7', fg: '#92400E' },
  Econ:      { bg: '#FEF3C7', fg: '#92400E' },
  Science:   { bg: '#D1FAE5', fg: '#065F46' },
}

export function pickSubjectColor(name = '') {
  const lower = (name || '').toLowerCase()
  const keys = Object.keys(SUBJECT_COLOR).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    if (lower.includes(k.toLowerCase())) return SUBJECT_COLOR[k]
  }
  return { bg: '#DEE7FF', fg: '#062E63' }
}

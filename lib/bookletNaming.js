// Booklet PDF naming — student/teacher copies read "<year>.<code><role>. <title>",
// e.g. "5.MS. Algebra 1" (student) and "5.MT. Algebra 1" (teacher).
//
// <code> is a short subject code (below); <role> is S (student) or T (teacher).
// The Maths variants get distinct codes so Advanced / Extension booklets are
// distinguishable at a glance: Adv → MA, Ext 1 → M1, Ext 2 → M2.

const SUBJECT_CODE = {
  'Maths':          'M',
  'Standard Maths': 'M',
  'Adv Maths':      'MA',
  'Ext 1 Maths':    'M1',
  'Ext 2 Maths':    'M2',
  'English':        'E',
  'Chemistry':      'C',
}

// Short subject code; unknown subjects fall back to their first letter.
export function subjectCode(subject) {
  const s = (subject || '').trim()
  return SUBJECT_CODE[s] || s[0]?.toUpperCase() || ''
}

// Full PDF display name for one copy of a booklet. role = 'S' | 'T'.
// Falls back to the plain title when year/subject aren't known.
export function bookletPdfName({ year, subject, title }, role) {
  const code = subjectCode(subject)
  return year && code ? `${year}.${code}${role}. ${title}` : (title || '')
}

/*
 * Subject resource hubs — the shared config behind
 *   /tutor/resources/[subject]            (the hub)
 *   /tutor/resources/[subject]/materials  (the Materials sub-hub)
 *
 * Both pages read the palette and the area lists from here so a subject's
 * colours, and which areas sit at the top level versus inside Materials, are
 * defined once.
 */

export const SUBJECTS = {
  maths: {
    label: 'Mathematics',
    value: 'Maths',
    icon: '📐',
    blurb: 'Everything for Maths classes — curriculum, questions, materials, exams and the syllabus.',
    accent: '#325099',
    tint: '#EEF4FF',
    border: '#DEE7FF',
  },
  english: {
    label: 'English',
    value: 'English',
    icon: '📕',
    blurb: 'Everything for English classes — curriculum, questions, materials, exams and reading materials.',
    accent: '#6D4FA3',
    tint: '#F4EFFC',
    border: '#E2D8F3',
  },
  chemistry: {
    label: 'Chemistry',
    value: 'Chemistry',
    icon: '⚗️',
    blurb: 'Everything for Chemistry classes — curriculum, questions, materials, exams and the syllabus.',
    accent: '#0E7A5F',
    tint: '#ECF9F4',
    border: '#CBEBDF',
  },
}

export const subjectConfig = (slug) => SUBJECTS[String(slug || '').toLowerCase()] || null

/*
 * Year / course tabs on a Materials page.
 *
 * Junior years are one course per year, so the year alone identifies them. The
 * senior years split into streams, which the data already models as separate
 * SUBJECTS at the same year — booklets carry subject "Ext 1 Maths" at year 11,
 * and the question bank has Adv / Ext 1 / Ext 2 / Standard Maths. So a tab is a
 * (year, subject) pair, not just a year, and both target pages are scoped with
 * the two together.
 *
 * Subjects absent from here simply get no tab strip.
 */
export const COURSE_TABS = {
  maths: [
    { key: '5',       label: 'Year 5',            year: 5,  subject: 'Maths' },
    { key: '6',       label: 'Year 6',            year: 6,  subject: 'Maths' },
    { key: '7',       label: 'Year 7',            year: 7,  subject: 'Maths' },
    { key: '8',       label: 'Year 8',            year: 8,  subject: 'Maths' },
    { key: '9',       label: 'Year 9',            year: 9,  subject: 'Maths' },
    { key: '10',      label: 'Year 10',           year: 10, subject: 'Maths' },
    { key: '11-adv',  label: 'Year 11 Advanced',  year: 11, subject: 'Adv Maths' },
    { key: '11-ext1', label: 'Year 11 Ext 1',     year: 11, subject: 'Ext 1 Maths' },
    { key: '11-std',  label: 'Year 11 Standard',  year: 11, subject: 'Standard Maths' },
    { key: '12-adv',  label: 'Year 12 Advanced',  year: 12, subject: 'Adv Maths' },
    { key: '12-ext1', label: 'Year 12 Ext 1',     year: 12, subject: 'Ext 1 Maths' },
    { key: '12-ext2', label: 'Year 12 Ext 2',     year: 12, subject: 'Ext 2 Maths' },
    { key: '12-std',  label: 'Year 12 Standard',  year: 12, subject: 'Standard Maths' },
  ],
}

export const courseTabs = (slug) => COURSE_TABS[String(slug || '').toLowerCase()] || []

/*
 * What a class is actually handed: the workbooks students write in, and the
 * extra question sets that go with them. These used to sit on the hub beside
 * Curriculum and Exams; they now live one level down, under Materials.
 *
 * `tab` is an entry from COURSE_TABS, or null for "all years".
 */
export const MATERIAL_AREAS = (subjectValue, tab = null) => {
  const scope = tab ? `&year=${tab.year}&subj=${encodeURIComponent(tab.subject)}` : ''
  return [
    { label: 'Workbooks', icon: '📓',
      href: `/tutor/booklets/master?subject=${subjectValue}${scope}`,
      desc: 'The master workbook database and the workbook builder.' },
    { label: 'Additional Questions', icon: '📝',
      href: `/tutor/qbank/worksheets?subject=${subjectValue}${scope}`,
      desc: 'Saved worksheets assembled from the question bank.' },
  ]
}

/** The cards on a subject's hub page. `slug` is the URL segment, e.g. "maths". */
export const AREAS = (subjectValue, slug) => [
  { label: 'Curriculum', icon: '📖', href: `/tutor/booklets?subject=${subjectValue}`,
    desc: 'Weekly curriculum grid — what each class covers, week by week.' },
  { label: 'Questions', icon: '❓', href: `/tutor/qbank?subject=${subjectValue}`,
    desc: 'The question bank — browse, add and organise questions.' },
  { label: 'Materials', icon: '🗂️', href: `/tutor/resources/${slug}/materials`,
    desc: 'Workbooks and additional questions — what a class is handed.' },
  { label: 'Exams', icon: '🧪', href: `/tutor/resources/tests?subject=${subjectValue}`,
    desc: 'Pre-tests and level tests — build, publish and mark.' },
  { label: 'Syllabus', icon: '📚', href: `/tutor/resources/syllabus?subject=${subjectValue}`,
    desc: 'Textbook chapters and dotpoints, with booklet coverage.' },
  // English keeps a library of reusable reading passages for comprehension work.
  ...(subjectValue === 'English' ? [
    { label: 'Texts / Stimuli', icon: '❝', href: '/tutor/resources/texts',
      desc: 'Reusable passages — poems, extracts, articles — ready to drop into a workbook’s Stimulus block.' },
  ] : []),
]

/*
 * Booklet status palette, shared by the Materials pages that list workbooks
 * (a year's unfiled workbooks, and the workbooks under a topic).
 */
export const BOOKLET_STATUS = {
  'Complete':          { bg: '#ECFDF5', fg: '#047857', bd: '#A7F3D0' },
  'In Progress':       { bg: '#EFF6FF', fg: '#1D4ED8', bd: '#BFDBFE' },
  'Needs Improvement': { bg: '#FEF3C7', fg: '#92400E', bd: '#FDE68A' },
  'Not Started':       { bg: '#F5F5F5', fg: '#6B7280', bd: '#E5E7EB' },
}
export const statusStyle = (s) => BOOKLET_STATUS[s] || BOOKLET_STATUS['Not Started']

/*
 * PDFs attached to a booklet, for the workbook rows on the Materials pages.
 *
 * `file_paths` is the current shape; `file_path` is the legacy single. Which
 * file is the solutions copy is decided by the same rule the student workbook
 * viewer uses (app/workbook/view/[bookletId]) — keep the two in step.
 *
 * Returns [{ path, label, isSolutions }]; the caller turns a path into a URL
 * with supabase.storage.from('booklets').getPublicUrl(path).
 */
const IS_SOLUTIONS = /_solutions|_teacher|\.mt\./i

export function bookletPdfs(b) {
  const paths = b?.file_paths?.length ? b.file_paths : (b?.file_path ? [b.file_path] : [])
  const flags = paths.map((path, i) =>
    IS_SOLUTIONS.test(path || '') || IS_SOLUTIONS.test(b?.pdf_filenames?.[i] || ''))
  // Only name the copies when one of them is actually identifiable as the
  // solutions. Some workbooks carry two files with opaque generated names, and
  // calling both "Student" would assert something untrue — number those.
  const named = flags.some(Boolean)
  return paths.map((path, i) => ({
    path,
    isSolutions: flags[i],
    label: paths.length === 1 ? 'PDF'
      : named ? (flags[i] ? 'Solutions' : 'Student')
      : `PDF ${i + 1}`,
  }))
}

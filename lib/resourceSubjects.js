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
 * What a class is actually handed: the workbooks students write in, and the
 * extra question sets that go with them. These used to sit on the hub beside
 * Curriculum and Exams; they now live one level down, under Materials.
 */
export const MATERIAL_AREAS = (subjectValue) => [
  { label: 'Workbooks', icon: '📓', href: `/tutor/booklets/master?subject=${subjectValue}`,
    desc: 'The master workbook database and the workbook builder.' },
  { label: 'Additional Questions', icon: '📝', href: `/tutor/qbank/worksheets?subject=${subjectValue}`,
    desc: 'Saved worksheets assembled from the question bank.' },
]

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

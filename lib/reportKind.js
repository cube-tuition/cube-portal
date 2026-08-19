/*
 * Report kinds — mid-term and end-of-term.
 *
 * One definition drives the URL slug, the labels, which weeks the charts cover
 * and which sections appear, so the landing page, the printable bundle and the
 * comment editor can never disagree about what a mid-term report is.
 *
 * `key` is what goes in term_comments.kind / term_criteria.kind; `slug` is what
 * appears in the URL (/tutor/reports/<slug>/…).
 */

export const REPORT_KINDS = [
  {
    key: 'mid_term',
    slug: 'mid-term',
    label: 'Mid-term',
    title: 'Mid-term PDFs',
    icon: '📗',
    // A 10-week term, halved. Fixed rather than "up to today" so every class's
    // mid-term report covers the same stretch of the term.
    lastWeek: 5,
    // The exam and the pre/post test both happen at the end of term — on a
    // mid-term report those sections would only ever be blank.
    showExam: false,
    showPrePost: false,
    blurb: 'A progress snapshot covering weeks 1–5: attendance, homework, the RQ chart and the teacher’s mid-term comment.',
    commentPlaceholder: 'How is this student going so far? Comment on each criterion, and on what to work on in the second half of term…',
    commentHint: 'One per student. Surfaces on the mid-term report PDF sent to parents.',
  },
  {
    key: 'end_of_term',
    slug: 'end-of-term',
    label: 'End-of-term',
    title: 'End-of-term PDFs',
    icon: '📘',
    lastWeek: null,          // the whole term
    showExam: true,
    showPrePost: true,
    blurb: 'The full term: attendance, homework, the RQ chart, exam analysis, pre/post test and the teacher’s term comment.',
    commentPlaceholder: 'How did this student go this term? Please comment on each of the student criteria and elaborate on strengths, areas to work on, parent guidance…',
    commentHint: 'One per student. Surfaces on the end-of-term report PDF sent to parents.',
  },
]

export const DEFAULT_KIND = 'end_of_term'

export const kindBySlug = (slug) => REPORT_KINDS.find(k => k.slug === slug) || null
export const kindByKey = (key) => REPORT_KINDS.find(k => k.key === key)
  || REPORT_KINDS.find(k => k.key === DEFAULT_KIND)

/** Does this week fall inside the report's window? Weeks past the cut-off are
 *  dropped from the charts so a mid-term report never shows later data. */
export const weekInKind = (week, kind) =>
  !kind?.lastWeek || (Number(week) > 0 && Number(week) <= kind.lastWeek)

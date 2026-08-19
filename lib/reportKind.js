/*
 * Report kinds — mid-term and end-of-term.
 *
 * One definition drives the URL slug, the labels, which weeks the charts cover
 * and which sections appear, so the landing page, the printable bundle and the
 * comment editor can never disagree about what a mid-term report is.
 *
 * `key` is what goes in term_comments.kind / term_criteria.kind; `slug` is what
 * appears in the URL (/tutor/reports/<slug>/…).
 *
 * The email fields live here too, so the emailing page, the send route and the
 * storage layout can't disagree about which report is being sent.
 */

// PDFs live in one bucket. End-of-term keeps the original flat layout so every
// report already uploaded stays exactly where it was; mid-term gets a subfolder.
export const REPORT_BUCKET = 'term-reports'

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
    // With no exam or pre/post section, and only weeks 2-5 to chart, everything
    // fits on one sheet — so the revision-quiz trend sits on page 1 rather than
    // being pushed onto a second, near-empty page.
    singlePage: true,
    blurb: 'A progress snapshot covering weeks 1–5: attendance, homework, the RQ chart and the teacher’s mid-term comment.',
    commentPlaceholder: 'How is this student going so far? Comment on each criterion, and on what to work on in the second half of term…',
    commentHint: 'One per student. Surfaces on the mid-term report PDF sent to parents.',
    emailPath: '/tutor/emails/mid-term',
    emailTitle: 'Mid-Term Reports',
    emailBlurb: 'Upload each student’s mid-term report and send it to their family with the PDF attached. Siblings are grouped into one email.',
    storageFolder: 'mid-term',
    defaultSubject: '{{term_name}} Mid-Term Report{{plural}} — {{student_names}} | CUBE Tuition',
    defaultTemplate: `Hi {{parent_name}},

We're halfway through {{term_name}}, and we wanted to share how {{student_names}} {{they_have}} been going so far.

Please find attached {{possessive}} mid-term report{{plural}}, covering the first half of term: attendance, homework, revision quiz results and the teacher's comments.

The purpose of a mid-term report is to give you a clear picture while there is still plenty of term left to act on it. If there is anything you would like to work on before the end of term, please reply to this email or speak to your tutor — we would be glad to help.

Kind regards,
The CUBE Team`,
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
    singlePage: false,
    blurb: 'The full term: attendance, homework, the RQ chart, exam analysis, pre/post test and the teacher’s term comment.',
    commentPlaceholder: 'How did this student go this term? Please comment on each of the student criteria and elaborate on strengths, areas to work on, parent guidance…',
    commentHint: 'One per student. Surfaces on the end-of-term report PDF sent to parents.',
    emailPath: '/tutor/emails/end-of-term',
    emailTitle: 'End-of-Term Reports',
    emailBlurb: 'Upload individual student reports and send a thank-you email with PDFs attached to each family. Siblings are grouped into one email.',
    storageFolder: null,          // the original flat layout — do not move
    defaultSubject: '{{term_name}} Report{{plural}} — {{student_names}} | CUBE Tuition',
    defaultTemplate: `Hi {{parent_name}},

Thank you so much for being part of CUBE Tuition this {{term_name}}. We've truly enjoyed working with {{student_names}} and are proud of the progress {{they_have}} made this term.

Please find attached {{possessive}} end-of-term report{{plural}}. We hope it gives a great overview of the work covered and achievements made.

The report includes an overview of their progress, strengths, and areas for improvement during the term. We encourage you to review it and reach out if you have any questions or would like to discuss any aspect of their learning journey further.

We look forward to seeing you again next term!

Kind regards,
The CUBE Team`,
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

/** Storage folder holding this kind's PDFs for a term. */
export const storagePrefix = (termId, kind) =>
  kind?.storageFolder ? `${termId}/${kind.storageFolder}` : `${termId}`

/** Full object path for one student's report PDF. */
export const storagePath = (termId, kind, studentId, classId) =>
  `${storagePrefix(termId, kind)}/${studentId}_${classId}.pdf`

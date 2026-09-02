/*
 * The level-test feedback email, in one place — the marking page renders the
 * SAME text as its preview that gets sent, so the two can never drift.
 *
 * The template is EDITABLE: the stored copy lives in portal_settings under
 * LEVEL_TEST_EMAIL_KEY and is merged over the default below. Placeholders:
 *
 *   {{first_name}}    the student's first name ("Zachary")
 *   {{student_name}}  their full name
 *   {{test_title}}    e.g. "9.M. Level Test"
 *   {{teacher_name}}  whoever is sending
 *   {{comment}}       the teacher's comment box — dissolves cleanly when empty
 */

export const LEVEL_TEST_EMAIL_KEY = 'level_test_email_template'

export const DEFAULT_LEVEL_TEST_TEMPLATE = `Hi,

Thank you for bringing {{first_name}} in to sit the {{test_title}} with us — it was lovely to have them in the centre.

Please find {{first_name}}'s feedback report attached. It shows the overall result and a topic-by-topic breakdown, highlighting the areas {{first_name}} is already doing well in and the areas we'd suggest focusing on next. A level test is a snapshot of where a student is right now, so it's best read as a starting point rather than a judgement.

{{comment}}

If you have any questions, or would like to chat about the next steps, just reply to this email — we’re always happy to help.

Warm regards,
{{teacher_name}}
CUBE Tuition`

export function levelTestEmailSubject({ studentName, testTitle }) {
  const title = testTitle || 'Level Test'
  return `${studentName ? studentName + ' — ' : ''}${title} Feedback Report`
}

export function renderLevelTestEmail(template, { studentName, testTitle, comment, teacherName }) {
  const first = studentName ? studentName.split(' ')[0] : 'your child'
  const filled = String(template || DEFAULT_LEVEL_TEST_TEMPLATE)
    .replaceAll('{{first_name}}', first)
    .replaceAll('{{student_name}}', studentName || 'your child')
    .replaceAll('{{test_title}}', testTitle || 'Level Test')
    .replaceAll('{{teacher_name}}', teacherName || 'The CUBE team')
    .replaceAll('{{comment}}', (comment || '').trim())
  // An empty comment leaves a hole where its paragraph was — collapse it.
  return filled.replace(/\n{3,}/g, '\n\n').trim()
}

// Back-compat name (the send route falls back to this when the client didn't
// pass a rendered body — e.g. an old tab from before the template editor).
export function levelTestEmailBody(args) {
  return renderLevelTestEmail(DEFAULT_LEVEL_TEST_TEMPLATE, args)
}

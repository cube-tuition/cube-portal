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
 *   {{teacher_name}}  whoever is sending (not in the default — emails sign off as CUBE Tuition)
 *   {{comment}}       the teacher's comment box — dissolves cleanly when empty
 *
 * **bold** is the one piece of formatting the body understands, the same marker
 * the workbook builder and question editor use. It becomes <strong> in the HTML
 * part of the email and the markers are stripped from the plain-text part, so
 * neither copy shows a stray asterisk.
 */

export const LEVEL_TEST_EMAIL_KEY = 'level_test_email_template'

export const DEFAULT_LEVEL_TEST_TEMPLATE = `Hi,

Thank you for bringing {{first_name}} in to sit the {{test_title}} with us — it was lovely to have them in the centre.

Please find {{first_name}}'s feedback report attached. It shows the overall result and a topic-by-topic breakdown, highlighting the areas {{first_name}} is already doing well in and the areas we'd suggest focusing on next. A level test is a snapshot of where a student is right now, so it's best read as a starting point rather than a judgement.

{{comment}}

If you have any questions, or would like to chat about the next steps, just reply to this email — we’re always happy to help.

Warm regards,
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


// ── Family email: one email for brothers and sisters ─────────────────────────
// Siblings who sit level tests together get ONE email with every child's
// report attached, instead of one each. It has its own template (the single
// one talks about one child throughout), stored under its own key and edited
// from the same place. Placeholders:
//
//   {{first_names}}   "Aaron and Olivia" (three or more: "Aaron, Olivia and Chloe")
//   {{teacher_name}}  whoever is sending (not in the default)
//   {{comments}}      each child's comment box under their name — a child
//                     with no comment is left out, and the paragraph dissolves
//                     when nobody has one

export const LEVEL_TEST_FAMILY_EMAIL_KEY = 'level_test_family_email_template'

export const DEFAULT_LEVEL_TEST_FAMILY_TEMPLATE = `Hi,

Thank you for bringing {{first_names}} in to sit their level tests with us — it was lovely to have them in the centre.

Please find their feedback reports attached, one for each child. Each report shows the overall result and a topic-by-topic breakdown, highlighting the areas they're already doing well in and the areas we'd suggest focusing on next. A level test is a snapshot of where a student is right now, so it's best read as a starting point rather than a judgement.

{{comments}}

If you have any questions, or would like to chat about the next steps, just reply to this email — we’re always happy to help.

Warm regards,
CUBE Tuition`

const firstName = (name) => (name ? String(name).trim().split(/\s+/)[0] : '')

/** "Aaron", "Aaron and Olivia", "Aaron, Olivia and Chloe". */
export function joinNames(names) {
  const ns = names.filter(Boolean)
  if (ns.length <= 1) return ns[0] || 'your children'
  return `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`
}

/** children: [{ studentName, comment }], in the order their reports are attached. */
export function levelTestFamilySubject(children) {
  return `${joinNames(children.map(c => firstName(c.studentName)))} — Level Test Feedback Reports`
}

export function renderLevelTestFamilyEmail(template, { children, teacherName }) {
  const comments = children
    .filter(c => (c.comment || '').trim())
    .map(c => `**${firstName(c.studentName) || 'Your child'}**\n${c.comment.trim()}`)
    .join('\n\n')
  const filled = String(template || DEFAULT_LEVEL_TEST_FAMILY_TEMPLATE)
    .replaceAll('{{first_names}}', joinNames(children.map(c => firstName(c.studentName))))
    .replaceAll('{{teacher_name}}', teacherName || 'The CUBE team')
    .replaceAll('{{comments}}', comments)
  return filled.replace(/\n{3,}/g, '\n\n').trim()
}

// ── Formatting ────────────────────────────────────────────────────────────────
// Only **bold** is supported. Kept here so the preview on the marking page and
// the email the route sends are produced by the same two functions.
const BOLD = /\*\*(.+?)\*\*/g

/** Plain-text copy: the markers are removed, not shown. */
export const levelTestEmailText = (body) => String(body ?? '').replace(BOLD, '$1')

/** HTML copy: escaped first, so a body can never inject markup. */
export function levelTestEmailHtml(body) {
  return String(body ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(BOLD, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
}

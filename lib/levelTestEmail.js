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
 *   {{comment}}       the comment boxes — one subheading per test ("Maths",
 *                     "English"), then the overall comment; dissolves cleanly
 *                     when every box is empty
 *
 * Formatting the body understands: **bold** (the marker the workbook builder
 * and question editor use), and a line starting "# " (a heading) or "## " (a
 * subheading). In the HTML part of the email they become <strong> and styled
 * headings; in the plain-text part the markers are stripped, so neither copy
 * shows a stray symbol.
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

/*
 * One child's comments as email text: each test's comment under its own
 * subheading, then the overall comment. Empty boxes are left out. An overall
 * comment on its own (older lessons, or a single remark) needs no heading.
 *
 *   sections: [{ label: 'Maths', text }], overall: 'text'
 */
export function levelTestCommentBlock({ sections = [], overall = '' } = {}) {
  const secs = sections.filter(sc => String(sc.text || '').trim())
  const ov = String(overall || '').trim()
  const parts = secs.map(sc => `## ${sc.label}\n${sc.text.trim()}`)
  if (ov) parts.push(secs.length ? `## Overall\n${ov}` : ov)
  return parts.join('\n\n')
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
//   {{comments}}      each child's name as a heading, their comments as
//                     subheadings under it (levelTestCommentBlock) — a child
//                     with no comments is left out — then the family comment,
//                     once, under an "Overall" heading. The paragraph
//                     dissolves when there is nothing to say

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

/** children: [{ studentName, comment }] — comment is levelTestCommentBlock()'s
 *  output — in the order their reports are attached. */
export function levelTestFamilySubject(children) {
  return `${joinNames(children.map(c => firstName(c.studentName)))} — Level Test Feedback Reports`
}

export function renderLevelTestFamilyEmail(template, { children, familyComment = '', teacherName }) {
  const blocks = children
    .filter(c => (c.comment || '').trim())
    .map(c => `# ${firstName(c.studentName) || 'Your child'}\n${c.comment.trim()}`)
  // A remark for the whole family goes in once, after every child.
  if (String(familyComment || '').trim()) blocks.push(`# Overall\n${familyComment.trim()}`)
  const comments = blocks.join('\n\n')
  const filled = String(template || DEFAULT_LEVEL_TEST_FAMILY_TEMPLATE)
    .replaceAll('{{first_names}}', joinNames(children.map(c => firstName(c.studentName))))
    .replaceAll('{{teacher_name}}', teacherName || 'The CUBE team')
    .replaceAll('{{comments}}', comments)
  return filled.replace(/\n{3,}/g, '\n\n').trim()
}

// ── Formatting ────────────────────────────────────────────────────────────────
// **bold**, "# " headings and "## " subheadings. Kept here so the preview on the
// marking page and the email the route sends are produced by the same two
// functions.
const BOLD = /\*\*(.+?)\*\*/g
const HEADING = /^(#{1,2}) +(.+)$/

/** Plain-text copy: the markers are removed, not shown. */
export const levelTestEmailText = (body) => String(body ?? '')
  .split('\n').map(line => line.replace(HEADING, '$2')).join('\n')
  .replace(BOLD, '$1')

const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/*
 * HTML copy: escaped first, so a body can never inject markup. Headings are
 * blocks with their own spacing; ordinary lines are joined by <br> exactly as
 * before, so a blank line is still a paragraph gap.
 */
export function levelTestEmailHtml(body) {
  const lines = String(body ?? '').split('\n').map((line) => {
    const h = line.match(HEADING)
    if (!h) return { block: false, html: escapeHtml(line).replace(BOLD, '<strong>$1</strong>') }
    const text = escapeHtml(h[2].trim()).replace(BOLD, '$1')
    return {
      block: true,
      html: h[1] === '#'
        ? `<div style="font-size:16px;font-weight:700;color:#062E63;margin:18px 0 2px">${text}</div>`
        : `<div style="font-size:14px;font-weight:700;color:#325099;margin:10px 0 2px">${text}</div>`,
    }
  })
  return lines.map((ln, i) => ln.html + (!ln.block && lines[i + 1] && !lines[i + 1].block ? '<br>' : '')).join('')
}

/*
 * Trial feedback emails — sent to a parent from the trial pipeline
 * (/tutor/trials). A trial is two lessons, and the family hears after each:
 *
 *   lesson1  the tutor's notes on the first trial lesson, plus a reminder of
 *            the next one (date and time filled in as {{next_lesson}})
 *   outcome  the notes on the second lesson, plus how to continue
 *
 * Both pass on what the tutor wrote after the lesson (attendance.trial_feedback,
 * captured in SessionMarker). In the outcome email continuing is the clear call
 * to action; stopping is mentioned once, quietly, so it never reads as pressure.
 *
 * Pure functions — the trials page renders the same HTML for its preview as
 * the send route puts in the email, so what staff approve is what goes out.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// escape → **bold** → newlines. Inline only; no block markup in this template.
const rich = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\n/g, '<br/>')

export function fillTrialVars(text, vars = {}) {
  return String(text ?? '')
    .replace(/\{\{parent_name\}\}/g,  vars.parentName  || 'there')
    .replace(/\{\{student_name\}\}/g, vars.studentName || 'your child')
    .replace(/\{\{next_lesson\}\}/g,  vars.nextLesson  || 'the next class')
}

/*
 * Every text block is editable before sending. Keep the opt-out line gentle —
 * it exists so families never feel cornered, not to invite them to leave.
 */
export const DEFAULT_TRIAL_LESSON1_CONTENT = {
  subject:         'How {{student_name}}’s first trial lesson went',
  greeting:        'Hi {{parent_name}},',
  intro:           'Thank you for bringing {{student_name}} along to their first trial lesson at CUBE — it was lovely to have them in class.\n\nHere’s what their tutor had to say.',
  feedbackHeading: 'How the first lesson went',
  nextHeading:     'Next trial lesson',
  nextBody:        'We look forward to seeing {{student_name}} at their second trial lesson: **{{next_lesson}}**.',
  optOutNote:      'If anything changes before then, just reply to this email.',
  signoff:         'Kind regards,\nThe CUBE Team',
}

export const DEFAULT_TRIAL_OUTCOME_CONTENT = {
  subject:         '{{student_name}}’s trial lessons at CUBE',
  greeting:        'Hi {{parent_name}},',
  intro:           'Thank you for bringing {{student_name}} along to CUBE — they’ve now finished their trial lessons, and we’ve really enjoyed having them in class.\n\nHere’s how their second lesson went.',
  feedbackHeading: 'How the second lesson went',
  nextHeading:     'Continuing with CUBE',
  nextBody:        'If you’d like {{student_name}} to keep going, just **reply to this email** and we’ll save their spot for the rest of the term. We’ll send your invoice through afterwards — there’s nothing to pay right now.',
  optOutNote:      'And if the timing isn’t right, simply let us know — no obligation at all.',
  signoff:         'Kind regards,\nThe CUBE Team',
}

// The two emails: which trial lesson each reports on, its wording, and the
// trial_submissions column that records its first send.
export const TRIAL_EMAIL_STAGES = {
  lesson1: { label: 'Lesson 1 feedback', lessonIndex: 0, defaults: DEFAULT_TRIAL_LESSON1_CONTENT, sentField: 'lesson1_feedback_sent_at' },
  outcome: { label: 'Trial outcome',     lessonIndex: 1, defaults: DEFAULT_TRIAL_OUTCOME_CONTENT, sentField: 'outcome_sent_at' },
}
const stageOf = (stage) => TRIAL_EMAIL_STAGES[stage] || TRIAL_EMAIL_STAGES.outcome

export function mergeTrialOutcomeContent(overrides, stage = 'outcome') {
  return { ...stageOf(stage).defaults, ...(overrides || {}) }
}

/*
 * The lessons one email reports on: per trialled class, its first (lesson1)
 * or second (outcome) attended trial lesson. Classes without that lesson yet
 * are left out. groups: [{ classId, subject, lessons: [{ date, feedback }] }]
 * with lessons oldest first.
 */
export function stageGroups(groups = [], stage = 'outcome') {
  const { lessonIndex } = stageOf(stage)
  return groups
    .filter(g => g.lessons?.[lessonIndex])
    .map(g => ({ ...g, lessons: [{ ...g.lessons[lessonIndex], label: `Lesson ${lessonIndex + 1}` }] }))
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function clock(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return ''
  let h = Number(m[1])
  if (h >= 1 && h <= 7) h += 12                      // a bare 1–7 o'clock is an afternoon class
  return `${h % 12 || 12}:${m[2]}${h >= 12 ? 'pm' : 'am'}`
}
/*
 * "{{next_lesson}}" for the lesson 1 email: the next trial lesson's day, date
 * and time — per subject when the student trials more than one.
 *   next: [{ subject, date: 'YYYY-MM-DD', start, end }]
 */
export function nextLessonText(next = []) {
  const one = (n) => {
    const d = new Date(`${n.date}T00:00:00`)
    const when = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
    const time = [clock(n.start), clock(n.end)].filter(Boolean).join('–')
    return time ? `${when}, ${time}` : when
  }
  const dated = next.filter(n => n?.date)
  if (dated.length <= 1) return dated.length ? one(dated[0]) : ''
  return dated.map(n => `${n.subject} on ${one(n)}`).join(' and ')
}

const NAVY = '#062E63'
const BLUE = '#325099'
const INK  = '#2A2035'

// One subject's trial lessons: a heading and the tutor's note per lesson.
// Lessons with no note are skipped — a blank quote reads worse than nothing.
function subjectBlock(group) {
  const lessons = (group.lessons || []).filter(l => String(l.feedback ?? '').trim())
  if (!lessons.length) return ''
  const items = lessons.map(l => `
        <tr><td style="padding:0 0 14px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${BLUE};opacity:0.65;">${esc(l.label)}</p>
          <p style="margin:0;font-size:14.5px;line-height:1.7;color:${INK};">${rich(l.feedback.trim())}</p>
        </td></tr>`).join('')
  return `
    <div style="margin:0 0 18px;background:#F8FAFF;border:1px solid #DEE7FF;border-radius:12px;padding:18px 20px;">
      <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:${NAVY};">${esc(group.subject)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${items}</table>
    </div>`
}

/*
 * Build the email.
 *   vars    { parentName, studentName }
 *   groups  [{ subject, lessons: [{ label, feedback }] }]
 */
export function buildTrialOutcomeEmailHtml(vars = {}, groups = [], overrides, stage = 'outcome') {
  const c = mergeTrialOutcomeContent(overrides, stage)
  const t = (key) => rich(fillTrialVars(c[key], vars))
  const feedbackHtml = (groups || []).map(subjectBlock).join('')

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:${INK};background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">

    <div style="background:linear-gradient(120deg,#04204a 0%,${NAVY} 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:30px;">
      <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
      <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
    </div>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">${t('greeting')}</p>
    <p style="margin:0 0 26px;font-size:15px;line-height:1.7;">${t('intro')}</p>

    ${feedbackHtml ? `
    <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:${NAVY};">${t('feedbackHeading')}</p>
    ${feedbackHtml}` : ''}

    <div style="margin:26px 0 0;background:#F0F4FF;border:1px solid #DEE7FF;border-radius:12px;padding:18px 20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${NAVY};">${t('nextHeading')}</p>
      <p style="margin:0;font-size:14.5px;line-height:1.75;color:${INK};">${t('nextBody')}</p>
    </div>

    ${String(c.optOutNote || '').trim() ? `<p style="margin:14px 0 0;font-size:12.5px;line-height:1.65;color:${BLUE};opacity:0.6;">${t('optOutNote')}</p>` : ''}

    <p style="margin:28px 0 0;font-size:15px;line-height:1.7;">${t('signoff')}</p>
  </div>
  </body></html>`
}

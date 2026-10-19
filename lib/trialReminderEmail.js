/*
 * Trial reminder — the SECOND email to a trial family, sent from the pipeline
 * once a class is assigned: the two trial lesson dates and time, no invoice.
 * (The first email, the invitation, is lib/trialInvitationEmail.js.)
 *
 * Sends go through /api/send-term-start-emails with attach_invoices off — the
 * same route the term-start page uses, so the email looks the same — and each
 * real send is stamped on trial_submissions.reminder_sent_at (first send only).
 */
import { supabase } from './supabase'
import { authedFetch } from './authedFetch'
import { TRIAL_LESSONS, trialDatesFor } from './trialDates.js'

// Wording lives in the browser, under the keys the old Emails → Trials page
// used, so anything already customised carries over.
const TEMPLATE_KEY = 'cube_trials_template'
const SUBJECT_KEY  = 'cube_trials_subject'

export const DEFAULT_TRIAL_REMINDER_SUBJECT = 'Your trial lessons at CUBE'
export const DEFAULT_TRIAL_REMINDER_TEMPLATE = `Dear {{parent_name}},

Welcome to CUBE! We're excited to have {{student_names}} joining us for a trial.

Here are the trial details:

{{class_details}}

There's nothing to pay for the trial — just arrive a few minutes early and our team will look after the rest.

We'll be in touch after the trial to hear how it went and to help with next steps if you'd like to continue.

If you have any questions before then, just reply to this email.

Kind regards,
The CUBE Team`

export function loadReminderWording() {
  try {
    return {
      template: localStorage.getItem(TEMPLATE_KEY) || DEFAULT_TRIAL_REMINDER_TEMPLATE,
      subject:  localStorage.getItem(SUBJECT_KEY)  || DEFAULT_TRIAL_REMINDER_SUBJECT,
    }
  } catch { return { template: DEFAULT_TRIAL_REMINDER_TEMPLATE, subject: DEFAULT_TRIAL_REMINDER_SUBJECT } }
}
export function saveReminderWording({ template, subject }) {
  try {
    localStorage.setItem(TEMPLATE_KEY, template)
    localStorage.setItem(SUBJECT_KEY, subject)
  } catch { /* storage blocked */ }
}

// ── Dates ────────────────────────────────────────────────────────────────────
export { TRIAL_LESSONS, trialDatesFor }
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function lessonDateLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MON_NAMES[d.getMonth()]}`
}
const trialDatesLabel = (dates) => dates.map(lessonDateLabel).join(' & ')

// A trial's schedule line: "Tuesday 13 Oct & Tuesday 20 Oct · 18:00 - 20:00",
// or just the weekday when the timetable has no lessons yet.
export function trialWhen(s) {
  return [
    s.trial_dates_label || s.class_day,
    s.class_start && s.class_end ? `${s.class_start} - ${s.class_end}` : s.class_start,
  ].filter(Boolean).join(' · ')
}

/**
 * The family payload for one trial submission, in the shape the send route
 * expects. `rows` are the student's trial classes:
 *   [{ class_id, class_name, day_of_week, start_time, end_time, dates: [iso] }]
 */
export function reminderFamilyFor(sub, rows, { parentName, parentEmail, familyId } = {}) {
  const students = rows.map(r => ({
    student_id:   sub.converted_student_id,
    class_id:     r.class_id,
    student_name: sub.student_name || '—',
    class_name:   r.class_name || '—',
    class_day:    r.day_of_week || '',
    class_start:  r.start_time?.slice(0, 5) || '',
    class_end:    r.end_time?.slice(0, 5) || '',
    first_lesson: r.dates?.[0] || null,
    trial_dates_label: trialDatesLabel(r.dates || []),
  }))
  return {
    submission_id: sub.id,
    family_id:     familyId ?? null,
    student_ids:   [sub.converted_student_id].filter(Boolean),
    parent_name:   parentName || sub.parent_name || sub.student_name || '',
    parent_email:  parentEmail || sub.parent_email || '',
    students,
  }
}

// ── Preview (matches the send route's rendering) ────────────────────────────
function buildClassDetails(students) {
  const unique = students.filter((s, i, a) =>
    a.findIndex(x => x.student_name === s.student_name && x.class_name === s.class_name) === i)
  return unique.map(s => {
    const when = trialWhen(s)
    return `  • ${s.student_name} — ${s.class_name}${when ? ' · ' + when : ''}`
  }).join('\n')
}
export function fillReminderTemplate(template, family, termName = '') {
  const unique     = family.students.filter((s, i, a) => a.findIndex(x => x.student_name === s.student_name && x.class_name === s.class_name) === i)
  const firstNames = [...new Set(unique.map(s => s.student_name.split(' ')[0]))]
  const names      = firstNames.length === 1 ? firstNames[0] : firstNames.slice(0, -1).join(', ') + ' and ' + firstNames.slice(-1)
  return String(template || '')
    .replace(/\{\{parent_name\}\}/g,   family.parent_name || 'there')
    .replace(/\{\{term_name\}\}/g,     termName || '')
    .replace(/\{\{term_short\}\}/g,    (termName || '').replace(/\s*\d{4}\s*$/, '').trim())
    .replace(/\{\{student_names\}\}/g, names)
    .replace(/\{\{class_details\}\}/g, buildClassDetails(family.students))
    .replace(/\{\{possessive\}\}/g,    'their')
    .replace(/\{\{they_have\}\}/g,     'they have')
    .replace(/\{\{plural\}\}/g,        unique.length > 1 ? 's' : '')
}
function scheduleCardHtml(lines) {
  const rows = lines.filter(l => l.trim()).map(l => {
    const text = l.replace(/^\s*•\s*/, '').trim()
    const i    = text.indexOf(' · ')
    const head = i === -1 ? text : text.slice(0, i)
    const when = i === -1 ? '' : text.slice(i + 3)
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 9px;"><tr>`
      + `<td style="border-left:2px solid #D5DEF0;padding:1px 0 1px 12px;">`
      + `<div style="font-size:14px;font-weight:600;color:#22324F;line-height:1.4;">${head}</div>`
      + (when ? `<div style="font-size:12.5px;font-weight:500;color:#6B7A99;margin-top:1px;">${when}</div>` : '')
      + `</td></tr></table>`
  }).join('')
  return `<div style="margin:6px 0 16px;">${rows}</div>`
}
function segmentBlock(block) {
  const segs = []
  for (const line of block.split('\n')) {
    const isB = line.trim().startsWith('•')
    const last = segs[segs.length - 1]
    if (last && last.bullets === isB) last.lines.push(line)
    else segs.push({ bullets: isB, lines: [line] })
  }
  return segs
}
export function buildReminderPreviewHtml(template, family, termName = '') {
  const body    = fillReminderTemplate(template, family, termName)
  const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paras   = escaped.split(/\n\n+/).map(block =>
    segmentBlock(block).map(seg => {
      if (seg.bullets) return scheduleCardHtml(seg.lines)
      const html = seg.lines.join('\n').trim()
      return html ? `<p style="margin:0 0 16px 0;line-height:1.7;">${html.replace(/\n/g, '<br/>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>` : ''
    }).join('')
  ).join('')
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(6,46,99,0.08);">
      <div style="background:#062E63;background:linear-gradient(120deg,#04204a 0%,#062E63 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:32px;">
        <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
        <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
      </div>
      <div style="font-size:15px;">${paras}</div>
    </div>
  </body></html>`
}

// ── Send ─────────────────────────────────────────────────────────────────────
/**
 * Send the reminder to each family. Real sends are stamped on their
 * submissions (first send only). Returns the route's per-family results with
 * `submission_id` attached.
 */
export async function sendTrialReminders(families, { termId, termName, template, subject, test = false }) {
  const res = await authedFetch('/api/send-term-start-emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      term_id: termId, term_name: termName || '', template, subject, test,
      attach_invoices: false,
      families: families.map(f => ({
        ...f,
        // The route rebuilds class_details from students — feed it the whole
        // trial line (both dates + time) as the "day" so it lands as written.
        students: f.students.map(s => ({ ...s, class_day: trialWhen(s), class_start: '', class_end: '', enr_status: 'active' })),
      })),
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Send failed')
  // A family payload can cover several submissions (one student trialling two
  // subjects gets one email): submission_ids then lists every one it stamps.
  const results = (data.results || []).map((r, i) => ({
    ...r,
    submission_id: families[i]?.submission_id ?? null,
    submission_ids: families[i]?.submission_ids || (families[i]?.submission_id != null ? [families[i].submission_id] : []),
  }))
  if (!test) {
    const now = new Date().toISOString()
    const ids = results.filter(r => r.success).flatMap(r => r.submission_ids)
    if (ids.length) {
      await supabase.from('trial_submissions').update({ reminder_sent_at: now }).in('id', ids).is('reminder_sent_at', null)
    }
  }
  return results
}

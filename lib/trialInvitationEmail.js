/*
 * Trial invitation email — the FIRST email a family gets from the trial
 * pipeline: a thank-you/welcome, plus a proposed trial class matched to the
 * student's year, subject and the availability windows the family gave on the
 * enquiry form, with the class's next scheduled lesson as the suggested date.
 *
 * Pure functions — the composer renders the same HTML for its preview as the
 * send route puts in the email, so what staff approve is what goes out.
 * (Pairs with lib/trialOutcomeEmail.js, which closes the trial.)
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
}

export const DEFAULT_TRIAL_INVITATION_CONTENT = {
  subject:      'Welcome to CUBE — {{student_name}}’s trial',
  greeting:     'Hi {{parent_name}},',
  intro:        'Thank you for your enquiry — we’d love to have {{student_name}} come in for a trial at CUBE.\n\nTrials run inside one of our regular classes, so {{student_name}} experiences exactly how we teach, alongside students of the same year.',
  personalNote: '',
  proposalHeading: 'Suggested trial class',
  proposalBody: 'Based on {{student_name}}’s year and subject, here’s the class we think fits best. Just **reply to this email** to confirm and we’ll save the spot:',
  alternativesNote: 'If that time doesn’t suit, these classes also fit:',
  flexNote:     'And if none of these times work, reply with what does — we’ll find a spot that suits.',
  signoff:      'Kind regards,\nThe CUBE Team',
}

export function mergeTrialInvitationContent(overrides) {
  return { ...DEFAULT_TRIAL_INVITATION_CONTENT, ...(overrides || {}) }
}

/* ── Class matching ─────────────────────────────────────────────────────────
 * Subjects arrive as enquiry-form strings ("Maths", "Maths Advanced",
 * "English", "Chemistry", …); classes as names like "Y9 Maths",
 * "Y11 Ext 1 Maths". Plain Maths/English must not match Adv/Ext streams.
 */
const ONE_ON_ONE_RE = /\b1:1\b|1-on-1|one[ .-]?on[ .-]?one/i

export function subjectMatchesClass(subject, className) {
  const s = String(subject || '').toLowerCase()
  const c = String(className || '').toLowerCase()
  if (!s) return false
  if (/advanced/.test(s)) return /\badv\b|advanced/.test(c)
  if (/extension\s*1|ext\s*1/.test(s)) return /ext\s*1/.test(c)
  if (/extension\s*2|ext\s*2/.test(s)) return /ext\s*2/.test(c)
  if (/maths|math/.test(s)) return /maths/.test(c) && !/\badv\b|advanced|ext\s*\d/.test(c)
  if (/english/.test(s)) return /english/.test(c) && !/ext\s*\d/.test(c)
  if (/chem/.test(s)) return /chem/.test(c)
  if (/physics/.test(s)) return /physics/.test(c)
  // Fallback: the whole subject string appears in the class name.
  return c.includes(s)
}

// "4:00pm – 6:00pm" → [960, 1080] (minutes since midnight); null if unparsable.
function parseWindow(win) {
  const m = String(win || '').match(/(\d{1,2}):(\d{2})\s*(am|pm)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(am|pm)/i)
  if (!m) return null
  const mins = (h, mm, ap) => ((h % 12) + (/pm/i.test(ap) ? 12 : 0)) * 60 + Number(mm)
  return [mins(Number(m[1]), m[2], m[3]), mins(Number(m[4]), m[5], m[6])]
}

const toMins = (t) => {
  const [h, m] = String(t || '').split(':').map(Number)
  return Number.isFinite(h) ? h * 60 + (m || 0) : null
}

/*
 * Score a class against the family's stated availability
 * ({ Monday: ["4:00pm – 6:00pm", …], … }):
 *   2 — right day AND the class starts inside a stated window
 *   1 — right day, time outside the stated windows
 *   0 — day the family didn't offer (or no availability given)
 */
export function availabilityScore(cls, availability) {
  const windows = availability?.[cls.day_of_week]
  if (!Array.isArray(windows) || !windows.length) return 0
  const start = toMins(cls.start_time)
  if (start == null) return 1
  for (const w of windows) {
    const win = parseWindow(w)
    if (win && start >= win[0] && start < win[1]) return 2
  }
  return 1
}

/*
 * All classes matching the student's year + subject, scored by availability,
 * best first. 1:1 classes are excluded — trials run in group classes.
 */
export function matchTrialClasses({ year, subject, availability }, classes = []) {
  const y = String(year || '').replace(/\D/g, '')
  if (!y) return []
  const yearRe = new RegExp(`^y${y}\\b`, 'i')
  return classes
    .filter(c => yearRe.test(String(c.class_name || '').trim()))
    .filter(c => !ONE_ON_ONE_RE.test(c.class_name || ''))
    .filter(c => subjectMatchesClass(subject, c.class_name))
    .map(c => ({ ...c, fit: availabilityScore(c, availability) }))
    .sort((a, b) => b.fit - a.fit || String(a.class_name).localeCompare(String(b.class_name)))
}

/* ── Display formatting ── */
const fmt12 = (t) => {
  const mins = toMins(t)
  if (mins == null) return ''
  const h = Math.floor(mins / 60), m = mins % 60
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}
export const classTimeLabel = (cls) =>
  [fmt12(cls.start_time), fmt12(cls.end_time)].filter(Boolean).join(' – ')

export function fmtLessonDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/*
 * First date on/after `fromISO` falling on the named weekday — the fallback
 * trial date when a class has no generated lessons yet (next term's lessons
 * are created closer to term start). Returns an ISO date, or null.
 */
export function firstWeekdayOnOrAfter(fromISO, weekdayName) {
  const target = WEEKDAYS.findIndex(w => w.toLowerCase() === String(weekdayName || '').toLowerCase())
  if (target < 0 || !fromISO) return null
  const d = new Date(fromISO + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7))
  // Local date parts, NOT toISOString() — that converts to UTC and shifts the
  // day back by one for any timezone ahead of it (Sydney always is).
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const NAVY = '#062E63'
const BLUE = '#325099'
const INK  = '#2A2035'

// One class as an email card. `slot` = { className, day, time, date } — date
// already formatted ('' means no scheduled lesson found yet).
function classCard(slot, { primary = false } = {}) {
  if (!slot) return ''
  return `
    <div style="margin:0 0 ${primary ? 18 : 10}px;background:${primary ? '#F0F4FF' : '#F8FAFF'};border:1px solid #DEE7FF;border-radius:12px;padding:${primary ? '18px 20px' : '12px 16px'};">
      <p style="margin:0 0 2px;font-size:${primary ? 16 : 14}px;font-weight:700;color:${NAVY};">${esc(slot.className)}</p>
      <p style="margin:0;font-size:${primary ? 14 : 12.5}px;color:${INK};">${esc(slot.day)}s · ${esc(slot.time)}</p>
      ${slot.date
        ? `<p style="margin:${primary ? 8 : 4}px 0 0;font-size:${primary ? 14 : 12.5}px;color:${INK};">${primary ? 'Suggested first lesson: ' : 'Next lesson: '}<strong>${esc(slot.date)}</strong></p>`
        : ''}
    </div>`
}

/*
 * Build the email.
 *   vars         { parentName, studentName }
 *   proposal     { className, day, time, date } | null
 *   alternatives [{ className, day, time, date }]
 */
export function buildTrialInvitationEmailHtml(vars = {}, proposal = null, alternatives = [], overrides) {
  const c = mergeTrialInvitationContent(overrides)
  const t = (key) => rich(fillTrialVars(c[key], vars))
  const personal = String(c.personalNote || '').trim()
  const alts = (alternatives || []).filter(Boolean)

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:${INK};background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">

    <div style="background:linear-gradient(120deg,#04204a 0%,${NAVY} 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:30px;">
      <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
      <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
    </div>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">${t('greeting')}</p>
    <p style="margin:0 0 ${personal ? 16 : 26}px;font-size:15px;line-height:1.7;">${t('intro')}</p>
    ${personal ? `<p style="margin:0 0 26px;font-size:15px;line-height:1.7;">${t('personalNote')}</p>` : ''}

    ${proposal ? `
    <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:${NAVY};">${t('proposalHeading')}</p>
    <p style="margin:0 0 12px;font-size:14.5px;line-height:1.7;">${t('proposalBody')}</p>
    ${classCard(proposal, { primary: true })}` : ''}

    ${alts.length ? `
    <p style="margin:6px 0 10px;font-size:13px;line-height:1.6;color:${INK};">${t('alternativesNote')}</p>
    ${alts.map(a => classCard(a)).join('')}` : ''}

    <p style="margin:14px 0 0;font-size:12.5px;line-height:1.65;color:${BLUE};opacity:0.75;">${t('flexNote')}</p>

    <p style="margin:28px 0 0;font-size:15px;line-height:1.7;">${t('signoff')}</p>
  </div>
  </body></html>`
}

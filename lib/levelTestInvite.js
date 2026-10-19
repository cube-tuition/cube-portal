/*
 * Level test invitation — the alternative first email to a trial enquiry:
 * instead of proposing a trial class, invite the student in to sit a level
 * test first. The email lists a few suggested times and links to a form
 * (/level-test/<token>) where the parent picks one; picking books the test.
 *
 * Pure functions — the composer's preview, the send route, the parent's form
 * and its API all use these, so what staff approve is what goes out and what
 * the form accepts. (Pairs with lib/trialInvitationEmail.js.)
 */
import { fillTrialVars, firstWeekdayOnOrAfter } from './trialInvitationEmail.js'

// How long a level test runs — the email copy and each suggested time's end.
export const LEVEL_TEST_MINUTES = 90

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// escape → **bold** → newlines. Inline only.
export const rich = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\n/g, '<br/>')

export const DEFAULT_LEVEL_TEST_INVITATION_CONTENT = {
  subject:      'Welcome to CUBE — {{student_name}}’s level test',
  greeting:     'Hi {{parent_name}},',
  intro:        'Thank you for your enquiry about {{student_name}}. Before choosing a class, we’d love to invite {{student_name}} in for a short level test, so we can see where they’re at and place them in the right group.',
  personalNote: '',
  details:      'It takes about **90 minutes**\nAfterwards we’ll send you a feedback report and recommend the right class',
  timesHeading: 'Suggested times',
  timesBody:    'Please choose the time that suits you best — it only takes a moment:',
  buttonLabel:  'Choose a time',
  flexNote:     'If none of these times work, the form lets you tell us what does — we’ll find a time that suits.',
  signoff:      'Kind regards,\nThe CUBE Team',
}

export function mergeLevelTestInvitationContent(overrides) {
  return { ...DEFAULT_LEVEL_TEST_INVITATION_CONTENT, ...(overrides || {}) }
}

/* ── Times ── */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const hhmm = (t) => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const v = `${m[1].padStart(2, '0')}:${m[2]}`
  return TIME_RE.test(v) ? v : null
}

/*
 * Clean a list of suggested times: drop rows without a valid date and start,
 * an end that isn't after the start, and duplicates; sort by date then time.
 * A slot is { date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' | null, room }.
 */
export function normaliseSlots(slots = []) {
  const out = []
  const seen = new Set()
  for (const s of Array.isArray(slots) ? slots : []) {
    const date = String(s?.date || '').trim()
    const start = hhmm(s?.start)
    if (!DATE_RE.test(date) || !start) continue
    let end = hhmm(s?.end)
    if (end && end <= start) end = null
    const room = String(s?.room || '').trim() || null
    const key = `${date} ${start}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ date, start, end, room })
  }
  return out.sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
}

// Slots the parent can still pick: on or after today (Sydney date, passed in).
export const openSlots = (slots, todayISO) => normaliseSlots(slots).filter(s => s.date >= todayISO)

// A start time one hour after `start` — the default length of a level test.
// The end of a level test that starts at `start` (LEVEL_TEST_MINUTES later).
export function testEnd(start, minutes = LEVEL_TEST_MINUTES) {
  const v = hhmm(start)
  if (!v) return ''
  const [h, m] = v.split(':').map(Number)
  const t = Math.min(h * 60 + m + minutes, 23 * 60 + 59)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

// "4:00pm – 6:00pm" → "16:00" (the window's start).
function windowStart(w) {
  const m = String(w || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!m) return null
  let h = Number(m[1]) % 12
  if ((m[3] || '').toLowerCase() === 'pm') h += 12
  else if (!m[3] && Number(m[1]) < 8) h += 12   // a bare "4:00" is afternoon
  return hhmm(`${h}:${m[2] || '00'}`)
}

/*
 * One suggested time per window of the family's availability, on the next
 * such weekday after `fromISO`: { Friday: ['4:00pm – 6:00pm'], Monday: [...] }
 * → Fri 4–5:30pm, Mon 6–7:30pm, … sorted by date.
 */
export function availabilitySlots(availability, fromISO) {
  const out = []
  for (const [day, windows] of Object.entries(availability || {})) {
    if (!Array.isArray(windows)) continue
    const date = firstWeekdayOnOrAfter(fromISO, day)
    if (!date) continue
    for (const w of windows) {
      const start = windowStart(w)
      if (start) out.push({ date, start, end: testEnd(start), room: '' })
    }
  }
  return normaliseSlots(out).map(s => ({ ...s, end: s.end || '', room: s.room || '' }))
}

const fmt12 = (t) => {
  const v = hhmm(t)
  if (!v) return ''
  const [h, m] = v.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}
export function fmtSlotDate(iso) {
  if (!DATE_RE.test(String(iso || ''))) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}
export const slotTime = (s) => [fmt12(s?.start), fmt12(s?.end)].filter(Boolean).join(' – ')
// "Saturday 25 October · 10:00am – 11:00am"
export const slotLabel = (s) => [fmtSlotDate(s?.date), slotTime(s)].filter(Boolean).join(' · ')
export const sameSlot = (a, b) => !!a && !!b && a.date === b.date && hhmm(a.start) === hhmm(b.start)

/*
 * The level tests a student should sit: the exam-bank level tests for their
 * year in each enquiry subject ("Maths Advanced" → Maths). Tests are
 * booklet_builds rows { id, year, subject }.
 */
export function matchLevelTests(tests = [], year, subjects = []) {
  const y = Number(String(year || '').replace(/\D/g, ''))
  const wanted = (Array.isArray(subjects) ? subjects : [subjects]).map(s => String(s || '').toLowerCase())
  const subjectOf = (w) => (/math/.test(w) ? 'maths' : /english/.test(w) ? 'english' : w.trim())
  const keys = new Set(wanted.map(subjectOf).filter(Boolean))
  return tests.filter(t => Number(t.year) === y && keys.has(String(t.subject || '').toLowerCase())).map(t => t.id)
}

/*
 * What the parent's form submission does, given the invite and (if already
 * booked) its lesson. `choice` is { slot } — one of the invite's slots — or
 * { none: true, note }. Returns { error } or { action, slot? }:
 *   book   — no booking yet: create the level test at `slot`
 *   move   — booked at another time: move the booking to `slot`
 *   keep   — they picked the time already booked: nothing to change
 *   cancel — booked, but now none suit: remove the booking, keep their note
 *   note   — not booked and none suit: just record their note
 * A booking that has been marked, or whose day has passed, can't be changed
 * from the form.
 */
export function planInviteResponse({ invite, lesson = null, marked = false, choice, today }) {
  if (!invite) return { error: 'This link is not valid. Please contact CUBE.' }
  const booked = lesson && lesson.status !== 'cancelled' ? lesson : null
  const locked = booked && (marked || booked.lesson_date < today)
  if (locked) return { error: 'This level test has already taken place — please contact CUBE to arrange anything further.' }
  if (choice?.none) {
    if (!String(choice.note || '').trim()) return { error: 'Please tell us which days and times would suit.' }
    return { action: booked ? 'cancel' : 'note' }
  }
  const slot = openSlots(invite.slots, today).find(s => sameSlot(s, choice?.slot))
  if (!slot) return { error: 'That time is no longer available — please choose another.' }
  if (!booked) return { action: 'book', slot }
  if (booked.lesson_date === slot.date && hhmm(booked.start_time) === slot.start) return { action: 'keep', slot }
  return { action: 'move', slot }
}

/* ── Email ── */
const NAVY = '#062E63'
const BLUE = '#325099'
const INK  = '#2A2035'

const header = `
    <div style="background:linear-gradient(120deg,#04204a 0%,${NAVY} 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:30px;">
      <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
      <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
    </div>`
// Shared with lib/autoReminders (the 24-hours-before reminders).
export const shell = (inner) => `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:${INK};background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
${header}
${inner}
  </div>
  </body></html>`

export function slotCard(s) {
  return `
    <div style="margin:0 0 8px;background:#F8FAFF;border:1px solid #DEE7FF;border-radius:10px;padding:11px 16px;">
      <p style="margin:0;font-size:14px;font-weight:700;color:${NAVY};">${esc(fmtSlotDate(s.date))}</p>
      <p style="margin:2px 0 0;font-size:13px;color:${INK};">${esc(slotTime(s))}${s.room ? ` · ${esc(s.room)}` : ''}</p>
    </div>`
}

/*
 * The invitation.
 *   vars   { parentName, studentName }
 *   slots  suggested times (normalised here)
 *   link   the parent's form; the preview passes none and the button is inert
 */
export function buildLevelTestInvitationEmailHtml(vars = {}, slots = [], link = '', overrides) {
  const c = mergeLevelTestInvitationContent(overrides)
  const t = (key) => rich(fillTrialVars(c[key], vars))
  const personal = String(c.personalNote || '').trim()
  const details = fillTrialVars(c.details, vars).split('\n').map(l => l.trim()).filter(Boolean)
  const times = normaliseSlots(slots)
  const href = link ? esc(link) : '#'
  return shell(`
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">${t('greeting')}</p>
    <p style="margin:0 0 ${personal ? 16 : 20}px;font-size:15px;line-height:1.7;">${t('intro')}</p>
    ${personal ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.7;">${t('personalNote')}</p>` : ''}

    ${details.length ? `
    <ul style="margin:0 0 26px;padding-left:20px;font-size:14.5px;line-height:1.8;color:${INK};">
      ${details.map(d => `<li>${rich(d)}</li>`).join('')}
    </ul>` : ''}

    <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:${NAVY};">${t('timesHeading')}</p>
    <p style="margin:0 0 12px;font-size:14.5px;line-height:1.7;">${t('timesBody')}</p>
    ${times.map(slotCard).join('')}

    <div style="margin:20px 0 6px;">
      <a href="${href}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 28px;border-radius:10px;">${t('buttonLabel')}</a>
    </div>

    <p style="margin:14px 0 0;font-size:12.5px;line-height:1.65;color:${BLUE};opacity:0.75;">${t('flexNote')}</p>

    <p style="margin:28px 0 0;font-size:15px;line-height:1.7;">${t('signoff')}</p>`)
}

// The parent's confirmation once they pick a time (or move it).
export function buildLevelTestBookedEmailHtml({ parentName, studentName, slot, link, moved = false }) {
  const vars = { parentName, studentName }
  const f = (s) => rich(fillTrialVars(s, vars))
  return shell(`
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">${f('Hi {{parent_name}},')}</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">${f(moved
      ? 'Thanks — we’ve moved {{student_name}}’s level test to the new time:'
      : 'Thanks — {{student_name}}’s level test is booked:')}</p>
    ${slotCard(slot)}
    <p style="margin:18px 0 0;font-size:14.5px;line-height:1.7;">${f('It takes about 90 minutes. Afterwards we’ll send you a feedback report and recommend the right class for {{student_name}}.')}</p>
    ${link ? `<p style="margin:14px 0 0;font-size:12.5px;line-height:1.65;color:${BLUE};opacity:0.75;">Need a different time? <a href="${esc(link)}" style="color:${BLUE};">Change it here</a>, or just reply to this email.</p>` : ''}
    <p style="margin:28px 0 0;font-size:15px;line-height:1.7;">Kind regards,<br/>The CUBE Team</p>`)
}

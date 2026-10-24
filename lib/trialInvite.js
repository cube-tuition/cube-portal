/*
 * Trial invitation class picker — the family's choice of trial class.
 *
 * The invitation email (and the level test results email) links to
 * /trial/<token>, a form listing the classes offered for each subject. Picking
 * a class books the trial (lib/trialInviteServer bookTrialClass); picking an
 * "other" option staff typed in (e.g. "Y7 English 1:1", with a date and time
 * if they gave one) records it for staff to set up.
 *
 *   section  { submission_id, label, options: [option] }
 *   option   { id, kind: 'class', class_id, class_name, day, start, end, date }
 *          | { id, kind: 'slot', label, date?, start?, end?, note?, room? }   — an "other" option
 *
 * Pure — the modal, the send routes, the form and its API all use these, so
 * what staff offer is what the family sees and what the API accepts.
 * (Pairs with lib/levelTestInvite.js, the same pattern for level tests.)
 */
import { shell, rich } from './levelTestInvite.js'
import { trialClassesBlockHtml, cardsFromFormSections, mergeTrialInvitationContent } from './trialInvitationEmail.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const hhmm = (t) => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

/** Clean offered sections: valid dates and times, unique option ids, at least one option.
 *  A class needs its first lesson date; an "other" option needs a name or a date and time. */
export function normaliseSections(sections = []) {
  const out = []
  for (const sec of Array.isArray(sections) ? sections : []) {
    const sid = Number(sec?.submission_id)
    if (!Number.isInteger(sid)) continue
    const seen = new Set()
    const options = []
    for (const o of Array.isArray(sec.options) ? sec.options : []) {
      const kind = o?.kind === 'slot' ? 'slot' : 'class'
      const date = DATE_RE.test(String(o?.date || '').trim()) ? String(o.date).trim() : ''
      const start = hhmm(o?.start)
      const label = String(o?.label || '').trim().slice(0, 120)
      if (kind === 'class' && (!date || !Number.isInteger(Number(o.class_id)))) continue
      if (kind === 'slot' && !label && !(date && start)) continue
      const id = kind === 'class' ? `c${Number(o.class_id)}` : `s${date}-${start}${label ? `-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}`
      if (seen.has(id)) continue
      seen.add(id)
      options.push(kind === 'class'
        ? { id, kind, class_id: Number(o.class_id), class_name: String(o.class_name || ''), day: String(o.day || ''), start, end: hhmm(o.end), date }
        : { id, kind, label, date, start, end: start ? hhmm(o.end) : '', note: String(o.note || '').trim().slice(0, 200), room: String(o.room || '') })
    }
    if (options.length) out.push({ submission_id: sid, label: String(sec.label || ''), options })
  }
  return out
}

/** "Other" options typed by hand ({ label, date?, start?, end? }) as offered options; unnamed ones dropped. */
export const otherOptions = (list) => (Array.isArray(list) ? list : [])
  .filter(o => String(o?.label || '').trim())
  .map(o => ({ kind: 'slot', label: String(o.label).trim(), date: o.date || '', start: o.start || '', end: o.end || '', note: String(o.note || '').trim() }))

/** Options a family can still pick: the first lesson hasn't passed (an undated option stays open). */
export const isOpen = (o, today) => !o?.date || o.date >= today
export const openOptions = (section, today) => (section?.options || []).filter(o => isOpen(o, today))

/*
 * What the family answered for one request on an invite (stored in
 * trial_invites.picks[submission_id]):
 *   { option_id, picked_at }        a class / other option picked
 *   { none: true, note, picked_at } none of that subject's times suit
 * Older forms had one "none suit" note for the whole invite (invite.note).
 * → { pick: option | null, note: '' | what suits }
 */
export function inviteAnswer(invite, submissionId) {
  const a = invite?.picks?.[submissionId]
  const sec = (invite?.sections || []).find(x => x.submission_id === submissionId)
  const pick = a?.option_id ? (sec?.options || []).find(o => o.id === a.option_id) || null : null
  const note = a?.none ? (a.note || '') : (invite?.responded_at && !a ? (invite.note || '') : '')
  return { pick, note }
}

/*
 * The "none of these suit" notes on a submitted form: { submission_id: text }
 * for requests on this invite. A blank note is an error; a subject whose
 * class is already booked can't be switched to "none" here (reply instead).
 * → { error } | { noted: [{ section, note }] }
 */
export function planTrialNotes({ invite, notes }) {
  const noted = []
  for (const [key, raw] of Object.entries(notes && typeof notes === 'object' ? notes : {})) {
    const section = (invite?.sections || []).find(x => String(x.submission_id) === String(key))
    if (!section) continue
    const note = String(raw || '').trim().slice(0, 1000)
    if (!note) return { error: 'Please tell us which days and times would suit.' }
    if (invite.picks?.[section.submission_id]?.option_id) return { error: 'That trial is already booked — reply to our email to change it.' }
    noted.push({ section, note })
  }
  return { noted }
}

/*
 * Check a submitted form. `picks` is { submission_id: option_id }.
 * Returns { error } or { chosen: [{ section, option }] } — only options that
 * were offered and are still open; a section left blank is skipped.
 */
export function planTrialPicks({ invite, picks, today }) {
  if (!invite) return { error: 'This link is not valid. Please contact CUBE.' }
  const chosen = []
  for (const sec of invite.sections || []) {
    const id = picks?.[sec.submission_id] ?? picks?.[String(sec.submission_id)]
    if (!id) continue
    const option = openOptions(sec, today).find(o => o.id === id)
    if (!option) return { error: 'One of those times is no longer available — please choose another.' }
    chosen.push({ section: sec, option })
  }
  return { chosen }
}

// ── Labels ───────────────────────────────────────────────────────────────────
const fmt12 = (t) => {
  const v = hhmm(t)
  if (!v) return ''
  const [h, m] = v.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}
export const fmtDate = (iso) => (DATE_RE.test(String(iso || ''))
  ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) : '')
export const optionTime = (o) => [fmt12(o?.start), fmt12(o?.end)].filter(Boolean).join(' – ')
/** "Y8 Maths" / "Y7 English 1:1" (an other option's name; older ones were all "1:1 lesson") */
export const optionTitle = (o) => (o?.kind === 'slot' ? (o.label || '1:1 lesson') : (o?.class_name || 'Class'))
/** "Saturdays · 1:00pm – 2:30pm · first lesson Saturday 24 October" */
export const optionDetail = (o) => (o?.kind === 'slot'
  ? [fmtDate(o.date), optionTime(o), o.room, o.note].filter(Boolean).join(' · ')
  : [o?.day ? `${o.day}s` : '', optionTime(o), o?.date ? `first lesson ${fmtDate(o.date)}` : ''].filter(Boolean).join(' · '))

// ── Emails ───────────────────────────────────────────────────────────────────
/*
 * The family's confirmation once they pick.
 *   chosen  [{ section: { label }, option }]
 */
export function buildTrialBookedEmailHtml({ parentName, studentName, chosen = [], noted = [], link, moved = false }) {
  const first = String(studentName || '').trim().split(/\s+/)[0] || 'your child'
  const cards = chosen.map(({ section, option }) => `
    ${chosen.length > 1 && section.label ? `<p style="margin:14px 0 6px;font-size:13px;font-weight:700;color:#062E63;">${rich(section.label)}</p>` : ''}
    <div style="margin:0 0 8px;background:#F8FAFF;border:1px solid #DEE7FF;border-radius:10px;padding:11px 16px;">
      <p style="margin:0;font-size:14px;font-weight:700;color:#062E63;">${rich(optionTitle(option))}</p>
      ${optionDetail(option) ? `<p style="margin:2px 0 0;font-size:13px;color:#2A2035;">${rich(optionDetail(option))}</p>` : ''}
    </div>`).join('')
  const anySlot = chosen.some(c => c.option.kind === 'slot')
  // Subjects where none of the times suited: we come back with others.
  const pending = noted.length
    ? `<p style="margin:14px 0 0;font-size:14.5px;line-height:1.7;">${rich(`For ${noted.map(n => n.section.label || 'the other subject').join(' and ')}, thanks for letting us know what suits — we’ll be in touch with a time.`)}</p>`
    : ''
  return shell(`
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">${rich(`Hi ${parentName || 'there'},`)}</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">${rich(moved
      ? `Thanks — we’ve updated ${first}’s trial:`
      : `Thanks — ${first}’s trial is booked:`)}</p>
    ${cards}
    <p style="margin:18px 0 0;font-size:14.5px;line-height:1.7;">${rich(anySlot
      ? 'We’ll be in touch shortly to confirm the details. You’ll get a reminder the day before each trial lesson.'
      : 'The trial is two lessons. You’ll get a reminder the day before each one — just arrive a few minutes early and our team will look after the rest.')}</p>
    ${pending}
    ${link ? `<p style="margin:14px 0 0;font-size:12.5px;line-height:1.65;color:#325099;opacity:0.75;">Need a different time? <a href="${link}" style="color:#325099;">Change it here</a>, or just reply to this email.</p>` : ''}
    <p style="margin:28px 0 0;font-size:15px;line-height:1.7;">${rich('Kind regards,\nThe CUBE Team')}</p>`)
}

/*
 * The trial invitation the level test results email carries — one email for
 * the report and the next step. The same block as the pipeline's trial
 * invitation (lib/trialInvitationEmail trialClassesBlockHtml): the suggested
 * class with its first lesson, the alternatives, the "Choose a trial class"
 * button — worded "based on the level test".
 */
export function trialOfferHtml({ link, sections = [], studentName }) {
  if (!link) return ''
  const first = String(studentName || '').trim().split(/\s+/)[0] || 'your child'
  const cards = cardsFromFormSections(sections)
  const multi = cards.length > 1
  const c = mergeTrialInvitationContent({}, multi, { levelTest: true })
  return `
    <div style="margin:28px 0 0;padding-top:24px;border-top:1px solid #DEE7FF;">
      ${trialClassesBlockHtml({ c, vars: { studentName: first }, proposal: cards[0]?.proposal || null, alternatives: cards[0]?.alternatives || [], sections: multi ? cards : null, formLink: link })}
    </div>`
}
export const trialOfferText = ({ link, studentName }) => (link
  ? `\n\nNext step: ${String(studentName || '').trim().split(/\s+/)[0] || 'your child'}’s free trial (two lessons). Choose a trial class here: ${link}`
  : '')

/*
 * The 1:1 note in report emails.
 *
 * Written reports cover group classes only — 1:1 tutoring has none — so a
 * family whose child also takes a 1:1 course gets one sentence saying so,
 * and every other family gets nothing. Shared by the email page (preview and
 * per-family editor) and the send route, so what is previewed is what is sent.
 *
 * The template can place it with {{one_on_one_note}}. A template saved before
 * the placeholder existed has no slot for it, so there the sentence goes in
 * as its own paragraph just before the sign-off.
 */

export const ONE_ON_ONE_PLACEHOLDER = '{{one_on_one_note}}'

const possessive = (name) => `${name}’s`
function joinNames(names) {
  if (names.length <= 1) return names[0] || ''
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

// `firstNames` are the children with a 1:1 enrolment this term; `reportCount`
// is how many reports are attached (for "report" / "reports").
export function oneOnOneNote(firstNames = [], reportCount = 1) {
  const names = [...new Set(firstNames.filter(Boolean))]
  if (!names.length) return ''
  return `Please note that written reports are not provided for 1:1 tutoring, so ${joinNames(names.map(possessive))} 1:1 lessons are not covered in the attached report${reportCount > 1 ? 's' : ''}.`
}

const SIGN_OFF = /^(kind|warm|best|many)?\s*(regards|wishes|thanks)|^thank you|^cheers|^sincerely|^yours/i

/**
 * Put the note into a body. `autoInsert` is for the shared template only: a
 * per-family personalised body is sent verbatim, and its pre-fill already
 * carries the note, so inserting again would repeat it.
 */
export function applyOneOnOneNote(text, note, { autoInsert = true } = {}) {
  const body = String(text || '')
  if (body.includes(ONE_ON_ONE_PLACEHOLDER)) {
    return body
      .split(ONE_ON_ONE_PLACEHOLDER).join(note)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')     // an emptied placeholder leaves no gap
      .trim()
  }
  if (!note || !autoInsert) return body
  const paras = body.split(/\n{2,}/)
  // The sign-off is a short closing line ("Kind regards,") near the end — not
  // an opening "Thank you so much for being part of…" paragraph.
  const isSignOff = (p) => { const first = p.trim().split('\n')[0]; return first.length <= 30 && SIGN_OFF.test(first) }
  let at = paras.findLastIndex(isSignOff)
  if (at < 0) at = paras.length
  paras.splice(at, 0, note)
  return paras.join('\n\n')
}

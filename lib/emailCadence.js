import { supabase } from './supabase'

/*
 * Email send-cadence — single source shared by the Emails hub (editable guide)
 * and the Action Centre (📧 Emails actionables).
 *
 * Stored in portal_settings under CADENCE_KEY, one row per line:
 *   When | Email | Notes
 * Rows whose "When" starts with "Week N" (or "Week N–M") become actionables
 * during that week of the current term. Weeks are 1-based from term start
 * ("Week 1" = the first seven days), matching the calendar's "W{n}" labels and
 * lessons.week. Non-week rows (e.g. "New family enrols") are guidance only.
 */

export const CADENCE_KEY = 'email_cadence_guide'
export const CADENCE_DONE_KEY = (termId) => `email_cadence_done_${termId}`

export const DEFAULT_CADENCE = `Week 1 (term start) | Term Start | Confirm classes + invoice. Add one line: "Ask us about referral & sibling discounts."
Week 2 | Discount Program | Families settled, invoices paid — best moment for the referral email. Never in invoice week.
Week 7–8 | Re-enrolment reminder | Re-enrol for next term; restate multi-course discount ("a second subject saves $100").
Week 10 | End-of-Term Reports | Reports attached; goodwill peak. PS line: "Know a family who'd benefit? You both get $50 off."
New family enrols | Welcome email | Include the referral one-liner from day one.`

export function parseCadence(text) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean).map((line, idx) => {
    const [when = '', email = '', notes = ''] = line.split('|').map(p => p.trim())
    const m = when.match(/^week\s*(\d+)(?:\s*[–\-—]\s*(\d+))?/i)
    return {
      key: `${idx}:${email}`,
      when, email, notes,
      weekFrom: m ? Number(m[1]) : null,
      weekTo:   m ? Number(m[2] ?? m[1]) : null,
    }
  })
}

// Map a cadence email name to the page that sends it.
export function cadenceHref(email) {
  const e = (email || '').toLowerCase()
  if (e.includes('discount')) return '/tutor/emails/discount-program'
  if (e.includes('report'))   return '/tutor/emails/end-of-term'
  if (e.includes('term start') || e.includes('re-enrol') || e.includes('reenrol')) return '/tutor/emails/term-start'
  return '/tutor/emails'
}

/** 1-based week number of the current term for a given date (matches the
 *  calendar's "W{n}" and lessons.week, so cadence "Week 10" = the 10th week). */
export function termWeek(term, dateIso) {
  if (!term?.start_date) return null
  const days = Math.floor((new Date(dateIso) - new Date(term.start_date)) / 86400000)
  return days < 0 ? null : Math.floor(days / 7) + 1
}

/**
 * Cadence rows due in the current term week, excluding rows already marked
 * done for this term. Returns { due: [...rows], doneKeys }.
 */
export async function dueCadenceEmails(term, dateIso) {
  if (!term) return { due: [], doneKeys: [] }
  const week = termWeek(term, dateIso)
  if (week === null) return { due: [], doneKeys: [] }

  const [{ data: cadRow }, { data: doneRow }] = await Promise.all([
    supabase.from('portal_settings').select('value').eq('key', CADENCE_KEY).maybeSingle(),
    supabase.from('portal_settings').select('value').eq('key', CADENCE_DONE_KEY(term.id)).maybeSingle(),
  ])
  const rows = parseCadence(cadRow?.value || DEFAULT_CADENCE)
  let doneKeys = []
  try { doneKeys = JSON.parse(doneRow?.value || '[]') } catch {}

  const due = rows.filter(r =>
    r.weekFrom !== null && week >= r.weekFrom && week <= r.weekTo && !doneKeys.includes(r.key))
  return { due, doneKeys, week }
}

/** Mark a cadence row done for this term (shared between directors). */
export async function markCadenceDone(termId, rowKey) {
  const key = CADENCE_DONE_KEY(termId)
  const { data } = await supabase.from('portal_settings').select('value').eq('key', key).maybeSingle()
  let done = []
  try { done = JSON.parse(data?.value || '[]') } catch {}
  if (!done.includes(rowKey)) done.push(rowKey)
  await supabase.from('portal_settings').upsert({ key, value: JSON.stringify(done), updated_at: new Date().toISOString() })
}

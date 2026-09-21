import { supabase } from './supabase'
import { fmtSince, fmtDate } from './format'

/*
 * Who last changed a tutor's availability, and when.
 *
 * teacher_availability holds one row per (tutor, day, slot) and a slot is
 * removed by DELETING its row, so the table can't answer the question itself:
 * a tutor who trimmed their hours — or pressed "Clear all" — leaves nothing
 * newer behind. The answer is stamped on the tutor instead, by every page that
 * can change availability.
 */

/**
 * Stamp a tutor's availability as just changed. Fire-and-forget: the
 * availability itself is already saved, so a failed stamp must not fail the
 * toggle — it only costs the "last updated" line its accuracy.
 */
export async function touchAvailability(tutorId, byName) {
  if (!tutorId) return null
  const at = new Date().toISOString()
  const { error } = await supabase.from('tutors')
    .update({ availability_updated_at: at, availability_updated_by: byName || null })
    .eq('id', tutorId)
  if (error) { console.warn('availability stamp failed:', error.message); return null }
  return at
}

/**
 * "Updated 5 days ago" · "Updated 3 weeks ago by Ryan" · "Never updated".
 *
 * Names the person when it wasn't the tutor themselves, so a director tidying
 * a grid can't be mistaken for the teacher confirming their own hours. Rows
 * backfilled from the old data have no name, and read as the plain form.
 */
export function availabilityUpdatedLabel(tutor) {
  const at = tutor?.availability_updated_at
  if (!at) return 'Never updated'
  const by = String(tutor.availability_updated_by || '').trim()
  const self = !by || by.toLowerCase() === String(tutor.full_name || '').trim().toLowerCase()
  return `Updated ${fmtSince(at)}${self ? '' : ` by ${by.split(' ')[0]}`}`
}

/** The exact timestamp, for a title tooltip behind the relative wording. */
export const availabilityUpdatedExact = (tutor) => {
  const at = tutor?.availability_updated_at
  if (!at) return 'This tutor has not changed their availability since we started recording it.'
  const d = new Date(at)
  return `${fmtDate(at)}, ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
}

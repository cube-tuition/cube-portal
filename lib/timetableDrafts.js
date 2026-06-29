import { supabase } from './supabase'

/*
 * Persistent timetable drafts (see migrations/20260627_timetable_drafts.sql).
 *
 * A draft is a saved, independent scratch plan for a term: an arrangement of
 * class cards plus which ones are hidden. Editing a draft NEVER touches the live
 * `classes` table — staff save and resume drafts freely, and only an explicit
 * "Apply to live" pushes the arrangement back onto real class rows.
 */

const TABLE = 'timetable_drafts'

// The fields of a class card we persist inside a draft's `entries`.
const ENTRY_FIELDS = ['id', 'class_name', 'course_id', 'teacher', 'room', 'day_of_week', 'start_time', 'end_time', 'term_id']

function pickEntry(e) {
  const o = {}
  for (const f of ENTRY_FIELDS) o[f] = e?.[f] ?? null
  // Draft roster (student ids) — applied to real enrolments on "Apply to live".
  o.student_ids = Array.isArray(e?.student_ids) ? e.student_ids : []
  return o
}

// Lightweight list for the draft picker.
export async function listDrafts(termId) {
  if (!termId) return []
  const { data, error } = await supabase.from(TABLE)
    .select('id, name, updated_at')
    .eq('term_id', termId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function loadDraft(id) {
  if (!id) return null
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    ...data,
    entries: Array.isArray(data.entries) ? data.entries : [],
    hidden_ids: Array.isArray(data.hidden_ids) ? data.hidden_ids : [],
  }
}

export async function createDraft({ termId, name, entries = [], hiddenIds = [], createdBy = null }) {
  const { data, error } = await supabase.from(TABLE).insert({
    term_id: termId,
    name: name || 'Untitled draft',
    entries: (entries || []).map(pickEntry),
    hidden_ids: hiddenIds || [],
    created_by: createdBy,
  }).select('id, name, updated_at').single()
  if (error) throw error
  return data
}

export async function saveDraft(id, { entries, hiddenIds, name } = {}) {
  if (!id) return
  const patch = { updated_at: new Date().toISOString() }
  if (entries != null)  patch.entries = entries.map(pickEntry)
  if (hiddenIds != null) patch.hidden_ids = hiddenIds
  if (name != null)     patch.name = name
  const { error } = await supabase.from(TABLE).update(patch).eq('id', id)
  if (error) throw error
}

export async function renameDraft(id, name) {
  const { error } = await supabase.from(TABLE).update({ name, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteDraft(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw error
}

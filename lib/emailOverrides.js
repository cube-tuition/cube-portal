import { supabase } from './supabase'
import { T_EMAIL_TEMPLATE_OVERRIDES } from './tables'

/*
 * Per-family email body overrides — shared by the end-of-term report and
 * term-start email pages. When a family has an override, that exact body is
 * sent instead of the shared template (placeholders are already resolved into
 * the stored text). Keyed by (term_id, email_type, family_key).
 *
 *   email_type: 'end_of_term' | 'term_start'
 *   family_key: a stable per-family key — use familyKey(family) below.
 */

// Stable key for a family grouping. Families with a family_id key on it;
// single-student "families" (no family_id) key on the student id. Mirrors the
// grouping the email pages already use.
export function familyKey(family) {
  if (family?.family_id != null && family.family_id !== '') return `fam:${family.family_id}`
  const sid = family?.students?.[0]?.student_id ?? family?.student_ids?.[0]
  return `stu:${sid ?? 'unknown'}`
}

// Load all overrides for a term + email type → { [family_key]: body }.
export async function loadEmailOverrides(termId, emailType) {
  if (!termId) return {}
  const { data, error } = await supabase
    .from(T_EMAIL_TEMPLATE_OVERRIDES)
    .select('family_key, body')
    .eq('term_id', termId)
    .eq('email_type', emailType)
  if (error) { console.error('[loadEmailOverrides]', error.message); return {} }
  const map = {}
  for (const r of data || []) map[r.family_key] = r.body
  return map
}

// Upsert one family's custom body.
export async function saveEmailOverride(termId, emailType, key, body, updatedBy) {
  return supabase.from(T_EMAIL_TEMPLATE_OVERRIDES).upsert({
    term_id: termId, email_type: emailType, family_key: key,
    body, updated_by: updatedBy || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'term_id,email_type,family_key' })
}

// Remove a family's override (revert to the shared template).
export async function deleteEmailOverride(termId, emailType, key) {
  return supabase.from(T_EMAIL_TEMPLATE_OVERRIDES)
    .delete()
    .eq('term_id', termId)
    .eq('email_type', emailType)
    .eq('family_key', key)
}

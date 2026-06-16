import { supabase } from './supabase'
import { T_QBANK_RUBRICS } from './tables'

/*
 * Marking rubrics — flexible, data-driven band-descriptor grids (for English
 * writing papers, but usable anywhere). Nothing about the bands or criteria is
 * hardcoded; the whole shape lives in the row.
 *
 *   rubric = {
 *     id, name,
 *     bands:    [{ label, marks }, ...]                     // columns, any count
 *     criteria: [{ name, max, cells: [str, ...] }]          // cells[i] ↔ bands[i]
 *   }
 */

export const blankBands = () => ([
  { label: '4', marks: 4 }, { label: '3', marks: 3 },
  { label: '2', marks: 2 }, { label: '1', marks: 1 }, { label: '0', marks: 0 },
])

export const blankCriterion = (bandCount) => ({
  name: '', max: 4, cells: Array.from({ length: bandCount }, () => ''),
})

// Keep every criterion's cells array the same length as the bands array.
export function normaliseRubric(r) {
  const bands = Array.isArray(r?.bands) && r.bands.length ? r.bands : blankBands()
  const n = bands.length
  const criteria = (Array.isArray(r?.criteria) ? r.criteria : []).map((c) => {
    const cells = Array.isArray(c.cells) ? c.cells.slice(0, n) : []
    while (cells.length < n) cells.push('')
    return { name: c.name || '', max: c.max ?? 4, cells }
  })
  return { ...r, bands, criteria }
}

export async function listRubrics() {
  const { data } = await supabase.from(T_QBANK_RUBRICS)
    .select('id, name, bands, criteria, updated_at').order('name')
  return (data || []).map(normaliseRubric)
}

export async function loadRubric(id) {
  const { data } = await supabase.from(T_QBANK_RUBRICS).select('*').eq('id', id).maybeSingle()
  return data ? normaliseRubric(data) : null
}

export async function createRubric(createdBy) {
  const { data, error } = await supabase.from(T_QBANK_RUBRICS)
    .insert({ name: 'Untitled rubric', bands: blankBands(), criteria: [], created_by: createdBy || null })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function saveRubric(r) {
  const clean = normaliseRubric(r)
  const { error } = await supabase.from(T_QBANK_RUBRICS).update({
    name: clean.name || 'Untitled rubric',
    bands: clean.bands, criteria: clean.criteria,
    updated_at: new Date().toISOString(),
  }).eq('id', r.id)
  if (error) throw error
}

// Promote an inline/custom rubric object into a saved library rubric.
export async function createRubricFrom(obj, createdBy) {
  const r = normaliseRubric(obj || {})
  const { data, error } = await supabase.from(T_QBANK_RUBRICS)
    .insert({ name: r.name || 'Custom rubric', bands: r.bands, criteria: r.criteria, created_by: createdBy || null })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function duplicateRubric(id) {
  const r = await loadRubric(id)
  if (!r) return null
  const { data, error } = await supabase.from(T_QBANK_RUBRICS)
    .insert({ name: `${r.name} (copy)`, bands: r.bands, criteria: r.criteria }).select('id').single()
  if (error) throw error
  return data.id
}

export async function deleteRubric(id) {
  await supabase.from(T_QBANK_RUBRICS).delete().eq('id', id)
}

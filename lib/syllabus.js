import { supabase } from './supabase'
import { T_SYLLABUS_MODULES, T_SYLLABUS_TOPICS, T_SYLLABUS_DOTPOINTS, T_BOOKLET_BUILDS, T_BOOKLETS } from './tables'

/*
 * Master syllabus dotpoint list.
 *
 * Hierarchy: Subject + Year → Module → Topic (with an inquiry question) →
 * Dotpoint → Subdotpoint (a dotpoint with parent_id set).
 *
 * Booklets draw individual dotpoints/subdotpoints by id (stored in
 * booklet_builds.syllabus_points). When a subdotpoint is drawn, its parent main
 * dotpoint is always shown above it (see buildSelectedContent).
 */

// Distinct subjects that have a syllabus (Chemistry for now).
export async function fetchSyllabusSubjects() {
  const { data } = await supabase.from(T_SYLLABUS_MODULES)
    .select('subject, year').order('subject').order('year')
  const seen = new Set(); const out = []
  for (const r of data || []) {
    const key = `${r.subject}|${r.year}`
    if (!seen.has(key)) { seen.add(key); out.push({ subject: r.subject, year: r.year }) }
  }
  return out
}

// Full nested syllabus for one subject+year:
// [{ ...module, topics: [{ ...topic, dotpoints: [{ ...main, subs: [...] }] }] }]
export async function fetchSyllabus(subject, year) {
  const { data: modules } = await supabase.from(T_SYLLABUS_MODULES)
    .select('*').eq('subject', subject).eq('year', Number(year)).order('sort_order')
  if (!modules?.length) return []
  const moduleIds = modules.map((m) => m.id)
  const { data: topics } = await supabase.from(T_SYLLABUS_TOPICS)
    .select('*').in('module_id', moduleIds).order('sort_order')
  const topicIds = (topics || []).map((t) => t.id)
  const { data: dotpoints } = topicIds.length
    ? await supabase.from(T_SYLLABUS_DOTPOINTS).select('*').in('topic_id', topicIds).order('sort_order')
    : { data: [] }

  const subsByParent = {}
  const mainsByTopic = {}
  for (const d of dotpoints || []) {
    if (d.parent_id) (subsByParent[d.parent_id] ||= []).push(d)
    else (mainsByTopic[d.topic_id] ||= []).push(d)
  }
  const topicsByModule = {}
  for (const t of topics || []) {
    const mains = (mainsByTopic[t.id] || []).map((m) => ({ ...m, subs: subsByParent[m.id] || [] }))
    ;(topicsByModule[t.module_id] ||= []).push({ ...t, dotpoints: mains })
  }
  return modules.map((m) => ({ ...m, topics: topicsByModule[m.id] || [] }))
}

// All dotpoint rows (main + sub) flat, for a subject+year — handy for lookups.
export function flattenDotpoints(modules) {
  const out = []
  for (const m of modules) for (const t of m.topics) for (const d of t.dotpoints) {
    out.push(d); for (const s of d.subs) out.push(s)
  }
  return out
}

// ── Coverage (derived from booklet usage) ────────────────────────────────────
// A dotpoint is "covered" when it's been drawn into a booklet's Content tab —
// there's no manual ticking. Both booklet sources count: builder booklets
// (booklet_builds) and master-DB booklets created with the syllabus picker
// (booklets.syllabus_points). Returns a map: dotpointId → [booklet titles].
export async function fetchDotpointCoverage() {
  const [{ data: builds }, { data: booklets }] = await Promise.all([
    supabase.from(T_BOOKLET_BUILDS).select('title, syllabus_points'),
    supabase.from(T_BOOKLETS).select('booklet_name, syllabus_points').not('syllabus_points', 'is', null),
  ])
  const map = {}
  const add = (pts, title) => {
    for (const id of Array.isArray(pts) ? pts : []) (map[id] ||= []).push(title || 'Untitled booklet')
  }
  for (const b of builds || []) add(b.syllabus_points, b.title)
  for (const b of booklets || []) add(b.syllabus_points, b.booklet_name)
  return map
}

// ── Editing the master list ──────────────────────────────────────────────────
export async function addModule(subject, year, name, sortOrder) {
  const { data } = await supabase.from(T_SYLLABUS_MODULES)
    .insert({ subject, year: Number(year), name, sort_order: sortOrder ?? 0 }).select('id').single()
  return data?.id
}
export async function addTopic(moduleId, name, inquiry, sortOrder) {
  const { data } = await supabase.from(T_SYLLABUS_TOPICS)
    .insert({ module_id: moduleId, name, inquiry_question: inquiry || null, sort_order: sortOrder ?? 0 }).select('id').single()
  return data?.id
}
export async function addDotpoint(topicId, text, parentId, sortOrder) {
  const { data } = await supabase.from(T_SYLLABUS_DOTPOINTS)
    .insert({ topic_id: topicId, parent_id: parentId || null, text, sort_order: sortOrder ?? 0 }).select('id').single()
  return data?.id
}
export async function renameRow(table, id, fields) {
  await supabase.from(table).update(fields).eq('id', id)
}
export async function deleteRow(table, id) {
  await supabase.from(table).delete().eq('id', id)
}
// Swap sort_order with the adjacent sibling (dir -1 up / +1 down).
export async function moveRow(table, list, item, dir) {
  const idx = list.findIndex((x) => x.id === item.id)
  const swap = list[idx + dir]
  if (!swap) return
  await Promise.all([
    supabase.from(table).update({ sort_order: swap.sort_order ?? 0 }).eq('id', item.id),
    supabase.from(table).update({ sort_order: item.sort_order ?? 0 }).eq('id', swap.id),
  ])
}

/*
 * Resolve a booklet's selected dotpoint ids into a grouped structure for display:
 *   [{ module, topics: [{ topic, entries: [{ main, subs, headerOnly }] }] }]
 * Rules:
 *  • a selected lone main dotpoint (no children) → shown on its own
 *  • selected subdotpoints → shown under their parent main dotpoint, which is
 *    always displayed above them (headerOnly = the main itself wasn't selected)
 *  • a main dotpoint selected together with children → main + all its subs
 */
export function buildSelectedContent(modules, selectedIds) {
  const set = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || [])
  const out = []
  for (const mod of modules) {
    const topicsOut = []
    for (const tp of mod.topics) {
      const entries = []
      for (const dp of tp.dotpoints) {
        const subs = dp.subs || []
        const selSubs = subs.filter((s) => set.has(s.id))
        const mainSel = set.has(dp.id)
        if (mainSel && subs.length === 0) {
          entries.push({ main: dp, subs: [], headerOnly: false })
        } else if (mainSel && subs.length > 0) {
          entries.push({ main: dp, subs, headerOnly: false })
        } else if (selSubs.length > 0) {
          entries.push({ main: dp, subs: selSubs, headerOnly: true })
        }
      }
      if (entries.length) topicsOut.push({ topic: tp, entries })
    }
    if (topicsOut.length) out.push({ module: mod, topics: topicsOut })
  }
  return out
}

/*
 * Render a selection (dotpoint ids) to the booklet section "syllabus" text used
 * by the printed band — same convention the renderer's rich() expects:
 *   "- <main dotpoint>"  and  "  - <subdotpoint>" (2-space indent → sub level).
 * A drawn subdotpoint always carries its parent main dotpoint above it.
 */
export function selectedToSyllabusText(modules, selectedIds) {
  const groups = buildSelectedContent(modules, selectedIds)
  const lines = []
  for (const g of groups) for (const tg of g.topics) for (const e of tg.entries) {
    lines.push(`- ${e.main.text}`)
    for (const s of e.subs) lines.push(`  - ${s.text}`)
  }
  return lines.join('\n')
}

// How many dotpoints (main leaves + subdotpoints) a selection actually draws.
export function countSelected(modules, selectedIds) {
  const set = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || [])
  let n = 0
  for (const m of modules) for (const t of m.topics) for (const d of t.dotpoints) {
    if (d.subs.length === 0) { if (set.has(d.id)) n++ }
    else { if (set.has(d.id)) n += d.subs.length; else n += d.subs.filter((s) => set.has(s.id)).length }
  }
  return n
}

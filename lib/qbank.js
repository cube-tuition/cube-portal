import { supabase } from './supabase'
import {
  T_QBANK_SUBJECTS, T_QBANK_TOPICS, T_QBANK_SUBTOPICS, T_QBANK_SKILLS, QBANK_BUCKET,
  T_QBANK_WORKSHEET_USAGE, T_QBANK_EXAM_SLOTS,
  T_QBANK_QUESTIONS, T_QBANK_QUESTION_PARTS, T_QBANK_QUESTION_IMAGES,
} from './tables'

/*
 * Question-bank data helpers.
 * Keeps Supabase calls for the taxonomy + image storage in one place so the
 * pages stay focused on UI.
 */

// Subject families for the resource-hub scope (?subject=Maths|English|Chemistry).
// The Maths family spans the junior subject plus the senior variants.
export const SUBJECT_FAMILIES = {
  Maths:     ['Maths', 'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths', 'Standard Maths'],
  English:   ['English'],
  Chemistry: ['Chemistry'],
}
export const SCOPE_LABEL = { Maths: 'Mathematics', English: 'English', Chemistry: 'Chemistry' }

/*
 * Difficulty scale. The pickers offer 1-4, but 106 questions in the bank carry
 * a 5 from bulk inserts made against a 1-5 scale, and a label/colour is looked
 * up by value all over the app — so 5 is named here too. Without it those
 * questions render as an unlabelled, uncoloured pill.
 */
export const DIFFICULTY_LABELS = {
  1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Very hard', 5: 'Extension',
}
// Difficulty values offered in the UI.
export const DIFFICULTY_LEVELS = [1, 2, 3, 4]
// The top of the scale actually present in the data, for averages.
export const DIFFICULTY_MAX = 5

// Question types
export const QTYPE = { EXTENDED: 'extended', MCQ: 'mcq' }
export const MCQ_LABELS = ['A', 'B', 'C', 'D']
export const DIFFICULTY_COLORS = {
  1: '#65A30D', 2: '#CA8A04', 3: '#EA580C', 4: '#DC2626', 5: '#9F1239',
}

// Public URL for an image stored in the qbank bucket.
export function qbankImageUrl(path) {
  if (!path) return null
  const { data } = supabase.storage.from(QBANK_BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? null
}

// Upload a File to the qbank bucket under a question-scoped path. Returns the path.
export async function uploadQbankImage(file, prefix = 'questions') {
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase()
  const rand = Math.random().toString(36).slice(2, 10)
  const path = `${prefix}/${Date.now()}-${rand}.${ext}`
  const { error } = await supabase.storage
    .from(QBANK_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  return path
}

export async function deleteQbankImage(path) {
  if (!path) return
  await supabase.storage.from(QBANK_BUCKET).remove([path])
}

// A fresh bucket path alongside an existing one, keeping its extension.
function siblingImagePath(path) {
  const ext = (path.split('.').pop() || 'png').toLowerCase()
  return `questions/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
}

/*
 * Duplicate a question — the row, its parts, its tag joins and its images.
 *
 * The copy is byte-identical to the original apart from ids and created_by; it
 * starts with no usage history, and nothing pointing at the original (exam
 * slots, worksheets, booklet blocks) is touched, so duplicating is purely
 * additive.
 *
 * Images are COPIED in storage rather than sharing the original's path:
 * deleting a question deletes its image objects, which would otherwise pull the
 * pictures out from under every copy. An image whose object has gone missing is
 * skipped and named in `warnings` rather than failing the whole duplicate.
 *
 * Rolls back the new question (children cascade) and its copied objects if any
 * step fails, so a half-built duplicate can never be left behind.
 *
 * Returns { id, warnings }.
 */
export async function duplicateQuestion(questionId, createdBy) {
  const { data: q, error: qErr } = await supabase
    .from(T_QBANK_QUESTIONS).select('*').eq('id', questionId).single()
  if (qErr) throw qErr

  const { id, created_at, updated_at, created_by, ...columns } = q

  const { data: made, error: insErr } = await supabase.from(T_QBANK_QUESTIONS)
    .insert({ ...columns, created_by: createdBy || null }).select('id').single()
  if (insErr) throw insErr
  const newId = made.id

  const warnings = []
  const copiedPaths = []
  try {
    // Parts, one at a time so each new id can be mapped back to the old one —
    // the images below hang off part ids.
    const { data: parts } = await supabase.from(T_QBANK_QUESTION_PARTS)
      .select('*').eq('question_id', questionId).order('sort_order')
    const partIdMap = {}
    for (const p of parts || []) {
      const { id: oldPartId, question_id, created_at: _c, updated_at: _u, ...partCols } = p
      const { data: newPart, error: pErr } = await supabase.from(T_QBANK_QUESTION_PARTS)
        .insert({ ...partCols, question_id: newId }).select('id').single()
      if (pErr) throw pErr
      partIdMap[oldPartId] = newPart.id
    }

    // Tag joins — plain (question_id, x_id) pairs.
    for (const [table, col] of [
      ['qbank_question_subtopics', 'subtopic_id'],
      ['qbank_question_skills', 'skill_id'],
      ['qbank_question_dotpoints', 'dotpoint_id'],
    ]) {
      const { data: rows } = await supabase.from(table).select(col).eq('question_id', questionId)
      if (rows?.length) {
        const { error: jErr } = await supabase.from(table)
          .insert(rows.map((r) => ({ question_id: newId, [col]: r[col] })))
        if (jErr) throw jErr
      }
    }

    const { data: images } = await supabase.from(T_QBANK_QUESTION_IMAGES)
      .select('*').eq('question_id', questionId).order('sort_order')
    for (const img of images || []) {
      const target = siblingImagePath(img.storage_path)
      const { error: cpErr } = await supabase.storage.from(QBANK_BUCKET).copy(img.storage_path, target)
      if (cpErr) { warnings.push(`Image "${img.alt || img.storage_path}" could not be copied — add it again on the copy.`); continue }
      copiedPaths.push(target)
      const { error: imErr } = await supabase.from(T_QBANK_QUESTION_IMAGES).insert({
        question_id: newId,
        part_id: img.part_id ? (partIdMap[img.part_id] ?? null) : null,
        storage_path: target,
        alt: img.alt ?? null,
        sort_order: img.sort_order ?? 0,
        role: img.role ?? 'stem',
      })
      if (imErr) throw imErr
    }
  } catch (e) {
    await supabase.from(T_QBANK_QUESTIONS).delete().eq('id', newId)   // children cascade
    if (copiedPaths.length) await supabase.storage.from(QBANK_BUCKET).remove(copiedPaths)
    throw e
  }

  return { id: newId, warnings }
}

// ── Taxonomy fetch ────────────────────────────────────────────────────────────
export async function fetchSubjects() {
  const { data } = await supabase.from(T_QBANK_SUBJECTS)
    .select('*').order('year_level').order('sort_order').order('name')
  return data || []
}
export async function fetchTopics() {
  const { data } = await supabase.from(T_QBANK_TOPICS)
    .select('*').order('sort_order').order('name')
  return data || []
}
export async function fetchSubtopics() {
  const { data } = await supabase.from(T_QBANK_SUBTOPICS)
    .select('*').order('sort_order').order('name')
  return data || []
}
export async function fetchSkills() {
  const { data } = await supabase.from(T_QBANK_SKILLS)
    .select('*').order('sort_order').order('name')
  return data || []
}

// Returns { subjects, topics, subtopics, skills, topicsBySubject,
//           subtopicsByTopic, skillsBySubtopic, skillsByTopic, skillsBySubject }.
// Skills are a subject-level dimension (subject_id); topic_id/subtopic_id are
// optional legacy tags, and their maps are kept for callers that narrow by them.
export async function fetchTaxonomy() {
  const [subjects, topics, subtopics, skills] = await Promise.all([
    fetchSubjects(), fetchTopics(), fetchSubtopics(), fetchSkills(),
  ])
  const topicsBySubject = {}
  const topicById = {}
  topics.forEach((t) => {
    topicById[t.id] = t
    ;(topicsBySubject[t.subject_id] ||= []).push(t)
  })
  const subtopicsByTopic = {}
  subtopics.forEach((st) => {
    (subtopicsByTopic[st.topic_id] ||= []).push(st)
  })
  const skillsBySubtopic = {}
  const skillsByTopic = {}
  const skillsBySubject = {}
  skills.forEach((s) => {
    if (s.subtopic_id) (skillsBySubtopic[s.subtopic_id] ||= []).push(s)
    if (s.topic_id) (skillsByTopic[s.topic_id] ||= []).push(s)
    const subjId = s.subject_id || topicById[s.topic_id]?.subject_id
    if (subjId) (skillsBySubject[subjId] ||= []).push(s)
  })
  return {
    subjects, topics, subtopics, skills,
    topicsBySubject, subtopicsByTopic, skillsBySubtopic, skillsByTopic, skillsBySubject,
  }
}

// Distinct, sorted year levels present in the subject list.
export function yearsFromSubjects(subjects) {
  return [...new Set(subjects.map((s) => s.year_level))].sort((a, b) => a - b)
}

// ── Taxonomy lookup helpers ───────────────────────────────────────────────────
// Shared by the list page, worksheet builder and exam builder (was copy-pasted
// into each). Build once per taxonomy load:
//   const maps = useMemo(() => buildTaxonomyMaps(tax), [tax])
export function buildTaxonomyMaps(tax) {
  if (!tax) return null
  return {
    skill: Object.fromEntries(tax.skills.map((s) => [s.id, s])),
    subtopic: Object.fromEntries(tax.subtopics.map((st) => [st.id, st])),
    topic: Object.fromEntries(tax.topics.map((t) => [t.id, t])),
    subject: Object.fromEntries(tax.subjects.map((s) => [s.id, s])),
  }
}

// Resolve a question's full classification { skill, subtopic, topic, subject },
// preferring the skill's chain and falling back to the question's own legacy
// subtopic_id / topic_id columns.
export function labelForQuestion(q, maps) {
  if (!maps) return null
  const sk = maps.skill[q.skill_id]
  const stp = (sk && maps.subtopic[sk.subtopic_id]) || maps.subtopic[q.subtopic_id]
  const tp = (stp && maps.topic[stp.topic_id]) || (sk && maps.topic[sk.topic_id]) || maps.topic[q.topic_id]
  const su = (tp && maps.subject[tp.subject_id]) || (sk && maps.subject[sk.subject_id])
  return { skill: sk, subtopic: stp, topic: tp, subject: su }
}

// ── Marking criteria (solutions PDF) ──────────────────────────────────────────
// A question/part worth >1 mark gets a banded marking guideline (full → 1). The
// top band is always "Provides correct answer"; lower bands auto-generate
// generic text unless the tutor overrides them.
export const TOP_CRITERION = 'Provides correct answer'

export function defaultCriterion(markValue, maxMarks) {
  if (markValue >= maxMarks) return TOP_CRITERION
  if (markValue === 1) return 'Provides some relevant working, or equivalent merit'
  if (markValue === maxMarks - 1) return 'Provides a substantially correct answer, or equivalent merit'
  return 'Provides a partially correct answer, or equivalent merit'
}

// Ordered bands (full marks → 1) for a mark total, applying overrides (object
// keyed by mark value). Returns [{ marks, text }, …].
export function criteriaBands(maxMarks, overrides = {}) {
  const o = overrides || {}
  const bands = []
  for (let m = Number(maxMarks) || 0; m >= 1; m--) {
    const text = m === maxMarks ? TOP_CRITERION : (o[m] ?? o[String(m)] ?? defaultCriterion(m, maxMarks))
    bands.push({ marks: m, text })
  }
  return bands
}

// ── Usage tracking ────────────────────────────────────────────────────────────
// A question is "used" if it sits in a saved exam slot (live) or was exported in
// a worksheet (logged). Returns a map: questionId → { exams:[{id,title,date}],
// worksheets:[{title,used_at}], count, lastUsed }.
export async function fetchQuestionUsage(ids = null) {
  let wq = supabase.from(T_QBANK_WORKSHEET_USAGE).select('question_id, title, used_at')
  let eq = supabase.from(T_QBANK_EXAM_SLOTS)
    .select('question_id, qbank_exam_sections(qbank_exams(id, title, updated_at))')
    .not('question_id', 'is', null)
  if (ids && ids.length) { wq = wq.in('question_id', ids); eq = eq.in('question_id', ids) }
  const [{ data: ws }, { data: sl }] = await Promise.all([wq, eq])

  const map = {}
  const entry = (qid) => (map[qid] ||= { exams: [], worksheets: [] })
  ;(ws || []).forEach((r) => entry(r.question_id).worksheets.push({ title: r.title, used_at: r.used_at }))
  ;(sl || []).forEach((r) => {
    const ex = r.qbank_exam_sections?.qbank_exams
    if (!ex) return
    const m = entry(r.question_id)
    if (!m.exams.some((e) => e.id === ex.id)) m.exams.push({ id: ex.id, title: ex.title, date: ex.updated_at })
  })
  Object.values(map).forEach((m) => {
    m.count = m.exams.length + m.worksheets.length
    const dates = [...m.exams.map((e) => e.date), ...m.worksheets.map((w) => w.used_at)].filter(Boolean).sort()
    m.lastUsed = dates.length ? dates[dates.length - 1] : null
  })
  return map
}

// Log a worksheet export against each included question.
export async function logWorksheetUsage(questions, title, usedBy) {
  const rows = (questions || []).filter((q) => q?.id).map((q) => ({
    question_id: q.id, title: title || null, used_by: usedBy || null,
  }))
  if (rows.length) await supabase.from(T_QBANK_WORKSHEET_USAGE).insert(rows)
}

/*
 * The question ids a worksheet holds. `question_ids` is a jsonb array whose
 * entries are either a bare id or { id, lines } once a sheet has had working
 * space added, so both shapes have to be unwrapped.
 */
export function worksheetQuestionIds(ws) {
  const entries = Array.isArray(ws?.question_ids) ? ws.question_ids : []
  return entries.map((e) => (typeof e === 'string' ? e : e?.id)).filter(Boolean)
}

/*
 * How a worksheet's questions break down by subtopic and by skill — what the
 * Materials topic pages show under each Additional Questions row.
 *
 * Tags are read the way QuestionEditor reads them: the qbank_question_subtopics
 * / qbank_question_skills join tables are the live multi-tag store, and the
 * questions' own subtopic_id / skill_id columns are the legacy single, used
 * only when a question has no join rows. Counting either source alone would
 * disagree with what the editor shows on the question.
 *
 * A question carrying two subtopics counts once under each, so a tally can add
 * up past the number of questions — the caller says so where it renders them.
 * Questions with nothing tagged are returned as `untagged` rather than dropped,
 * so the numbers still account for every question on the sheet.
 *
 * Also returns the mean difficulty over the questions that carry one.
 *
 * Returns { [worksheetId]: { total, subtopics: [{label,n}], skills: [...],
 *                            untaggedSubtopics, untaggedSkills,
 *                            avgDifficulty, ratedQuestions } }.
 */
export async function fetchWorksheetTagCounts(worksheets) {
  const sheets = (worksheets || []).map((ws) => ({ id: ws.id, qids: worksheetQuestionIds(ws) }))
  const allIds = [...new Set(sheets.flatMap((s) => s.qids))]
  const empty = () => ({ total: 0, subtopics: [], skills: [], untaggedSubtopics: 0, untaggedSkills: 0, avgDifficulty: null, ratedQuestions: 0 })
  if (!allIds.length) return Object.fromEntries(sheets.map((s) => [s.id, empty()]))

  // Chunked: a few hundred uuids in one .in() makes a URL long enough to be
  // refused, and PostgREST caps a page at 1000 rows.
  const chunks = []
  for (let i = 0; i < allIds.length; i += 100) chunks.push(allIds.slice(i, i + 100))
  const gather = async (table, cols) => {
    const out = []
    for (const ids of chunks) {
      const { data, error } = await supabase.from(table).select(cols).in('question_id', ids)
      if (error) throw new Error(`${table}: ${error.message}`)
      out.push(...(data || []))
    }
    return out
  }

  const [qs, stJoin, skJoin, subtopics, skills, topics] = await Promise.all([
    (async () => {
      const out = []
      for (const ids of chunks) {
        const { data, error } = await supabase.from(T_QBANK_QUESTIONS)
          .select('id, subtopic_id, skill_id, difficulty').in('id', ids)
        if (error) throw new Error(`questions: ${error.message}`)
        out.push(...(data || []))
      }
      return out
    })(),
    gather('qbank_question_subtopics', 'question_id, subtopic_id'),
    gather('qbank_question_skills', 'question_id, skill_id'),
    supabase.from(T_QBANK_SUBTOPICS).select('id, name, topic_id').then(({ data }) => data || []),
    supabase.from(T_QBANK_SKILLS).select('id, name, topic_id').then(({ data }) => data || []),
    supabase.from(T_QBANK_TOPICS).select('id, name').then(({ data }) => data || []),
  ])

  const topicName = Object.fromEntries(topics.map((t) => [t.id, t.name]))

  /*
   * A readable label for a tag.
   *
   * Most of the taxonomy's subtopics are a per-topic catch-all literally named
   * "General" (56 of 85 at the time of writing), so the bare name is useless —
   * show the topic instead. Names that repeat across topics ("Problem Solving",
   * "Word problems") get the topic prefixed; the rest stand alone.
   */
  const labeller = (rows) => {
    const seen = {}
    rows.forEach((r) => { seen[r.name] = (seen[r.name] || 0) + 1 })
    return Object.fromEntries(rows.map((r) => {
      const topic = topicName[r.topic_id]
      const label = /^general$/i.test(r.name || '')
        ? (topic || r.name)
        : (seen[r.name] > 1 && topic ? `${topic} · ${r.name}` : r.name)
      return [r.id, label]
    }))
  }
  const stLabel = labeller(subtopics)
  const skLabel = labeller(skills)

  const group = (rows, col) => rows.reduce((m, r) => {
    if (r[col]) (m[r.question_id] ||= []).push(r[col])
    return m
  }, {})
  const stByQ = group(stJoin, 'subtopic_id')
  const skByQ = group(skJoin, 'skill_id')
  const qById = Object.fromEntries(qs.map((q) => [q.id, q]))

  // Join rows win; the legacy column is the fallback for an untouched question.
  const tagsFor = (qid, byQ, legacyCol) => {
    const joined = byQ[qid]
    if (joined?.length) return [...new Set(joined)]
    const legacy = qById[qid]?.[legacyCol]
    return legacy ? [legacy] : []
  }

  // Same label from two different ids (two topics' "General" under one topic
  // name) is one line, not two — merge on the label rather than the id.
  const rank = (counts, labels) => {
    const byLabel = {}
    Object.entries(counts).forEach(([id, n]) => {
      const label = labels[id] || 'Unknown'
      byLabel[label] = (byLabel[label] || 0) + n
    })
    return Object.entries(byLabel)
      .map(([label, n]) => ({ label, n }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  }

  return Object.fromEntries(sheets.map((s) => {
    const st = {}, sk = {}
    let untaggedSubtopics = 0, untaggedSkills = 0
    for (const qid of s.qids) {
      const stIds = tagsFor(qid, stByQ, 'subtopic_id')
      const skIds = tagsFor(qid, skByQ, 'skill_id')
      if (stIds.length) stIds.forEach((id) => { st[id] = (st[id] || 0) + 1 }); else untaggedSubtopics++
      if (skIds.length) skIds.forEach((id) => { sk[id] = (sk[id] || 0) + 1 }); else untaggedSkills++
    }
    // Mean over the questions that carry a difficulty. Questions left unrated
    // are excluded rather than counted as easy, and `ratedQuestions` says how
    // many the average actually rests on.
    const rated = s.qids.map((id) => qById[id]?.difficulty).filter((d) => Number.isFinite(d))
    return [s.id, {
      total: s.qids.length,
      subtopics: rank(st, stLabel), skills: rank(sk, skLabel),
      untaggedSubtopics, untaggedSkills,
      avgDifficulty: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null,
      ratedQuestions: rated.length,
    }]
  }))
}

/*
 * A worksheet's questions, in the order the sheet stores them and in the shape
 * exportWorksheet expects — parts and images embedded, and the per-question
 * working-line override reattached as `_workingLines`.
 *
 * The worksheet builder assembles exactly this from state it already holds;
 * anywhere else (the Materials topic pages) has to load it, and the PDF is only
 * the same document if the shape is. Hence one loader rather than two.
 */
export async function loadWorksheetQuestions(ws) {
  const entries = Array.isArray(ws?.question_ids) ? ws.question_ids : []
  const ids = entries.map((e) => (typeof e === 'string' ? e : e?.id)).filter(Boolean)
  if (!ids.length) return []

  const rows = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from(T_QBANK_QUESTIONS)
      .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)')
      .in('id', ids.slice(i, i + 100))
    if (error) throw new Error(`worksheet questions: ${error.message}`)
    rows.push(...(data || []))
  }
  const byId = Object.fromEntries(rows.map((q) => [q.id, q]))
  const linesById = Object.fromEntries(entries
    .map((e) => [(typeof e === 'string' ? e : e?.id), (typeof e === 'string' ? null : (e?.lines || null))])
    .filter(([k, v]) => k && v))

  // Ordered by the sheet, not by the fetch — .in() returns rows in whatever
  // order the database likes.
  return ids.map((id) => byId[id]).filter(Boolean)
    .map((q) => (linesById[q.id] ? { ...q, _workingLines: linesById[q.id] } : q))
}

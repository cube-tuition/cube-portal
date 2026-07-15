import { supabase } from './supabase'
import {
  T_QBANK_SUBJECTS, T_QBANK_TOPICS, T_QBANK_SUBTOPICS, T_QBANK_SKILLS, QBANK_BUCKET,
  T_QBANK_WORKSHEET_USAGE, T_QBANK_EXAM_SLOTS,
} from './tables'

/*
 * Question-bank data helpers.
 * Keeps Supabase calls for the taxonomy + image storage in one place so the
 * pages stay focused on UI.
 */

// Difficulty scale 1-4 (1=Easy, 2=Medium, 3=Hard, 4=Very hard).
export const DIFFICULTY_LABELS = {
  1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Very hard',
}
// Difficulty values offered in the UI.
export const DIFFICULTY_LEVELS = [1, 2, 3, 4]

// Question types
export const QTYPE = { EXTENDED: 'extended', MCQ: 'mcq' }
export const MCQ_LABELS = ['A', 'B', 'C', 'D']
export const DIFFICULTY_COLORS = {
  1: '#65A30D', 2: '#CA8A04', 3: '#EA580C', 4: '#DC2626',
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

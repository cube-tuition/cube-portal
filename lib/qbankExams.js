import { supabase } from './supabase'
import {
  T_QBANK_EXAMS, T_QBANK_EXAM_SECTIONS, T_QBANK_EXAM_SLOTS, T_QBANK_QUESTIONS,
} from './tables'
import { exportExamPdf } from './qbankExam'
import { listRubrics } from './rubrics'

/*
 * Saved-exam persistence. An exam = details + topic scope + ordered sections,
 * each section = a planned question count + marks limit + ordered slots, each
 * slot = (topic, skill, difficulty) criteria + the chosen bank question.
 *
 * Local builder state mirrors this with throwaway `_key`s; saveExam() replaces
 * the section/slot rows wholesale (they're light), so reopening rebuilds clean.
 */

const key = () => Math.random().toString(36).slice(2, 9)

export const blankSlot = () => ({ _key: key(), topic_id: null, subtopic_id: null, skill_id: null, difficulty: null, question_id: null, working_lines: null, page_breaks: null, image_width: null, rubric_id: null, custom_rubric: null, show_notes: true, notes: '' })
// Per-paper figure size for a slot's question: a whole-number percentage of the
// text column, 10–100. Anything else (blank, 0, junk) means the automatic size.
export const imageWidthOf = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 10 && n <= 100 ? Math.round(n) : null
}

function blankSection(type, count, marks, allow) {
  return {
    _key: key(), type, marks_limit: marks, allow_time: allow,
    slots: Array.from({ length: count }, blankSlot),
  }
}

// Create a new exam pre-seeded with the standard CUBE foundation.
// `kind` picks the set of papers it belongs to: 'term' (the end-of-term test)
// or 'mid_term'. Both are the same format and use the same builder — the kind
// only decides which tab lists it.
/*
 * Exam naming convention:
 *   term tests      "5.M. 26T2 TT"
 *   mid-term tests  "5.M. 26T3 MTT"
 *   mocks           "11.C. 26T3 MOCK"
 * (year . subject-letter . term-code . kind). The builder keeps the title on
 * this convention automatically until someone types their own.
 */
const PAPER_LETTER = { english: 'E', chemistry: 'C', maths: 'M' }
// Anything unrecognised falls back to maths, as it always has.
const normalisePaper = (p) => (p === 'english' || p === 'chemistry' ? p : 'maths')
const KIND_SUFFIX = { mid_term: 'MTT', mock: 'MOCK', term: 'TT' }

export function examTitle({ yearLabel, paperType, termYear2, term, kind }) {
  const s = PAPER_LETTER[paperType] || 'M'
  return `${yearLabel || '?'}.${s}. ${termYear2 || '2X'}T${term ?? 'X'} ${KIND_SUFFIX[kind] || 'TT'}`
}

// A title still on the convention (or never set) is safe to regenerate when
// the exam's year/term/kind change; a hand-typed title is left alone.
export const isAutoExamTitle = (t) =>
  !t || /^Untitled/i.test(t) || /^[\d/?]+\.[MEC]\. (\d{2}|2X)T[\dX] (TT|MTT|MOCK)$/.test(String(t).trim())

export async function createExam(createdBy, paperType = 'maths', term = null, kind = 'term') {
  const { data: exam, error } = await supabase.from(T_QBANK_EXAMS)
    .insert({
      title: kind === 'mid_term' ? 'Untitled mid-term test'
           : kind === 'mock' ? 'Untitled mock' : 'Untitled term test',
      created_by: createdBy || null,
      paper_type: normalisePaper(paperType),
      term: term ?? null, kind: KIND_SUFFIX[kind] ? kind : 'term',
    }).select('*').single()
  if (error) throw error
  const seeded = {
    ...exam,
    sections: [
      blankSection('mcq', 0, 10, '15 minutes'),
      blankSection('extended', 0, 40, '1 hour and 45 minutes'),
    ],
  }
  await saveExam(seeded)
  return exam.id
}

export async function listExams() {
  const { data } = await supabase.from(T_QBANK_EXAMS)
    .select('*, qbank_exam_sections(id, question_count, qbank_exam_slots(question_id))')
    .order('updated_at', { ascending: false })
  return data || []
}

export async function loadExam(id) {
  const { data: exam } = await supabase.from(T_QBANK_EXAMS).select('*').eq('id', id).maybeSingle()
  if (!exam) return null
  const { data: sections } = await supabase.from(T_QBANK_EXAM_SECTIONS)
    .select('*').eq('exam_id', id).order('sort_order')
  const secIds = (sections || []).map((s) => s.id)
  let slots = []
  if (secIds.length) {
    const { data } = await supabase.from(T_QBANK_EXAM_SLOTS)
      .select('*').in('section_id', secIds).order('sort_order')
    slots = data || []
  }
  return {
    ...exam,
    topic_ids: Array.isArray(exam.topic_ids) ? exam.topic_ids : [],
    sections: (sections || []).map((s) => ({
      _key: s.id, type: s.type, marks_limit: s.marks_limit, allow_time: s.allow_time,
      slots: slots.filter((sl) => sl.section_id === s.id).map((sl) => ({
        _key: sl.id, topic_id: sl.topic_id, subtopic_id: sl.subtopic_id, skill_id: sl.skill_id,
        difficulty: sl.difficulty, question_id: sl.question_id,
        working_lines: (sl.working_lines && typeof sl.working_lines === 'object') ? sl.working_lines : null,
        page_breaks: (sl.page_breaks && typeof sl.page_breaks === 'object') ? sl.page_breaks : null,
        image_width: imageWidthOf(sl.image_width),
        rubric_id: sl.rubric_id || null,
        custom_rubric: (sl.custom_rubric && typeof sl.custom_rubric === 'object') ? sl.custom_rubric : null,
        show_notes: sl.show_notes !== false,
        notes: sl.notes || '',
      })),
    })),
  }
}

// Persist the whole exam: update details, then replace sections + slots.
export async function saveExam(exam) {
  const { error: upErr } = await supabase.from(T_QBANK_EXAMS).update({
    title: exam.title || 'Untitled exam',
    year_label: exam.year_label || null,
    subject_id: exam.subject_id || null,
    paper_type: normalisePaper(exam.paper_type),
    term: exam.term || null,
    reading_time: exam.reading_time || null,
    working_time: exam.working_time || null,
    calculators: !!exam.calculators,
    topic_ids: exam.topic_ids || [],
  }).eq('id', exam.id)
  if (upErr) throw upErr

  await supabase.from(T_QBANK_EXAM_SECTIONS).delete().eq('exam_id', exam.id)

  for (let i = 0; i < (exam.sections || []).length; i++) {
    const sec = exam.sections[i]
    const { data: secRow, error: sErr } = await supabase.from(T_QBANK_EXAM_SECTIONS).insert({
      exam_id: exam.id, sort_order: i, type: sec.type,
      question_count: (sec.slots || []).length,
      marks_limit: sec.marks_limit ?? null, allow_time: sec.allow_time || null,
    }).select('id').single()
    if (sErr) throw sErr
    const slotRows = (sec.slots || []).map((sl, j) => ({
      section_id: secRow.id, sort_order: j,
      topic_id: sl.topic_id || null, subtopic_id: sl.subtopic_id || null, skill_id: sl.skill_id || null,
      difficulty: sl.difficulty ?? null, question_id: sl.question_id || null,
      working_lines: (sl.working_lines && Object.keys(sl.working_lines).length) ? sl.working_lines : null,
      page_breaks: (sl.page_breaks && Object.keys(sl.page_breaks).length) ? sl.page_breaks : null,
      image_width: imageWidthOf(sl.image_width),
      rubric_id: sl.rubric_id || null,
      custom_rubric: sl.custom_rubric || null,
      show_notes: sl.show_notes !== false,
      notes: sl.notes || null,
    }))
    if (slotRows.length) {
      const { error: slErr } = await supabase.from(T_QBANK_EXAM_SLOTS).insert(slotRows)
      if (slErr) throw slErr
    }
  }
}

export async function deleteExam(id) {
  await supabase.from(T_QBANK_EXAMS).delete().eq('id', id)
}

// Build the { meta, sections } payload that exportExamPdf / renderExamPreview
// consume, from a loaded exam plus the question bank and rubric library. This is
// the same shape the exam builder assembles inline (buildMeta / buildSections),
// extracted so the curriculum "assign exam" flow can render an exam to PDF too.
const EXAM_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
/*
 * Stepping a question one place through the paper.
 *
 * Dragging a slot's handle reorders it within its own section. These two carry
 * it ACROSS a section boundary as well, which dragging cannot: off the top of a
 * section it lands at the bottom of the section above, and off the bottom it
 * lands at the top of the one below.
 *
 * Only between sections of the same type. Section I holds multiple-choice
 * questions and the rest hold extended-response ones, and each prints under its
 * own instructions ("Circle the correct option" vs working lines), so a question
 * carried into the wrong kind of section would be printed the wrong way. An
 * mcq section is therefore skipped over when an extended question is travelling,
 * and vice versa.
 */
const sameTypeNeighbour = (sections, si, dir) => {
  for (let j = si + dir; j >= 0 && j < sections.length; j += dir) {
    if (sections[j].type === sections[si].type) return j
  }
  return -1
}

// Where the slot would land, or null when there is nowhere to go — which is
// what leaves the button disabled at the two ends of the paper.
export function slotMoveTarget(sections, secKey, slotKey, dir) {
  const ss = sections || []
  const si = ss.findIndex((s) => s._key === secKey)
  if (si < 0) return null
  const i = (ss[si].slots || []).findIndex((sl) => sl._key === slotKey)
  if (i < 0) return null
  const within = i + dir
  if (within >= 0 && within < ss[si].slots.length) return { si, to: within }
  const sj = sameTypeNeighbour(ss, si, dir)
  return sj < 0 ? null : { si, sj }
}

// The sections with that move applied; the same array back if it cannot move.
export function moveSlotInSections(sections, secKey, slotKey, dir) {
  const target = slotMoveTarget(sections, secKey, slotKey, dir)
  if (!target) return sections
  const next = sections.map((s) => ({ ...s, slots: [...(s.slots || [])] }))
  const i = next[target.si].slots.findIndex((sl) => sl._key === slotKey)
  const [moved] = next[target.si].slots.splice(i, 1)
  if (target.sj == null) next[target.si].slots.splice(target.to, 0, moved)
  else if (dir < 0) next[target.sj].slots.push(moved)
  else next[target.sj].slots.unshift(moved)
  return next
}

/*
 * Drag a question into another section, landing it before `beforeSlotKey` (or
 * at the end when that is null). The arrows step a question one place at a
 * time; this is the same journey in one movement, for a question that belongs
 * three sections away.
 *
 * Refused between sections of different types, for the reason `sameTypeNeighbour`
 * gives: the two kinds print under different instructions, so a question carried
 * into the wrong kind would be printed the wrong way. Returns the same array
 * back when the move cannot be made, which leaves the drop a no-op.
 */
export function moveSlotToSection(sections, fromSecKey, slotKey, toSecKey, beforeSlotKey = null) {
  const ss = sections || []
  const from = ss.findIndex((x) => x._key === fromSecKey)
  const to = ss.findIndex((x) => x._key === toSecKey)
  if (from < 0 || to < 0) return sections
  if (ss[from].type !== ss[to].type) return sections
  const i = (ss[from].slots || []).findIndex((sl) => sl._key === slotKey)
  if (i < 0) return sections
  if (from === to) {
    const j = (ss[to].slots || []).findIndex((sl) => sl._key === beforeSlotKey)
    if (j < 0 || i === j) return sections
  }
  const next = ss.map((x) => ({ ...x, slots: [...(x.slots || [])] }))
  const [moved] = next[from].slots.splice(i, 1)
  const at = beforeSlotKey == null ? -1 : next[to].slots.findIndex((sl) => sl._key === beforeSlotKey)
  if (at < 0) next[to].slots.push(moved)
  else next[to].slots.splice(at, 0, moved)
  return next
}

export function buildExamRenderPayload({ exam, questions = [], rubrics = [] }) {
  const qById = Object.fromEntries((questions || []).map((q) => [q.id, q]))
  const rubricById = Object.fromEntries((rubrics || []).map((r) => [r.id, r]))
  const meta = {
    // title drives the cover's second line and the export filename, so it has to
    // travel with the rest — without it the curriculum and report exports print
    // a generic label where the builder prints the paper's name.
    title: exam?.title,
    yearLabel: exam?.year_label, term: exam?.term, paperType: exam?.paper_type || 'maths',
    kind: exam?.kind || 'term',
    readingTime: exam?.reading_time, workingTime: exam?.working_time, calculators: exam?.calculators,
  }
  const sections = (exam?.sections || []).map((s, i) => ({
    roman: EXAM_ROMAN[i] || String(i + 1), type: s.type, allow: s.allow_time,
    questions: (s.slots || [])
      .map((sl) => {
        const q = qById[sl.question_id]
        return q ? {
          ...q,
          _workingLines: sl.working_lines || null,
          _pageBreaks: sl.page_breaks || null,
          _imageWidth: imageWidthOf(sl.image_width),
          _rubric: sl.custom_rubric || rubricById[sl.rubric_id] || null,
          _showNotes: sl.show_notes !== false,
          _notes: sl.notes || '',
        } : null
      })
      .filter(Boolean),
  }))
  return { meta, sections }
}

// Generate an exam PDF on demand from just its id — loads the exam, the question
// bank and rubrics, builds the render payload, and produces the PDF. With
// preview=false (default) it downloads; with preview=true it returns { url, filename }.
// Nothing is stored: assigning an exam only references it, and the paper is built
// fresh whenever a teacher asks for it.
export async function renderExamPdf(examId, { solutions = false, preview = false } = {}) {
  const exam = await loadExam(examId)
  if (!exam) throw new Error('Exam not found.')
  // Only the questions this exam uses. Reading the whole bank used to be enough,
  // but PostgREST silently caps a select at 1000 rows: past that size a paper
  // rendered with its newest questions quietly missing.
  const ids = (exam.sections || []).flatMap((s) => (s.slots || []).map((sl) => sl.question_id)).filter(Boolean)
  const [qRes, rubrics] = await Promise.all([
    ids.length
      ? supabase.from(T_QBANK_QUESTIONS)
        .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)')
        .in('id', ids)
      : Promise.resolve({ data: [] }),
    listRubrics(),
  ])
  const { meta, sections } = buildExamRenderPayload({ exam, questions: qRes.data || [], rubrics })
  return exportExamPdf({ meta, sections, solutions, preview })
}

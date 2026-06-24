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

export const blankSlot = () => ({ _key: key(), topic_id: null, subtopic_id: null, skill_id: null, difficulty: null, question_id: null, working_lines: null, rubric_id: null, custom_rubric: null, show_notes: true, notes: '' })

function blankSection(type, count, marks, allow) {
  return {
    _key: key(), type, marks_limit: marks, allow_time: allow,
    slots: Array.from({ length: count }, blankSlot),
  }
}

// Create a new exam pre-seeded with the standard CUBE foundation.
export async function createExam(createdBy, paperType = 'maths') {
  const { data: exam, error } = await supabase.from(T_QBANK_EXAMS)
    .insert({ title: 'Untitled exam', created_by: createdBy || null, paper_type: paperType === 'english' ? 'english' : 'maths' }).select('*').single()
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
    paper_type: exam.paper_type === 'english' ? 'english' : 'maths',
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
export function buildExamRenderPayload({ exam, questions = [], rubrics = [] }) {
  const qById = Object.fromEntries((questions || []).map((q) => [q.id, q]))
  const rubricById = Object.fromEntries((rubrics || []).map((r) => [r.id, r]))
  const meta = {
    yearLabel: exam?.year_label, term: exam?.term, paperType: exam?.paper_type || 'maths',
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
  const [exam, qRes, rubrics] = await Promise.all([
    loadExam(examId),
    supabase.from(T_QBANK_QUESTIONS).select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)'),
    listRubrics(),
  ])
  if (!exam) throw new Error('Exam not found.')
  const { meta, sections } = buildExamRenderPayload({ exam, questions: qRes.data || [], rubrics })
  return exportExamPdf({ meta, sections, solutions, preview })
}

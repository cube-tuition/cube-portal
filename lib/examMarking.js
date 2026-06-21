import { supabase } from './supabase'
import { loadExam } from './qbankExams'

/*
 * Shared helpers for the per-question exam marking + analysis, used by both the
 * class Exams page (ExamSection) and the individual student reports so they
 * stay consistent.
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

// Total marks for a question: sum of parts (multipart), else its marks (MCQ → 1).
const qMax = (q) => {
  if (q.is_multipart && Array.isArray(q.qbank_question_parts) && q.qbank_question_parts.length) {
    return q.qbank_question_parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
  }
  if (q.qtype === 'mcq') return Number(q.marks) || 1
  return Number(q.marks) || 0
}

// Resolve the qbank exam assigned to a class's curriculum for a term. Prefers an
// exam linked via the "Add exam" flow (is_exam + exam_id); otherwise resolves an
// old-style exam-title booklet by the class's year + subject + term.
export async function resolveAssignedExamId(classId, termNumber) {
  const { data: asgs } = await supabase.from('class_booklet_assignments')
    .select('week, booklet_id, booklets(is_exam, exam_id, booklet_name)')
    .eq('class_id', classId).eq('term_number', termNumber)
  const byWeekDesc = (arr) => [...arr].sort((a, b) => (b.week || 0) - (a.week || 0))

  const linked = byWeekDesc((asgs || []).filter((a) => a.booklets?.is_exam && a.booklets?.exam_id))[0]
  if (linked) return { examId: linked.booklets.exam_id, examName: linked.booklets.booklet_name }

  const cand = byWeekDesc((asgs || []).filter((a) => {
    const nm = a.booklets?.booklet_name || ''
    return /exam/i.test(nm) && !/review/i.test(nm)
  }))[0]
  if (cand) {
    const { data: cls } = await supabase.from('classes').select('class_name').eq('id', classId).maybeSingle()
    const nm = cls?.class_name || ''
    const yr = (nm.match(/(\d+)/) || [])[1]
    const paper = /english/i.test(nm) ? 'english' : 'maths'
    if (yr) {
      const { data: exs } = await supabase.from('qbank_exams')
        .select('id')
        .eq('year_label', String(yr)).eq('paper_type', paper)
        .or(`term.eq.${termNumber},term.eq.Term ${termNumber}`)
      if (exs && exs.length === 1) return { examId: exs[0].id, examName: cand.booklets.booklet_name }
    }
  }
  return { examId: null, examName: null }
}

// Ordered question list for an exam: [{ qid, n, section, topic, max }].
export async function loadExamItems(examId) {
  const ex = await loadExam(examId)
  const qids = []
  ;(ex?.sections || []).forEach((s) => (s.slots || []).forEach((sl) => { if (sl.question_id) qids.push(sl.question_id) }))
  let qById = {}
  if (qids.length) {
    const { data: qs } = await supabase.from('qbank_questions')
      .select('id, qtype, marks, is_multipart, qbank_question_parts(marks), qbank_topics(name)')
      .in('id', qids)
    qById = Object.fromEntries((qs || []).map((q) => [q.id, q]))
  }
  const items = []
  ;(ex?.sections || []).forEach((s, si) => {
    const label = `Section ${ROMAN[si] || si + 1} · ${s.type === 'mcq' ? 'Multiple choice' : 'Extended response'}`
    ;(s.slots || []).forEach((sl) => {
      const q = qById[sl.question_id]
      if (!q) return
      items.push({ qid: q.id, n: items.length + 1, section: label, topic: q.qbank_topics?.name || 'Uncategorised', max: qMax(q) })
    })
  })
  return items
}

// Roll per-question marks up into the topic analysis used by the UI.
//   marksByStudent : { studentId: { questionId: awarded } }
// Returns { orderedTopics, topics:[{topic,awarded,max,pct}], perStudent }
export function computeExamAnalysis(items, marksByStudent, roster) {
  const topicFullMax = {}, orderedTopics = [], orderedSections = []
  for (const it of items) {
    if (!(it.topic in topicFullMax)) { topicFullMax[it.topic] = 0; orderedTopics.push(it.topic) }
    topicFullMax[it.topic] += it.max
    if (it.section && !orderedSections.includes(it.section)) orderedSections.push(it.section)
  }
  const topicAgg = {}, perStudent = {}
  for (const st of roster) {
    perStudent[st.id] = { topics: {}, sections: {}, awarded: 0, max: 0 }
    for (const it of items) {
      const a = marksByStudent[st.id]?.[it.qid]
      if (a === '' || a == null) continue
      const aw = Number(a) || 0
      topicAgg[it.topic] = topicAgg[it.topic] || { awarded: 0, max: 0 }
      topicAgg[it.topic].awarded += aw; topicAgg[it.topic].max += it.max
      const ps = perStudent[st.id]
      ps.topics[it.topic] = ps.topics[it.topic] || { awarded: 0, max: 0 }
      ps.topics[it.topic].awarded += aw; ps.topics[it.topic].max += it.max
      if (it.section) {
        ps.sections[it.section] = ps.sections[it.section] || { awarded: 0, max: 0 }
        ps.sections[it.section].awarded += aw; ps.sections[it.section].max += it.max
      }
      ps.awarded += aw; ps.max += it.max
    }
  }
  const topics = orderedTopics.map((t) => {
    const agg = topicAgg[t] || { awarded: 0, max: 0 }
    return { topic: t, fullMax: topicFullMax[t], awarded: agg.awarded, max: agg.max, pct: agg.max ? Math.round((agg.awarded / agg.max) * 100) : null }
  })
  return { orderedTopics, orderedSections, topics, perStudent }
}

// One-shot: resolve the class's assigned exam, load its questions and marks, and
// return the analysis (or null if no exam is assigned). Used by the report page.
export async function loadExamAnalysisForClass({ classId, termNumber, termId, roster }) {
  const { examId, examName } = await resolveAssignedExamId(classId, termNumber)
  if (!examId) return null
  const items = await loadExamItems(examId)
  const { data: rows } = await supabase.from('exam_question_marks')
    .select('student_id, question_id, awarded')
    .eq('class_id', classId).eq('term_id', termId).eq('exam_id', examId)
  const marksByStudent = {}
  for (const r of rows || []) {
    marksByStudent[r.student_id] = marksByStudent[r.student_id] || {}
    marksByStudent[r.student_id][r.question_id] = r.awarded
  }
  return { examName, ...computeExamAnalysis(items, marksByStudent, roster || []) }
}

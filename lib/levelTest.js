import { supabase } from './supabase'

/*
 * Level-test marking helpers.
 *
 * A level test is a booklet_builds row (doc_type='level_test') whose question
 * blocks are drawn from the question bank. Each such block keeps a
 * qbank_question_id, so we resolve the question's TOPIC and MARKS straight from
 * the bank — exactly like the term-test (exam) analysis. The resulting items
 * feed computeExamAnalysis() so the report logic is shared.
 */

// Total marks for a qbank question: sum of parts (multipart), else marks (MCQ → 1).
function qMax(q) {
  if (q.is_multipart && Array.isArray(q.qbank_question_parts) && q.qbank_question_parts.length) {
    return q.qbank_question_parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
  }
  if (q.qtype === 'mcq') return Number(q.marks) || 1
  return Number(q.marks) || 0
}

// Fallback marks for a hand-authored (non-bank) block.
function blockMax(b) {
  if (Array.isArray(b.parts) && b.parts.length && b.parts.some(p => p.marks != null && p.marks !== '')) {
    return b.parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
  }
  return Number(b.marks) || 0
}

const stemText = (s) => (s || '').replace(/\$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)

/*
 * Build the ordered marking items for a level test's blocks.
 * Returns [{ qid, n, section, topic, max, qtype, stem }] where qid is the block id.
 * Section comes from the preceding section/subtopic heading block.
 */
export async function loadLevelTestItems(blocks = []) {
  const qBlocks = (blocks || []).filter(b => b?.type === 'question' || b?.type === 'mcq')
  const bankIds = [...new Set(qBlocks.map(b => b.qbank_question_id).filter(Boolean))]

  let qById = {}
  if (bankIds.length) {
    // Topic can be reached three ways (mirror of lib/examMarking.loadExamItems).
    const { data: qs } = await supabase.from('qbank_questions')
      .select('id, qtype, marks, is_multipart, qbank_question_parts(marks), qbank_topics(name), qbank_subtopics(qbank_topics(name)), qbank_skills(qbank_topics(name))')
      .in('id', bankIds)
    qById = Object.fromEntries((qs || []).map(q => [q.id, q]))
  }

  const items = []
  let section = ''
  let n = 0
  for (const b of blocks || []) {
    if (b.type === 'section' || b.type === 'subtopic') {
      section = [b.number, b.title].map(v => String(v ?? '').trim()).filter(Boolean).join('. ')
      continue
    }
    if (b.type !== 'question' && b.type !== 'mcq') continue
    n += 1
    const q = b.qbank_question_id ? qById[b.qbank_question_id] : null
    const topic = q
      ? (q.qbank_subtopics?.qbank_topics?.name || q.qbank_skills?.qbank_topics?.name || q.qbank_topics?.name || 'Uncategorised')
      : (b.topic || 'Uncategorised')   // hand-authored blocks can carry a topic name directly
    const max = q ? qMax(q) : blockMax(b)
    items.push({
      qid: b.id,
      n,
      section: section || 'Section I',
      topic,
      max,
      qtype: b.type === 'mcq' ? 'mcq' : (q?.qtype || 'extended'),
      stem: stemText(b.prompt),
    })
  }
  return items
}

// Load saved marks for a lesson → { [questionId]: awarded(string) }.
export async function loadLevelTestMarks(lessonId) {
  const { data } = await supabase.from('level_test_marks')
    .select('question_id, awarded')
    .eq('lesson_id', lessonId)
  const out = {}
  for (const r of data || []) out[r.question_id] = r.awarded == null ? '' : String(r.awarded)
  return out
}

// Upsert one question's mark for a lesson (blank clears it).
export async function saveLevelTestMark(lessonId, questionId, awarded) {
  const val = awarded === '' || awarded == null ? null : Number(awarded)
  if (val == null) {
    return supabase.from('level_test_marks').delete().eq('lesson_id', lessonId).eq('question_id', questionId)
  }
  return supabase.from('level_test_marks')
    .upsert({ lesson_id: lessonId, question_id: questionId, awarded: val, updated_at: new Date().toISOString() }, { onConflict: 'lesson_id,question_id' })
}

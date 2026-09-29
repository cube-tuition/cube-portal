import { supabase } from './supabase'
import { analysisTopicLabel, analysisTopicFull, analysisTopicName, resolveTopicLabels, computeExamAnalysis } from './examMarking'
import { questionTotalMarks } from './qbank'
import { blockMarks } from './bookletRender'
import { subjectCode } from './format'
import { studentAnalysisRows } from '../components/StudentExamAnalysisView'

/*
 * Level-test marking helpers.
 *
 * A level test is a booklet_builds row (doc_type='level_test') whose question
 * blocks are drawn from the question bank. Each such block keeps a
 * qbank_question_id, so we resolve the question's TOPIC and MARKS straight from
 * the bank — exactly like the term-test (exam) analysis. The resulting items
 * feed computeExamAnalysis() so the report logic is shared.
 */

const stemText = (s) => (s || '').replace(/\$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)

/*
 * Build the ordered marking items for a level test's blocks.
 * Returns [{ qid, n, section, topic, max, qtype, stem }] where qid is the block id.
 * Section comes from the preceding section/subtopic heading block.
 */
export async function loadLevelTestItems(blocks = []) {
  const qBlocks = (blocks || []).filter(b => b?.type === 'question' || b?.type === 'mcq')
  const bankIds = [...new Set(qBlocks.map(b => b.qbank_question_id).filter(Boolean))]

  // Marking criteria attached to a question (block.rubric_id). Such a question
  // is marked criterion by criterion, and each criterion is its own analysis
  // topic — so the report shows how the writing did on content, structure,
  // technique and accuracy rather than one lump "Writing" mark.
  const rubricIds = [...new Set(qBlocks.flatMap(b => [b.rubric_id, ...(Array.isArray(b.parts) ? b.parts.map(p => p?.rubric_id) : [])]).filter(Boolean))]
  let rubricById = {}
  if (rubricIds.length) {
    const { data: rs } = await supabase.from('qbank_rubrics').select('id, name, criteria').in('id', rubricIds)
    rubricById = Object.fromEntries((rs || []).map(r => [r.id, r]))
  }

  let qById = {}
  if (bankIds.length) {
    // Topic can be reached three ways (mirror of lib/examMarking.loadExamItems).
    // Embed via the DIRECT FK — the multi-tag junction tables otherwise make
    // qbank_subtopics / qbank_skills ambiguous and the query 400s silently.
    const { data: qs, error: qErr } = await supabase.from('qbank_questions')
      .select('id, qtype, marks, is_multipart, qbank_question_parts(marks), qbank_topics(name), qbank_subtopics!qbank_questions_subtopic_id_fkey(name, qbank_topics(name)), qbank_skills!qbank_questions_skill_id_fkey(qbank_topics(name))')
      .in('id', bankIds)
    if (qErr) throw new Error(`Failed to load level-test questions: ${qErr.message}`)
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
    // Whole-question criteria only apply to a question without subquestions;
    // with parts, criteria live on the parts.
    const hasParts = Array.isArray(b.parts) && b.parts.length > 0
    const rubric = b.rubric_id && !hasParts ? rubricById[b.rubric_id] : null
    const criteria = (Array.isArray(rubric?.criteria) ? rubric.criteria : []).filter(c => String(c?.name || '').trim())
    if (criteria.length) {
      criteria.forEach((c, i) => items.push({
        qid: `${b.id}#c${i}`,
        n,
        section: section || 'Section I',
        topic: String(c.name).trim(),
        max: Number(c.max) || 0,
        qtype: 'rubric',
        stem: stemText(b.prompt),
        criterion: String(c.name).trim(),
        rubricName: rubric.name || '',
      }))
      continue
    }
    const q = b.qbank_question_id ? qById[b.qbank_question_id] : null
    const topic = q
      ? analysisTopicLabel(q)          // subtopic, same as the exam analysis
      : (b.topic || 'Uncategorised')   // hand-authored blocks can carry a topic name directly
    const topicFull = q ? analysisTopicFull(q) : topic

    // A subquestion with its own marking criteria splits the question by part:
    // each plain part is one mark box under the question's topic, and the
    // criteria part is one box per criterion, each its own topic. Questions
    // with no such part keep the single mark they have always had, so marks
    // already entered on them stay where they are.
    const parts = Array.isArray(b.parts) ? b.parts : []
    if (parts.some(p => p?.rubric_id && rubricById[p.rubric_id])) {
      const bankParts = (q?.qbank_question_parts || [])
      parts.forEach((p, i) => {
        const label = String.fromCharCode(97 + i)
        const key = `${b.id}~${p.id ?? i}`
        const pr = p.rubric_id ? rubricById[p.rubric_id] : null
        const pcrit = (Array.isArray(pr?.criteria) ? pr.criteria : []).filter(c => String(c?.name || '').trim())
        if (pcrit.length) {
          pcrit.forEach((c, k) => items.push({
            qid: `${key}#c${k}`, n, part: label,
            section: section || 'Section I',
            topic: String(c.name).trim(),
            max: Number(c.max) || 0,
            qtype: 'rubric',
            stem: stemText(p.prompt || b.prompt),
            criterion: String(c.name).trim(),
            rubricName: pr.name || '',
          }))
        } else {
          items.push({
            qid: key, n, part: label,
            section: section || 'Section I',
            topic,
            _topicFull: topicFull,
            _topicName: q ? analysisTopicName(q) : undefined,
            max: Number(p.marks) || Number(bankParts[i]?.marks) || 0,
            qtype: q?.qtype || 'extended',
            stem: stemText(p.prompt || b.prompt),
          })
        }
      })
      continue
    }
    const max = q ? questionTotalMarks(q) : blockMarks(b)
    items.push({
      qid: b.id,
      n,
      section: section || 'Section I',
      topic,
      _topicFull: topicFull,
      _topicName: q ? analysisTopicName(q) : undefined,
      max,
      qtype: b.type === 'mcq' ? 'mcq' : (q?.qtype || 'extended'),
      stem: stemText(b.prompt),
    })
  }
  return resolveTopicLabels(items)
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

// ── A lesson's whole report, loadable from anywhere ──────────────────────────
// The marking page used to build this inline, which meant a report could only
// be produced from its own page. A family email attaches a sibling's report
// too, so the same load → analyse → report-args path lives here, used by the
// page for its own lesson and for each sibling it sends alongside.

// Which test this is. Every level-test build is titled just "Level Test", so
// the year + subject prefix is what actually identifies it ("9.M. Level Test").
export const levelTestName = (b) => {
  const code = subjectCode(b?.subject)
  return (b?.year && code) ? `${b.year}.${code}. Level Test` : (b?.title || 'Level Test')
}

export const LEVEL_TEST_LESSON_COLS =
  'id, lesson_date, start_time, end_time, room, notes, lesson_type, makeup_student_id, student_name, '
  + 'scheduled_teacher_id, level_test_build_id, level_test_build_ids, report_comment, report_comments, report_family_comment, '
  + 'report_emailed_at, report_emailed_to, report_emailed_with'

const buildIdsOf = (les) => ((Array.isArray(les?.level_test_build_ids) && les.level_test_build_ids.length)
  ? les.level_test_build_ids
  : (les?.level_test_build_id ? [les.level_test_build_id] : []))

/*
 * Everything a lesson's report needs: the lesson, who sat it, their parent,
 * the linked tests (items namespaced "<buildId>::<blockId>" so marks never
 * collide across tests) and the marks. Returns null when the lesson is gone.
 */
export async function loadLevelTestLesson(lessonId) {
  const { data: lesson, error } = await supabase.from('lessons')
    .select(LEVEL_TEST_LESSON_COLS).eq('id', lessonId).maybeSingle()
  if (error) throw error
  if (!lesson) return null

  let student = null, guardian = null
  if (lesson.makeup_student_id) {
    const { data: st } = await supabase.from('students').select('id, full_name, year').eq('id', lesson.makeup_student_id).maybeSingle()
    student = st || null
    if (st) {
      const { data: gs } = await supabase.from('guardians').select('full_name, email').eq('student_id', st.id)
      guardian = (gs || []).find(g => g.email) || gs?.[0] || null
    }
  } else if (lesson.student_name) {
    student = { id: `lt-${lesson.id}`, full_name: lesson.student_name, year: null }
  }

  const buildIds = buildIdsOf(lesson)
  const tests = []
  if (buildIds.length) {
    const { data: bs } = await supabase.from('booklet_builds').select('id, title, subject, year, blocks').in('id', buildIds)
    const byId = Object.fromEntries((bs || []).map(b => [b.id, b]))
    for (const bid of buildIds) {              // preserve the chosen order
      const b = byId[bid]
      if (!b) continue
      const raw = await loadLevelTestItems(Array.isArray(b.blocks) ? b.blocks : [])
      tests.push({ build: b, items: raw.map(it => ({ ...it, qid: `${b.id}::${it.qid}` })) })
    }
  }
  const marks = await loadLevelTestMarks(lessonId)
  return { lesson, student, guardian, tests, marks }
}

// One analysis per linked test, for the page's panels and the PDF's sections.
export function levelTestViews(tests, marks, studentId = '__s') {
  return tests.map(t => {
    const analysis = computeExamAnalysis(t.items, { [studentId]: marks }, [{ id: studentId }])
    return { build: t.build, items: t.items, view: studentAnalysisRows(analysis, studentId) }
  })
}

/*
 * The comment boxes for a lesson's tests, labelled the way the email heads
 * them: by subject ("Maths", "English"), falling back to the full test name
 * when two linked tests share a subject. `byBuild` is lessons.report_comments.
 */
export function levelTestCommentSections(tests, byBuild = {}) {
  const subj = tests.map(t => String(t.build?.subject || '').trim())
  return tests.map((t, i) => ({
    buildId: t.build.id,
    label: subj[i] && subj.indexOf(subj[i]) === subj.lastIndexOf(subj[i]) ? subj[i] : levelTestName(t.build),
    text: (byBuild || {})[t.build.id] || '',
  }))
}

// Questions with a mark entered, across every linked test.
export const markedCountOf = (tests, marks) => tests.flatMap(t => t.items)
  .filter(it => { const a = marks[it.qid]; return a !== '' && a != null }).length

// What exportLevelTestReport() takes for one child.
export function levelTestReportArgs({ lesson, student, guardian, tests, marks, teacherName }) {
  return {
    student, guardian, lesson, teacherName,
    tests: levelTestViews(tests, marks, student?.id || '__s').map(tv => ({
      title: levelTestName(tv.build),
      rows: tv.view.rows, overall: tv.view.overall, sections: tv.view.sections,
      strengths: tv.view.strengths, weaknesses: tv.view.weaknesses,
    })),
  }
}

/*
 * Brothers and sisters who sat level tests around the same time, found by the
 * parent's email address — the address the report goes to is what makes it one
 * family, and most students carry no family_id. Level tests are one-off
 * visits, so only lessons within `days` of this one count: a sibling tested a
 * year ago is not part of this send.
 *
 * Returns [{ lesson, student }] for the OTHER children, oldest lesson first.
 */
export async function findSiblingLevelTests({ lesson, student, guardianEmail, days = 14 }) {
  const email = String(guardianEmail || '').trim().toLowerCase()
  if (!email || !lesson?.lesson_date) return []
  const { data: gs } = await supabase.from('guardians').select('student_id, email').ilike('email', email)
  const kids = [...new Set((gs || [])
    .filter(g => String(g.email || '').trim().toLowerCase() === email)
    .map(g => g.student_id))].filter(sid => sid && sid !== student?.id)
  if (!kids.length) return []

  const shift = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const { data: ls } = await supabase.from('lessons')
    .select(`${LEVEL_TEST_LESSON_COLS}, students:makeup_student_id(id, full_name, year)`)
    .eq('lesson_type', 'level_test')
    .in('makeup_student_id', kids)
    .gte('lesson_date', shift(lesson.lesson_date, -days))
    .lte('lesson_date', shift(lesson.lesson_date, days))
    .order('lesson_date').order('start_time')
  return (ls || []).filter(l => l.id !== lesson.id).map(({ students: st, ...l }) => ({ lesson: l, student: st }))
}

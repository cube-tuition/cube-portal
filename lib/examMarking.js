import { supabase } from './supabase'
import { loadExam } from './qbankExams'
import { questionTotalMarks as qMax, partLabel } from './qbank'

/*
 * Shared helpers for the per-question exam marking + analysis, used by both the
 * class Exams page (ExamSection) and the individual student reports so they
 * stay consistent.
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']


// Resolve the qbank exam assigned to a class's curriculum for a term. Prefers an
// exam linked via the "Add exam" flow (is_exam + exam_id); otherwise resolves an
// old-style exam-title booklet by the class's year + subject + term.
//
// A class can now carry BOTH papers in one term — the mid-term test (~week 5)
// and the term test (~week 9) — so the caller says which kind it wants and the
// exams' own kind decides, never the week position.
export async function resolveAssignedExamId(classId, termNumber, kind = 'term') {
  const { data: asgs } = await supabase.from('class_booklet_assignments')
    .select('week, booklet_id, booklets(is_exam, exam_id, booklet_name)')
    .eq('class_id', classId).eq('term_number', termNumber)
  const byWeekDesc = (arr) => [...arr].sort((a, b) => (b.week || 0) - (a.week || 0))

  const linkedAll = (asgs || []).filter((a) => a.booklets?.is_exam && a.booklets?.exam_id)
  if (linkedAll.length) {
    const ids = [...new Set(linkedAll.map((a) => a.booklets.exam_id))]
    const { data: kinds } = await supabase.from('qbank_exams').select('id, kind').in('id', ids)
    // Keep the exam's own kind. Collapsing everything that is not a mid-term
    // into 'term' would let a mock be resolved as a class's term test.
    const kindOf = Object.fromEntries((kinds || []).map((e) => [e.id, e.kind || 'term']))
    const linked = byWeekDesc(linkedAll.filter((a) => kindOf[a.booklets.exam_id] === kind))[0]
    if (linked) return { examId: linked.booklets.exam_id, examName: linked.booklets.booklet_name, backfillBookletId: null }
  }
  // The name-based fallback predates mid-terms and mocks; it only ever finds
  // term tests, so any other kind stops here rather than matching on a name.
  if (kind !== 'term') return { examId: null, examName: null, backfillBookletId: null }

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
      // backfillBookletId lets a caller persist the resolved link (is_exam/exam_id).
      if (exs && exs.length === 1) return { examId: exs[0].id, examName: cand.booklets.booklet_name, backfillBookletId: cand.booklet_id }
    }
  }
  return { examId: null, examName: null, backfillBookletId: null }
}

/*
 * The heading a question is reported under.
 *
 * The subtopic on its own — "Area", "Simultaneous Equations" — since that is
 * what a parent can act on, and the topic in front of it mostly repeated what
 * the subtopic already said ("Algebraic Techniques · Algebra").
 *
 * Some subtopics say nothing on their own, so they report as the bare topic:
 * "General" is the bank's placeholder for "no breakdown here" (51 topics use
 * one), and "Problem Solving" is a question style shared across topics — four
 * of them in Year 6 — rather than a content area. A question with no subtopic
 * also reports as its topic.
 */
const GENERIC_SUBTOPIC = /^(general|other|misc(ellaneous)?|problem solving)$/i

function topicParts(q) {
  const sub = q?.qbank_subtopics
  const topic = sub?.qbank_topics?.name
    || q?.qbank_skills?.qbank_topics?.name
    || q?.qbank_topics?.name
    || 'Uncategorised'
  const name = (sub?.name || '').trim()
  const meaningful = name && !GENERIC_SUBTOPIC.test(name) && name !== topic
  return { topic, sub: meaningful ? name : null }
}

export function analysisTopicLabel(q) {
  const { topic, sub } = topicParts(q)
  return sub || topic
}

// The unambiguous form, used only where the short label would collide.
export function analysisTopicFull(q) {
  const { topic, sub } = topicParts(q)
  return sub ? `${topic} · ${sub}` : topic
}

// The topic a question sits under, whatever its label — for keeping a topic
// whole when only some of its questions carry a subtopic.
export function analysisTopicName(q) {
  return topicParts(q).topic
}

/*
 * A topic is only broken into its subtopics when EVERY question under it in
 * the paper has one. Where some do and some don't, the paper would report
 * the topic and its own subtopics side by side — "Algebraic Techniques" next
 * to "Algebra" and "Quadratics" — which reads as the same thing listed
 * twice. So a partly-subtopicked topic reports whole, under its topic name.
 * Items carry that name in _topicName while this runs.
 *
 * The label is also the key the analysis groups marks by, so two different
 * sources printing the same name would merge into one row and pool their
 * marks. That happens in real data: Year 7 files "Equations" both as a
 * subtopic of Algebraic Techniques and as a topic of its own. Where one short
 * label covers more than one source in a paper, those items keep the full
 * "topic · subtopic" so they stay separate. Items carry the full form in
 * _topicFull while this runs; it is removed before they are returned.
 */
export function resolveTopicLabels(items) {
  const partial = new Set()
  for (const it of items) {
    if (it._topicName && it.topic === it._topicName) partial.add(it._topicName)
  }
  for (const it of items) {
    if (it._topicName && partial.has(it._topicName)) { it.topic = it._topicName; it._topicFull = it._topicName }
  }
  const sourcesByLabel = new Map()
  for (const it of items) {
    if (!sourcesByLabel.has(it.topic)) sourcesByLabel.set(it.topic, new Set())
    sourcesByLabel.get(it.topic).add(it._topicFull ?? it.topic)
  }
  for (const it of items) {
    if (sourcesByLabel.get(it.topic).size > 1 && it._topicFull) it.topic = it._topicFull
    delete it._topicFull
    delete it._topicName
  }
  return items
}

/*
 * A subquestion's own topic, as a question-shaped object the topic helpers
 * above read. A part tagged with a subtopic or a topic reports under it; an
 * untagged part reports under its question's topic.
 */
function partTopicSource(part, q) {
  if (part?.qbank_subtopics) return { qbank_subtopics: part.qbank_subtopics }
  if (part?.qbank_topics) return { qbank_topics: part.qbank_topics }
  return q
}

// The key a subquestion's mark is held under in the marking grid and the
// analysis: the question id and the part's label.
export const partKey = (questionId, label) => `${questionId}~${label}`

// Ordered marking list for an exam: [{ qid, n, section, topic, max }], one
// item per question — or per subquestion for a multi-part question, which is
// marked part by part (item.questionId / item.part) so each part rolls up
// under its own topic.
export async function loadExamItems(examId) {
  const ex = await loadExam(examId)
  const qids = []
  ;(ex?.sections || []).forEach((s) => (s.slots || []).forEach((sl) => { if (sl.question_id) qids.push(sl.question_id) }))
  let qById = {}
  if (qids.length) {
    // Topic can be reached three ways (a question may set any of them): its own
    // denormalised topic_id, its subtopic's topic, or its skill's topic. Resolve
    // all three so questions tagged only via skill/subtopic aren't shown as
    // "Uncategorised".
    // NOTE: qbank_subtopics / qbank_skills must be embedded via the DIRECT FK
    // (…_subtopic_id_fkey / …_skill_id_fkey). The qbank_question_subtopics /
    // qbank_question_skills junction tables (multi-tag support) add a second
    // relationship path, so an unqualified `qbank_subtopics(…)` embed is
    // ambiguous and PostgREST 400s — which previously surfaced as "0 questions".
    const { data: qs, error: qErr } = await supabase.from('qbank_questions')
      .select('id, qtype, marks, is_multipart, stem_latex, qbank_question_parts(marks, sort_order, prompt_latex, qbank_topics(name), qbank_subtopics(name, qbank_topics(name))), qbank_topics(name), qbank_subtopics!qbank_questions_subtopic_id_fkey(name, qbank_topics(name)), qbank_skills!qbank_questions_skill_id_fkey(qbank_topics(name))')
      .in('id', qids)
    if (qErr) throw new Error(`Failed to load exam questions: ${qErr.message}`)
    qById = Object.fromEntries((qs || []).map((q) => [q.id, q]))
  }

  // Rubric criteria (per slot) → lets the marking UI break a question into
  // per-criterion boxes (e.g. a narrative rubric: Content / Structure / … each /4).
  const rubricIds = [...new Set(
    (ex?.sections || []).flatMap((s) => (s.slots || []).map((sl) => sl.rubric_id).filter(Boolean)),
  )]
  let rubricById = {}
  if (rubricIds.length) {
    const { data: rs } = await supabase.from('qbank_rubrics').select('id, criteria').in('id', rubricIds)
    rubricById = Object.fromEntries((rs || []).map((r) => [r.id, r]))
  }
  const criteriaOf = (sl) => {
    const rub = (sl.custom_rubric && typeof sl.custom_rubric === 'object') ? sl.custom_rubric : rubricById[sl.rubric_id]
    const cr = rub?.criteria
    if (!Array.isArray(cr) || !cr.length) return null
    return cr.map((c, i) => ({
      index: i,
      name: c.name || `Criterion ${i + 1}`,
      max: Number(c.max) || 0,
      cells: Array.isArray(c.cells) ? c.cells : null,
    }))
  }

  const stemText = (t) => (t || '').replace(/\$/g, '').replace(/\s+/g, ' ').trim().slice(0, 70)
  const items = []
  let n = 0
  ;(ex?.sections || []).forEach((s, si) => {
    const label = `Section ${ROMAN[si] || si + 1} · ${s.type === 'mcq' ? 'Multiple choice' : 'Extended response'}`
    ;(s.slots || []).forEach((sl) => {
      const q = qById[sl.question_id]
      if (!q) return
      n += 1
      const criteria = q.qtype === 'mcq' ? null : criteriaOf(sl)
      const critSum = criteria ? criteria.reduce((a, c) => a + c.max, 0) : 0
      const parts = (q.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      // Marked by subquestion: each part is its own row, under its own topic.
      // A rubric on the slot still marks the question criterion by criterion.
      if (q.qtype !== 'mcq' && !criteria && parts.length) {
        parts.forEach((p, i) => {
          const src = partTopicSource(p, q)
          items.push({
            qid: partKey(q.id, partLabel(i)), questionId: q.id, part: partLabel(i), n, section: label,
            topic: analysisTopicLabel(src), _topicFull: analysisTopicFull(src), _topicName: analysisTopicName(src),
            questionTopic: analysisTopicLabel(q),
            max: Number(p.marks) || 0,
            qtype: q.qtype, stem: stemText(p.prompt_latex) || stemText(q.stem_latex),
            criteria: null,
          })
        })
        return
      }
      items.push({
        qid: q.id, n, section: label,
        topic: analysisTopicLabel(q), _topicFull: analysisTopicFull(q), _topicName: analysisTopicName(q), max: (criteria && critSum) ? critSum : qMax(q),
        qtype: q.qtype, stem: stemText(q.stem_latex),
        criteria,
      })
    })
  })
  return resolveTopicLabels(items)
}

/*
 * The questions behind a marking list, in order: [{ questionId, n, max, parts }],
 * parts being the question's subquestion items (empty for a question marked as
 * a whole). A question's stored row is its total; this is how the marking grid
 * and the analysis find the parts that make it up.
 */
export function examQuestions(items) {
  const out = []
  const byId = new Map()
  for (const it of items) {
    const id = it.questionId || it.qid
    if (!byId.has(id)) {
      const q = { questionId: id, n: it.n, section: it.section, max: 0, parts: [], item: it.questionId ? null : it }
      byId.set(id, q); out.push(q)
    }
    const q = byId.get(id)
    q.max += it.max
    if (it.questionId) q.parts.push(it)
  }
  return out
}

/*
 * Stored rows → the marking grid's state. marks[studentId][key] is the mark
 * under each item's key (a part's mark under its part key); crit holds rubric
 * criterion marks; whole[studentId][questionId] is a multi-part question that
 * was marked as one total before marking by subquestion — it has no parts to
 * spread over, so it stays a total under the question's topic until the parts
 * are marked.
 */
export function marksFromRows(items, rows) {
  const split = new Set(items.filter((it) => it.questionId).map((it) => it.questionId))
  const marks = {}, crit = {}, whole = {}
  for (const r of rows || []) {
    const sid = r.student_id
    marks[sid] = marks[sid] || {}
    const pm = r.part_marks && typeof r.part_marks === 'object' ? r.part_marks : null
    if (split.has(r.question_id)) {
      if (pm && Object.keys(pm).length) {
        for (const [label, v] of Object.entries(pm)) {
          marks[sid][partKey(r.question_id, label)] = v == null ? '' : String(v)
        }
      } else if (r.awarded != null) {
        whole[sid] = whole[sid] || {}
        whole[sid][r.question_id] = String(r.awarded)
      }
      continue
    }
    marks[sid][r.question_id] = r.awarded == null ? '' : String(r.awarded)
    if (r.criteria_marks && typeof r.criteria_marks === 'object') {
      crit[sid] = crit[sid] || {}
      crit[sid][r.question_id] = Object.fromEntries(
        Object.entries(r.criteria_marks).map(([k, v]) => [k, v == null ? '' : String(v)]),
      )
    }
  }
  return { marks, crit, whole }
}

/*
 * The analysis's view of the marks: every item's mark, plus — for a question
 * marked as a whole before its parts — one stand-in item carrying that total
 * under the question's own topic. The stand-in only counts for students whose
 * parts are all blank, so nothing is counted twice.
 */
export function analysisInputs(items, marks, whole) {
  const extra = []
  const outMarks = {}
  for (const [sid, m] of Object.entries(marks || {})) outMarks[sid] = { ...m }
  const qs = examQuestions(items)
  for (const q of qs) {
    if (!q.parts.length) continue
    const takers = Object.entries(whole || {}).filter(([sid, w]) => w?.[q.questionId] != null
      && q.parts.every((p) => (marks?.[sid]?.[p.qid] ?? '') === ''))
    if (!takers.length) continue
    const first = q.parts[0]
    // Parts all under one topic: that topic, exactly as the paper labels it.
    // Parts split across topics: the question's own topic, the only one that
    // covers the whole total.
    const oneTopic = q.parts.every((p) => p.topic === first.topic)
    extra.push({
      qid: `${q.questionId}~whole`, questionId: q.questionId, n: q.n, section: q.section,
      topic: oneTopic ? first.topic : first.questionTopic, max: q.max, qtype: first.qtype, wholeTotal: true,
    })
    for (const [sid, w] of takers) {
      outMarks[sid] = outMarks[sid] || {}
      outMarks[sid][`${q.questionId}~whole`] = w[q.questionId]
    }
  }
  return { items: extra.length ? [...items, ...extra] : items, marks: outMarks }
}

// Roll per-question marks up into the topic analysis used by the UI.
//   marksByStudent : { studentId: { questionId: awarded } }
// Returns { orderedTopics, topics:[{topic,awarded,max,pct}], perStudent }
export function computeExamAnalysis(items, marksByStudent, roster) {
  const topicFullMax = {}, orderedTopics = [], orderedSections = []
  for (const it of items) {
    if (!(it.topic in topicFullMax)) { topicFullMax[it.topic] = 0; orderedTopics.push(it.topic) }
    // A whole-question stand-in repeats its parts' marks — the paper's full
    // marks already count them.
    if (!it.wholeTotal) topicFullMax[it.topic] += it.max
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
  return { orderedTopics, orderedSections, topics, perStudent, studentCount: roster.length }
}

// One-shot: resolve the class's assigned exam, load its questions and marks, and
// return the analysis (or null if no exam is assigned). Used by the report page.
export async function loadExamAnalysisForClass({ classId, termNumber, termId, roster, kind = 'term' }) {
  const { examId, examName } = await resolveAssignedExamId(classId, termNumber, kind)
  if (!examId) return null
  const items = await loadExamItems(examId)
  const { data: rows } = await supabase.from('exam_question_marks')
    .select('student_id, question_id, awarded, part_marks')
    .eq('class_id', classId).eq('term_id', termId).eq('exam_id', examId)
  const { marks, whole } = marksFromRows(items, rows)
  const input = analysisInputs(items, marks, whole)
  return { examName, ...computeExamAnalysis(input.items, input.marks, roster || []) }
}

import { blockMarks } from './bookletRender'

/*
 * Pre/post test topics derived from the class's pre-test paper.
 *
 * The topic rows on the class page (name · question numbers · marks) describe
 * the same paper the tutor already built in the booklet builder, so typing them
 * out again is duplicated work — and the marks drift the moment the paper is
 * edited. These helpers read the structure back off the paper's blocks.
 *
 * What the paper knows varies, so the reading falls back in three steps:
 *   1. Section/subtopic headings — the tutor has already grouped the paper.
 *   2. Questions pulled from the question bank — each carries its bank topic.
 *   3. Neither: one row per question, for the tutor to name and merge. Marks
 *      and question numbers are still filled in, which is the fiddly part.
 */

const isQuestion = (b) => b?.type === 'question' || b?.type === 'mcq'
const isHeading  = (b) => b?.type === 'section' || b?.type === 'subtopic'
// Homework and revision-quiz blocks are numbered separately and aren't part of
// the test being marked.
const isContent  = (b) => b?.section !== 'homework' && b?.section !== 'revision'

// Heading titles are rich text: strip the maths delimiters and markers so the
// topic reads as a plain name.
function cleanTitle(title) {
  return String(title ?? '')
    .replace(/\$([^$]*)\$/g, '$1')
    .replace(/\*\*|[*_~^]/g, '')
    .trim()
}

/*
 * The paper's questions in printed order. Numbering matches blocksToHtml —
 * only question/MCQ blocks take a number and a stimulus restarts the count —
 * so the numbers here are the ones printed on the student's paper.
 */
export function paperQuestions(blocks) {
  const out = []
  let n = 0
  let heading = ''
  for (const b of blocks || []) {
    if (!b || !isContent(b)) continue
    if (isHeading(b)) { heading = cleanTitle(b.title); continue }
    if (b.type === 'stimulus') { n = 0; continue }
    if (!isQuestion(b)) continue
    n += 1
    out.push({
      n,
      heading,
      // An MCQ with no marks typed is worth one, as it prints and totals.
      marks: blockMarks(b) || (b.type === 'mcq' ? 1 : 0),
      qbankId: b.qbank_question_id || null,
    })
  }
  return out
}

/*
 * "1, 2, 3, 5" → "1–3, 5". Consecutive numbers read as a range on the paper.
 *
 * Repeats collapse. A stimulus restarts numbering (an English comprehension
 * numbers each passage's questions from 1), so two questions in one topic can
 * both be "1" and the label cannot tell them apart — their marks are still
 * both counted, which is what the score entry needs.
 */
export function formatQuestionRange(nums) {
  const sorted = [...new Set(nums)].sort((a, b) => a - b)
  const spans = []
  for (const n of sorted) {
    const last = spans[spans.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else spans.push([n, n])
  }
  return spans.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')
}

/*
 * "Q1–3, 5" → [1, 2, 3, 5]. Accepts what a tutor actually types: a leading Q,
 * hyphen or en/em dash, spaces anywhere. Returns null if any piece is not a
 * number or range, so a half-typed entry never silently rewrites the marks.
 */
export function parseQuestionRange(text) {
  const src = String(text ?? '').replace(/[Qq]/g, '').trim()
  if (!src) return null
  const nums = []
  for (const piece of src.split(',')) {
    const p = piece.trim()
    if (!p) continue
    const span = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(p)
    const one = /^(\d+)$/.exec(p)
    if (span) {
      const [a, b] = [Number(span[1]), Number(span[2])]
      if (a > b) return null
      for (let i = a; i <= b; i++) nums.push(i)
    } else if (one) {
      nums.push(Number(one[1]))
    } else {
      return null
    }
  }
  return nums.length ? [...new Set(nums)] : null
}

// Total marks the paper allots to the questions named by a range string.
// null when the range doesn't parse or names no question the paper has.
export function marksForQuestionRange(blocks, text) {
  const wanted = parseQuestionRange(text)
  if (!wanted) return null
  const byNumber = new Map(paperQuestions(blocks).map((q) => [q.n, q.marks]))
  if (!wanted.some((n) => byNumber.has(n))) return null
  return wanted.reduce((sum, n) => sum + (byNumber.get(n) || 0), 0)
}

export function paperTotalMarks(blocks) {
  return paperQuestions(blocks).reduce((sum, q) => sum + q.marks, 0)
}

// Group questions into topic rows, keeping the order they first appear in.
function groupBy(questions, keyOf) {
  const rows = new Map()
  for (const q of questions) {
    const key = keyOf(q)
    if (!rows.has(key)) rows.set(key, { name: key, nums: [], marks: 0 })
    const row = rows.get(key)
    row.nums.push(q.n)
    row.marks += q.marks
  }
  return [...rows.values()].map((r) => ({
    name: r.name,
    questions: formatQuestionRange(r.nums),
    marks: r.marks,
  }))
}

/*
 * Topic rows read off a pre-test paper.
 *
 *   blocks              — the booklet_builds `blocks` array
 *   topicNameByQuestion — { [qbank_question_id]: topic name }, for papers built
 *                         from the question bank
 *
 * Returns [{ name, questions, marks }] — the shape prepost_tests.topics stores.
 * `source` says which reading was used so the UI can explain itself.
 */
export function topicsFromPaper(blocks, { topicNameByQuestion = {} } = {}) {
  const questions = paperQuestions(blocks)
  if (!questions.length) return { source: 'empty', topics: [] }

  if (questions.some((q) => q.heading)) {
    // Questions printed before the first heading have no topic of their own.
    return { source: 'headings', topics: groupBy(questions, (q) => q.heading || 'Untitled') }
  }

  const named = (q) => (q.qbankId ? topicNameByQuestion[q.qbankId] : '') || ''
  if (questions.some((q) => named(q))) {
    return { source: 'qbank', topics: groupBy(questions, (q) => named(q) || 'Other') }
  }

  // Nothing in the paper says what any question is about, so each one becomes
  // its own row: the tutor names them and merges the runs that share a topic.
  return {
    source: 'questions',
    topics: questions.map((q) => ({ name: `Question ${q.n}`, questions: `${q.n}`, marks: q.marks })),
  }
}

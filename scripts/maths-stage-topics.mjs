#!/usr/bin/env node
/*
 * Give the two years of a Maths stage ONE shared topic list.
 *
 *   node scripts/maths-stage-topics.mjs 3            # dry run for Stage 3
 *   node scripts/maths-stage-topics.mjs 3 --apply
 *
 * Questions keep their own year (students still see only their year's
 * practice questions), so each year keeps its own topic rows — but after this
 * both years hold exactly the same list, in the same order, and the Topics page
 * shows them as one stage list.
 *
 * Per year, for each topic in the stage's list:
 *   - the existing topics it takes over (`from`) merge into one row, renamed;
 *     questions, question parts, exam slots, skills and subtopics move with it,
 *     and same-named subtopics under the merged row merge too;
 *   - a topic the year doesn't have yet is created (empty).
 * Leftover topics are deleted when nothing uses them, else kept and reported.
 * The workbook Master Database (`topics`) gets the same names, and booklets are
 * re-filed (by their old topic, or by name where the stage says so).
 * Past exam results (exam_marks / exam_question_marks) are history: untouched.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const STAGES = {
  3: {
    years: [5, 6],
    topics: [
      { name: 'Operations of Numbers', from: ['Computation with Numbers'] },
      { name: 'Fractions, decimals and percentages', from: ['Fractions, Decimals & Percentages'] },
      { name: 'Geometry', from: ['Geometry'] },
      { name: 'Shapes & measurement', from: ['Measurement', 'Time'] },
      { name: 'Data', from: ['Data & Statistics'] },
      { name: 'Chance', from: ['Probability'] },
      { name: 'Financial maths', from: ['Financials', 'Financial'] },
      { name: 'Algebra', from: ['Algebra'] },
    ],
    // Topics with no place in the new list (empty in both years).
    drop: ['Ratio & Rates', 'Ratios & Rates'],
    // Booklets filed by their own name (overrides the old-topic mapping).
    booklets: {
      '2D and 3D shapes': 'Shapes & measurement', '2D and 3D Shapes': 'Shapes & measurement',
      'Angles': 'Geometry', 'Rates': 'Operations of Numbers', 'Order of Operations': 'Operations of Numbers',
      'Data': 'Data', 'Money': 'Financial maths', 'Space & Geometry': 'Geometry',
    },
  },
}

const stageNo = Number(process.argv[2])
const apply = process.argv.includes('--apply')
const stage = STAGES[stageNo]
if (!stage) { console.error(`Usage: node scripts/maths-stage-topics.mjs <${Object.keys(STAGES).join('|')}> [--apply]`); process.exit(1) }

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const must = ({ data, error }) => { if (error) throw error; return data }
const log = (...a) => console.log(...a)
const act = async (desc, fn) => { log(`    ${apply ? '✓' : '·'} ${desc}`); if (apply) await fn() }
const norm = (s) => String(s || '').trim().toLowerCase()

// Everything that points at a topic / a subtopic.
const TOPIC_REFS = [['qbank_questions', 'topic_id'], ['qbank_question_parts', 'topic_id'], ['qbank_exam_slots', 'topic_id'], ['qbank_skills', 'topic_id'], ['qbank_subtopics', 'topic_id']]
const SUB_REFS = [['qbank_questions', 'subtopic_id'], ['qbank_question_parts', 'subtopic_id'], ['qbank_exam_slots', 'subtopic_id'], ['qbank_skills', 'subtopic_id'], ['qbank_worksheets', 'subtopic_id']]
const countRefs = async (refs, id) => {
  let n = 0
  for (const [t, c] of refs) n += (must(await sb.from(t).select(c, { count: 'exact', head: false }).eq(c, id)) || []).length
  return n
}

for (const year of stage.years) {
  log(`\n━━ Year ${year} ━━`)
  const subject = must(await sb.from('qbank_subjects').select('id').eq('name', 'Maths').eq('year_level', year).single())
  const topics = must(await sb.from('qbank_topics').select('id, name, sort_order').eq('subject_id', subject.id))
  const used = new Set()

  for (const [order, target] of stage.topics.entries()) {
    const sources = topics.filter(t => [target.name, ...target.from].some(n => norm(n) === norm(t.name)))
    sources.forEach(t => used.add(t.id))
    if (!sources.length) {
      await act(`create "${target.name}"`, async () => must(await sb.from('qbank_topics').insert({ subject_id: subject.id, name: target.name, sort_order: order })))
      continue
    }
    // The survivor: the one already named right, else the one with most questions.
    const counts = {}
    for (const t of sources) counts[t.id] = (must(await sb.from('qbank_questions').select('id').eq('topic_id', t.id)) || []).length
    const keep = sources.find(t => t.name === target.name) || [...sources].sort((a, b) => counts[b.id] - counts[a.id])[0]
    const label = sources.map(t => `${t.name} (${counts[t.id]} q)`).join(' + ')
    log(`  ${target.name}  ←  ${label}`)
    if (keep.name !== target.name || keep.sort_order !== order) {
      await act(`rename/order "${keep.name}" → "${target.name}" #${order}`, async () => must(await sb.from('qbank_topics').update({ name: target.name, sort_order: order }).eq('id', keep.id)))
    }
    for (const t of sources.filter(t => t.id !== keep.id)) {
      for (const [table, col] of TOPIC_REFS) {
        await act(`move ${table}.${col} from "${t.name}"`, async () => must(await sb.from(table).update({ [col]: keep.id }).eq(col, t.id)))
      }
      await act(`delete merged "${t.name}"`, async () => must(await sb.from('qbank_topics').delete().eq('id', t.id)))
    }
    // Same-named subtopics under the merged topic become one.
    if (apply && sources.length > 1) {
      const subs = must(await sb.from('qbank_subtopics').select('id, name, sort_order').eq('topic_id', keep.id).order('sort_order'))
      const byName = {}
      for (const st of subs) (byName[norm(st.name)] ||= []).push(st)
      for (const group of Object.values(byName).filter(g => g.length > 1)) {
        const [first, ...dups] = group
        for (const d of dups) {
          for (const [table, col] of SUB_REFS) must(await sb.from(table).update({ [col]: first.id }).eq(col, d.id))
          const tags = must(await sb.from('qbank_question_subtopics').select('question_id').eq('subtopic_id', d.id))
          if (tags.length) must(await sb.from('qbank_question_subtopics').upsert(tags.map(t => ({ question_id: t.question_id, subtopic_id: first.id })), { onConflict: 'question_id,subtopic_id', ignoreDuplicates: true }))
          must(await sb.from('qbank_subtopics').delete().eq('id', d.id))
          log(`    ✓ merged subtopic "${d.name}" into the first "${first.name}"`)
        }
      }
    }
  }

  // Leftovers.
  for (const t of topics.filter(t => !used.has(t.id))) {
    const refs = await countRefs(TOPIC_REFS, t.id)
    if (refs === 0 && stage.drop.some(n => norm(n) === norm(t.name))) {
      await act(`delete empty "${t.name}"`, async () => must(await sb.from('qbank_topics').delete().eq('id', t.id)))
    } else {
      log(`  ! kept "${t.name}" — not in the stage list${refs ? ` and still used (${refs} links)` : ''}`)
    }
  }

  // Workbook Master Database: the same names.
  const master = must(await sb.from('topics').select('id, name').eq('year', year).eq('subject', 'Maths'))
  const mUsed = new Set()
  for (const target of stage.topics) {
    const rows = master.filter(m => [target.name, ...target.from].some(n => norm(n) === norm(m.name)))
    rows.forEach(r => mUsed.add(r.id))
    if (!rows.length) { await act(`master: create "${target.name}"`, async () => must(await sb.from('topics').insert({ year, subject: 'Maths', name: target.name }))); continue }
    const keep = rows.find(r => r.name === target.name) || rows[0]
    if (keep.name !== target.name) await act(`master: rename "${keep.name}" → "${target.name}"`, async () => must(await sb.from('topics').update({ name: target.name }).eq('id', keep.id)))
    for (const r of rows.filter(r => r.id !== keep.id)) await act(`master: remove merged "${r.name}"`, async () => must(await sb.from('topics').delete().eq('id', r.id)))
  }
  for (const m of master.filter(m => !mUsed.has(m.id))) {
    if (stage.drop.some(n => norm(n) === norm(m.name))) await act(`master: remove "${m.name}"`, async () => must(await sb.from('topics').delete().eq('id', m.id)))
    else log(`  ! master: kept "${m.name}" — not in the stage list`)
  }

  // Booklets: by name where the stage says, else by their old topic.
  const booklets = must(await sb.from('booklets').select('id, booklet_name, topic').eq('year', year).eq('subject', 'Maths'))
  for (const b of booklets) {
    const byName = stage.booklets[String(b.booklet_name || '').trim()]
    const byTopic = stage.topics.find(t => [t.name, ...t.from].some(n => norm(n) === norm(b.topic)))?.name
    const next = byName || byTopic || null
    if (next && next !== b.topic) await act(`booklet "${b.booklet_name}": ${b.topic || '(none)'} → ${next}`, async () => must(await sb.from('booklets').update({ topic: next }).eq('id', b.id)))
    else if (!next && b.topic) log(`  ! booklet "${b.booklet_name}" keeps topic "${b.topic}" — no mapping`)
  }
}
log(`\n${apply ? 'Applied.' : 'Dry run — nothing changed. Re-run with --apply.'}`)

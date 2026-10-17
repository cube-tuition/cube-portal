#!/usr/bin/env node
/*
 * Copy the official Chemistry syllabus into the question bank's Topics.
 *
 *   node scripts/qbank-chem-syllabus.mjs          # dry run — prints what would change
 *   node scripts/qbank-chem-syllabus.mjs --apply
 *
 * For each Chemistry module on the Topics page (qbank_topics "Module N", Year
 * 11/12), its inquiry questions (qbank_subtopics) become the matching syllabus
 * module's dot points, in syllabus order: one per main dot point, its examples
 * as indented "–" lines, LaTeX turned to plain text. Re-running refreshes the
 * text and order of rows it copied before (matched by syllabus_dotpoint_id)
 * and adds new dot points; it never duplicates.
 *
 * Hand-typed rows with no syllabus link are removed when nothing uses them,
 * and kept (and reported) when something does.
 *
 * Questions already tagged with syllabus dot points (qbank_question_dotpoints,
 * from the old Chemistry picker) are tagged with the matching inquiry
 * questions too, so the switch loses no tagging.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { dotpointAsSubtopic } from '../lib/syllabusPlain.js'

const apply = process.argv.includes('--apply')
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const must = ({ data, error }) => { if (error) throw error; return data }
const moduleNo = (name) => Number(String(name).match(/^\s*Module\s+(\d+)/i)?.[1] || NaN)

const subjects = must(await sb.from('qbank_subjects').select('id, name, year_level').eq('name', 'Chemistry'))
const topics = must(await sb.from('qbank_topics').select('id, name, subject_id').in('subject_id', subjects.map(s => s.id)))
const sModules = must(await sb.from('syllabus_modules').select('id, name, year').eq('subject', 'Chemistry'))
const sTopics = must(await sb.from('syllabus_topics').select('id, module_id, sort_order').in('module_id', sModules.map(m => m.id)))
const sDots = must(await sb.from('syllabus_dotpoints').select('id, topic_id, parent_id, text, sort_order').in('topic_id', sTopics.map(t => t.id)))

// Anything that can point at a subtopic: a row referenced here is never deleted.
const refTables = [['qbank_questions', 'subtopic_id'], ['qbank_question_subtopics', 'subtopic_id'], ['qbank_skills', 'subtopic_id'],
  ['qbank_exam_slots', 'subtopic_id'], ['qbank_question_parts', 'subtopic_id'], ['qbank_worksheets', 'subtopic_id']]
async function isReferenced(id) {
  for (const [t, c] of refTables) if (must(await sb.from(t).select(c).eq(c, id).limit(1)).length) return t
  return null
}

const subtopicByDotpoint = {}   // main syllabus dot point id → qbank subtopic id
let inserted = 0, updated = 0, removed = 0
for (const topic of topics.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
  const year = subjects.find(s => s.id === topic.subject_id)?.year_level
  const sm = sModules.find(m => m.year === year && moduleNo(m.name) === moduleNo(topic.name))
  if (!sm) { console.log(`· Year ${year} ${topic.name}: no matching syllabus module — skipped`); continue }

  // Main dot points in syllabus order (by inquiry-question topic, then dot point), with their examples.
  const mains = []
  for (const st of sTopics.filter(t => t.module_id === sm.id).sort((a, b) => a.sort_order - b.sort_order)) {
    for (const d of sDots.filter(x => x.topic_id === st.id && !x.parent_id).sort((a, b) => a.sort_order - b.sort_order)) {
      mains.push({ ...d, subs: sDots.filter(x => x.parent_id === d.id).sort((a, b) => a.sort_order - b.sort_order) })
    }
  }

  const existing = must(await sb.from('qbank_subtopics').select('id, name, sort_order, syllabus_dotpoint_id').eq('topic_id', topic.id))
  // Hand-typed rows (no syllabus link) — the syllabus copy replaces them.
  for (const row of existing.filter(r => !r.syllabus_dotpoint_id)) {
    const used = await isReferenced(row.id)
    if (used) { console.log(`  ! kept hand-typed "${row.name.slice(0, 60)}…" — used in ${used}`); continue }
    if (apply) must(await sb.from('qbank_subtopics').delete().eq('id', row.id))
    removed++
  }
  let order = 0
  for (const d of mains) {
    const name = dotpointAsSubtopic(d.text, d.subs.map(s => s.text))
    const row = existing.find(r => r.syllabus_dotpoint_id === d.id)
    if (row) {
      if (row.name !== name || row.sort_order !== order) {
        if (apply) must(await sb.from('qbank_subtopics').update({ name, sort_order: order }).eq('id', row.id))
        updated++
      }
      subtopicByDotpoint[d.id] = row.id
    } else {
      if (apply) {
        const made = must(await sb.from('qbank_subtopics').insert({ topic_id: topic.id, name, sort_order: order, syllabus_dotpoint_id: d.id }).select('id').single())
        subtopicByDotpoint[d.id] = made.id
      }
      inserted++
    }
    for (const s of d.subs) subtopicByDotpoint[s.id] = subtopicByDotpoint[d.id]   // an example files under its dot point
    order++
  }
  console.log(`· Year ${year} ${topic.name} ← ${sm.name}: ${mains.length} inquiry questions`)
}

// Carry the old dot-point tags over to inquiry questions.
const tags = must(await sb.from('qbank_question_dotpoints').select('question_id, dotpoint_id'))
const pairs = new Map()
for (const t of tags) {
  const sub = subtopicByDotpoint[t.dotpoint_id]
  if (sub) pairs.set(`${t.question_id}|${sub}`, { question_id: t.question_id, subtopic_id: sub })
}
let tagged = 0, primary = 0
if (apply && pairs.size) {
  must(await sb.from('qbank_question_subtopics').upsert([...pairs.values()], { onConflict: 'question_id,subtopic_id', ignoreDuplicates: true }))
  tagged = pairs.size
  // A question's primary subtopic (what the bank filters on) — only where it has none.
  const byQ = {}
  for (const p of pairs.values()) (byQ[p.question_id] ||= []).push(p.subtopic_id)
  for (const [qid, subs] of Object.entries(byQ)) {
    const res = must(await sb.from('qbank_questions').update({ subtopic_id: subs[0] }).eq('id', qid).is('subtopic_id', null).select('id'))
    primary += res.length
  }
}
console.log(`\n${apply ? 'Applied' : 'Dry run'}: ${inserted} added, ${updated} refreshed, ${removed} hand-typed removed; ` +
  `${apply ? tagged : pairs.size || '(after apply)'} question tags carried over${apply ? `, ${primary} primary inquiry questions set` : ''}.`)

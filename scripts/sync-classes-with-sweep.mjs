#!/usr/bin/env node
/*
 * sync-classes-with-sweep.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Pulls Airtable Classes, diffs against Supabase, and reconciles:
 *   - Inserts/updates classes present in Airtable
 *   - Soft-archives Supabase classes whose airtable_id is NOT in Airtable
 *   - Re-activates classes that reappear (clears archived_at)
 *
 * Usage:
 *   node scripts/sync-classes-with-sweep.mjs          # dry-run, prints diff
 *   node scripts/sync-classes-with-sweep.mjs --apply  # actually write
 *
 * NB: this is the CLI version. The /api/sync-classes route should be updated
 * to match before the next scheduled sync runs.
 */
import Airtable from 'airtable'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const APPLY = process.argv.includes('--apply')

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const pickField = (fields, candidates) => {
  const keys = Object.keys(fields)
  for (const want of candidates) {
    const hit = keys.find(k => k.toLowerCase() === want.toLowerCase())
    if (hit && fields[hit] != null && fields[hit] !== '') return fields[hit]
  }
  return null
}
const parseTimeRange = (raw) => {
  if (!raw) return { start: null, end: null }
  const parts = String(raw).split(/\s*[-–—]\s*/)
  return { start: parts[0]?.trim() || null, end: parts[1]?.trim() || null }
}
const norm = (v) => (v == null ? null : String(v).trim() || null)

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
console.log('Pulling Airtable…')

const records = await new Promise((resolve, reject) => {
  const all = []
  base(process.env.AIRTABLE_CLASSES_TABLE).select().eachPage(
    (page, fetchNext) => { all.push(...page); fetchNext() },
    (err) => err ? reject(err) : resolve(all)
  )
})
console.log(`Airtable rows: ${records.length}`)

// Two sets:
//   seenIds  — every airtable_id we pulled (used to decide what to archive).
//              Includes admin/operation rows we *intentionally* skip — those
//              still exist in Airtable, so we shouldn't pretend they don't.
//   desired  — airtable_id → classRow for rows we actually want upserted.
const seenIds = new Set()
const desired = new Map()
let skippedAsAdmin = 0
for (const rec of records) {
  seenIds.add(rec.id)
  const f = rec.fields || {}
  const className = pickField(f, ['Courses','Course','Class','Class Name','Name','Class ID'])
  if (!className) continue
  const nm = String(className).toLowerCase()
  const room = String(pickField(f, ['Room']) || '').toLowerCase()
  if (['admin','operation','front desk','other'].some(k => nm.includes(k) || room.includes(k))) {
    skippedAsAdmin += 1
    continue
  }
  const { start, end } = parseTimeRange(pickField(f, ['Time']))
  desired.set(rec.id, {
    airtable_id: rec.id,
    class_name:  norm(className),
    day_of_week: norm(pickField(f, ['Day','Day of Week'])),
    start_time:  norm(start),
    end_time:    norm(end),
    teacher:     norm(pickField(f, ['Main Teacher','Teacher'])),
    room:        norm(pickField(f, ['Room'])),
  })
}
console.log(`Seen in Airtable: ${seenIds.size} | Desired: ${desired.size} | Skipped as admin/other: ${skippedAsAdmin}`)

// Load current state
const { data: existing, error: exErr } = await supabase
  .from('classes')
  .select('id, airtable_id, class_name, day_of_week, start_time, end_time, teacher, room, archived_at')
if (exErr) { console.error(exErr); process.exit(1) }
const byAirtableId = new Map(existing.filter(r => r.airtable_id).map(r => [r.airtable_id, r]))

const FIELDS = ['class_name','day_of_week','start_time','end_time','teacher','room']
const adds = [], updates = [], archives = [], reactivates = []

for (const [aid, want] of desired) {
  const cur = byAirtableId.get(aid)
  if (!cur) { adds.push(want); continue }
  const diffs = FIELDS.filter(k => (cur[k] ?? null) !== (want[k] ?? null))
  if (diffs.length) updates.push({ id: cur.id, name: want.class_name, diffs, want, cur })
  if (cur.archived_at) reactivates.push({ id: cur.id, name: want.class_name })
}
for (const cur of existing) {
  if (!cur.airtable_id) continue
  // Archive only if the row is genuinely missing from Airtable.
  // Rows that are present-but-skipped (admin/operation/other) are left alone.
  if (!seenIds.has(cur.airtable_id) && !cur.archived_at) {
    archives.push({ id: cur.id, name: cur.class_name, airtable_id: cur.airtable_id })
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('\n── DIFF ──────────────────────────────')
console.log(`+ insert      : ${adds.length}`)
console.log(`~ update      : ${updates.length}`)
console.log(`# reactivate  : ${reactivates.length}`)
console.log(`- archive     : ${archives.length}`)

if (adds.length) {
  console.log('\n+ INSERTS')
  for (const r of adds) console.log(`  + ${r.class_name} | ${r.day_of_week} ${r.start_time}–${r.end_time} | ${r.teacher} | ${r.room}`)
}
if (updates.length) {
  console.log('\n~ UPDATES')
  for (const u of updates) {
    console.log(`  ~ #${u.id} ${u.name}`)
    for (const k of u.diffs) console.log(`      ${k}: "${u.cur[k] ?? ''}" → "${u.want[k] ?? ''}"`)
  }
}
if (reactivates.length) {
  console.log('\n# REACTIVATES')
  for (const r of reactivates) console.log(`  # #${r.id} ${r.name}`)
}
if (archives.length) {
  console.log('\n- ARCHIVES (in Supabase, not in Airtable)')
  for (const a of archives) console.log(`  - #${a.id} ${a.name || '(no name)'} | airtable_id=${a.airtable_id}`)
}

if (!APPLY) {
  console.log('\nDry-run only. Re-run with --apply to commit changes.')
  process.exit(0)
}

// ── Apply ───────────────────────────────────────────────────────────────────
console.log('\nApplying…')
let n = 0
for (const r of adds) {
  const { error } = await supabase.from('classes').insert(r)
  if (error) console.log('  insert fail', r.class_name, error.message); else n++
}
console.log(`  inserted ${n}/${adds.length}`)

n = 0
for (const u of updates) {
  const patch = Object.fromEntries(u.diffs.map(k => [k, u.want[k]]))
  const { error } = await supabase.from('classes').update(patch).eq('id', u.id)
  if (error) console.log('  update fail #' + u.id, error.message); else n++
}
console.log(`  updated ${n}/${updates.length}`)

if (reactivates.length) {
  const ids = reactivates.map(r => r.id)
  const { error } = await supabase.from('classes').update({ archived_at: null }).in('id', ids)
  console.log(error ? '  reactivate fail ' + error.message : `  reactivated ${ids.length}`)
}

if (archives.length) {
  const ids = archives.map(a => a.id)
  const { error } = await supabase.from('classes').update({ archived_at: new Date().toISOString() }).in('id', ids)
  console.log(error ? '  archive fail ' + error.message : `  archived ${ids.length}`)
}

console.log('\nDone.')

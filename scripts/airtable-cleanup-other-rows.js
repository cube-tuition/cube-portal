#!/usr/bin/env node
/*
 * One-off cleanup: remove placeholder rows from the Airtable Classes table
 * where Class ID begins with "Other".
 *
 * Usage:
 *   node scripts/airtable-cleanup-other-rows.js          # dry-run (default)
 *   node scripts/airtable-cleanup-other-rows.js --apply  # actually delete
 *
 * Reads creds from .env.local in repo root.
 */

const fs = require('fs')
const path = require('path')

// Load .env.local manually (no dotenv dep needed)
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) process.env[m[1]] ??= m[2].trim()
  }
}

const Airtable = require('airtable')

const apply = process.argv.includes('--apply')

if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_CLASSES_TABLE) {
  console.error('Missing AIRTABLE_API_KEY / AIRTABLE_BASE_ID / AIRTABLE_CLASSES_TABLE in .env.local')
  process.exit(1)
}

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID)
const tableName = process.env.AIRTABLE_CLASSES_TABLE

async function main() {
  console.log(`\n→ Scanning "${tableName}" for rows where Class ID starts with "Other"...\n`)

  const matches = []
  await new Promise((resolve, reject) => {
    base(tableName)
      .select({ fields: ['Class ID', 'Course', 'Term', 'Day', 'Time', 'Main Teacher', 'Room', 'Students'] })
      .eachPage(
        (page, fetchNext) => {
          for (const r of page) {
            const classId = r.fields['Class ID'] || ''
            if (String(classId).trim().toLowerCase().startsWith('other')) {
              matches.push(r)
            }
          }
          fetchNext()
        },
        (err) => (err ? reject(err) : resolve())
      )
  })

  if (matches.length === 0) {
    console.log('No placeholder rows found. Nothing to do.')
    return
  }

  console.log(`Found ${matches.length} placeholder row(s):`)
  for (const r of matches) {
    console.log(`  • ${r.id}  Class ID="${r.fields['Class ID']}"  Course="${r.fields['Course'] || ''}"  Term="${r.fields['Term'] || ''}"`)
  }

  if (!apply) {
    console.log('\n(dry-run — re-run with --apply to delete)\n')
    return
  }

  console.log('\nDeleting...')
  // Airtable destroy() takes up to 10 ids at a time
  for (let i = 0; i < matches.length; i += 10) {
    const chunk = matches.slice(i, i + 10).map((r) => r.id)
    await base(tableName).destroy(chunk)
    console.log(`  ✓ deleted ${chunk.length}`)
  }
  console.log('\nDone.')
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})

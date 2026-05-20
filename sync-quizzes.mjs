import Airtable from 'airtable'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('🔄 Syncing revision quizzes from Airtable...')

const records = await new Promise((resolve, reject) => {
  const all = []
  base(process.env.AIRTABLE_QUIZ_TABLE).select().eachPage(
    (pageRecords, fetchNext) => {
      all.push(...pageRecords)
      fetchNext()
    },
    (err) => err ? reject(err) : resolve(all)
  )
})

console.log(`📋 Found ${records.length} quiz records in Airtable`)

for (const record of records) {
  const fields = record.fields
  const airtableId = record.id

  const studentName = fields['Student'] || ''
  const subject = fields['Subject'] || ''
  const week = fields['Week'] || ''
  const score = fields['Score'] ?? null
  const maxScore = fields['Max Score'] ?? null
  const quizDate = fields['Date'] || null

  // Skip if missing key fields
  if (!studentName || !subject || score === null) {
    console.log(`⏭️  Skipping incomplete record`)
    continue
  }

  // Find student by name
  const { data: student } = await supabase
    .from('students')
    .select('id')
    .ilike('full_name', studentName.trim())
    .single()

  if (!student) {
    console.log(`⚠️  Student "${studentName}" not found`)
    continue
  }

  const homeworkGrade = fields['Homework Grade'] || fields['homework grade'] || null

  const { error } = await supabase
    .from('quiz_results')
    .upsert({
      airtable_id: airtableId,
      student_id: student.id,
      subject,
      week,
      score,
      max_score: maxScore,
      quiz_date: quizDate,
      homework_grade: homeworkGrade,
    }, { onConflict: 'airtable_id' })

  if (error) {
    console.log(`❌ Failed for ${studentName} ${subject} ${week}:`, error.message)
  } else {
    console.log(`✅ Synced: ${studentName} | ${subject} | ${week} | ${score}/${maxScore}`)
  }
}

console.log('🎉 Quiz sync complete!')
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

console.log('🔄 Syncing classes from Airtable...')

const records = await new Promise((resolve, reject) => {
  const all = []
  base(process.env.AIRTABLE_CLASSES_TABLE).select().eachPage(
    (pageRecords, fetchNext) => {
      all.push(...pageRecords)
      fetchNext()
    },
    (err) => err ? reject(err) : resolve(all)
  )
})

console.log(`📋 Found ${records.length} classes in Airtable`)

for (const record of records) {
  const fields = record.fields
  const airtableId = record.id

  // Get time — skip if missing
  const timeRaw = fields['Time'] || fields['time'] || ''
  const timeString = typeof timeRaw === 'string' ? timeRaw : String(timeRaw || '')

  if (!timeString.trim()) {
    console.log(`⏭️  Skipping "${fields['Courses'] || fields['Class ID']}" — no time set`)
    continue
  }

  // Parse time — handles "4:30 - 6:00" or "4:30-6:00"
  const timeParts = timeString.split('-')
  const startTime = timeParts[0]?.trim() || ''
  const endTime = timeParts[1]?.trim() || ''

  const classData = {
    airtable_id: airtableId,
    class_name: fields['Courses'] || fields['Class name'] || fields['Name'] || '',
    day_of_week: fields['Day'] || fields['day'] || '',
    start_time: startTime,
    end_time: endTime,
    teacher: fields['Main Teacher'] || fields['Teacher'] || fields['teacher'] || '',
    room: fields['Room'] || fields['room'] || '',
  }

  // Skip admin/operation rows
  const skipKeywords = ['admin', 'operation', 'front desk', 'other']
  const isAdmin = skipKeywords.some(k =>
    classData.class_name.toLowerCase().includes(k) ||
    classData.room.toLowerCase().includes(k)
  )
  if (isAdmin) {
    console.log(`⏭️  Skipping admin row: "${classData.class_name}"`)
    continue
  }

  const { data: classRow, error: classError } = await supabase
    .from('classes')
    .upsert(classData, { onConflict: 'airtable_id' })
    .select()
    .single()

  if (classError) {
    console.log(`❌ Failed to sync "${classData.class_name}":`, classError.message)
    continue
  }

  console.log(`✅ Synced: ${classData.class_name} | ${classData.day_of_week} ${startTime}–${endTime} | ${classData.teacher} | ${classData.room}`)

  // Link students — comma separated names
  const studentsRaw = fields['Students'] || fields['students'] || ''
  if (!studentsRaw || typeof studentsRaw !== 'string') continue

  const studentNames = studentsRaw
    .split(',')
    .map(n => n.trim())
    .filter(n => n.length > 1)

  for (const studentName of studentNames) {
    const { data: student } = await supabase
      .from('students')
      .select('id')
      .ilike('full_name', studentName)
      .single()

    if (!student) {
      console.log(`  ⚠️  "${studentName}" not found in students table`)
      continue
    }

    const { error: linkError } = await supabase
      .from('enrolments')
      .upsert({
        student_id: student.id,
        class_id: classRow.id
      }, { onConflict: 'student_id,class_id' })

    if (linkError) {
      console.log(`  ❌ Failed to link "${studentName}":`, linkError.message)
    } else {
      console.log(`  👤 Linked: ${studentName}`)
    }
  }
}

console.log('🎉 Class sync complete!')
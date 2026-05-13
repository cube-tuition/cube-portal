import Airtable from 'airtable'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// Connect to Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID)

// Connect to Supabase with service role (admin access)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Auto-generates email from name e.g. "Sarah Lin" → "sarahlin@cubetuition.com"
function generateEmail(name) {
  if (!name) return null
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${clean}@cubetuition.com`
}

console.log('🔄 Starting Airtable → Supabase sync...')

const records = await new Promise((resolve, reject) => {
  const all = []
  base(process.env.AIRTABLE_TABLE_NAME).select().eachPage(
    (pageRecords, fetchNext) => {
      all.push(...pageRecords)
      fetchNext()
    },
    (err) => err ? reject(err) : resolve(all)
  )
})

console.log(`📋 Found ${records.length} students in Airtable`)

for (const record of records) {
  const fields = record.fields
  const airtableId = record.id
  const fullName = fields['Full name'] || fields['Full Name'] || ''

  // Use real email if available, otherwise generate one
  const realEmail = fields['Student email'] || fields['student email'] || ''
  const email = realEmail || generateEmail(fullName)

  if (!email) {
    console.log(`⚠️  Skipped: couldn't generate email for "${fullName}"`)
    continue
  }

  const studentData = {
    airtable_id: airtableId,
    full_name: fullName,
    email: email,
    school: fields['School'] || fields['school'] || '',
    school_year: fields['School Year'] || fields['school year'] || '',
  }

  // Check if student already exists in Supabase by airtable_id
  const { data: existing } = await supabase
    .from('students')
    .select('id, email')
    .eq('airtable_id', airtableId)
    .single()

  if (existing) {
    // Update existing student info
    const { error } = await supabase
      .from('students')
      .update({
        full_name: studentData.full_name,
        school: studentData.school,
        school_year: studentData.school_year,
      })
      .eq('airtable_id', airtableId)

    if (error) {
      console.log(`❌ Failed to update ${fullName}:`, error.message)
    } else {
      console.log(`✅ Updated: ${fullName}`)
    }

  } else {
    // New student — create auth account + students row
    const tempPassword = 'Cube2025!'

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: tempPassword,
      email_confirm: true
    })

    if (authError) {
      console.log(`❌ Auth failed for ${fullName}: ${authError.message}`)
      continue
    }

    const { error: insertError } = await supabase
      .from('students')
      .insert({
        id: authUser.user.id,
        ...studentData
      })

    if (insertError) {
      console.log(`❌ DB insert failed for ${fullName}:`, insertError.message)
    } else {
      console.log(`🆕 Created: ${fullName} → ${email} / password: ${tempPassword}`)
    }
  }
}

console.log('🎉 Sync complete!')
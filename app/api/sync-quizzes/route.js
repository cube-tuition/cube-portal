import Airtable from 'airtable'
import { createClient } from '@supabase/supabase-js'
import { T_QUIZ_RESULTS, T_STUDENTS } from '../../../lib/tables'

export async function GET(request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
      .base(process.env.AIRTABLE_BASE_ID)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

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

    const results = { synced: [], failed: [] }

    for (const record of records) {
      const fields = record.fields
      const studentName = fields['Student'] || ''
      const subject = fields['Subject'] || ''
      const score = fields['Score'] ?? null
      const maxScore = fields['Max Score'] ?? null

      if (!studentName || !subject || score === null) continue

      const { data: student } = await supabase
        .from(T_STUDENTS)
        .select('id')
        .ilike('full_name', studentName.trim())
        .single()

      if (!student) { results.failed.push(studentName); continue }

      const { error } = await supabase
        .from(T_QUIZ_RESULTS)
        .upsert({
          airtable_id: record.id,
          student_id: student.id,
          subject,
          week: fields['Week'] || '',
          score,
          max_score: maxScore,
          quiz_date: fields['Date'] || null,
        }, { onConflict: 'airtable_id' })

      if (error) {
        results.failed.push(studentName)
      } else {
        results.synced.push(`${studentName} - ${subject}`)
      }
    }

    return Response.json({
      success: true,
      synced: results.synced.length,
      failed: results.failed.length
    })

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
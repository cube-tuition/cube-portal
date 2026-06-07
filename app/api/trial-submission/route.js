import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/**
 * POST /api/trial-submission
 *
 * Public CORS-enabled endpoint called by the cubetuition.com.au free trial form.
 *
 * Accepts the raw form shape from the website:
 * {
 *   year, subjects, availability,
 *   studentFirstName, studentLastName, studentEmail, studentPhone,
 *   school, referredBy,
 *   parentFirstName, parentLastName, relationship,
 *   parentEmail, parentPhone,
 *   notes,
 *   source  (optional, defaults to 'website_form')
 * }
 */
export async function POST(req) {
  try {
    const body = await req.json()

    const {
      // Student
      year, subjects, availability,
      studentFirstName, studentLastName, studentEmail, studentPhone,
      school, referredBy,
      // Parent
      parentFirstName, parentLastName, relationship,
      parentEmail, parentPhone,
      notes,
      source = 'website_form',
    } = body

    const studentName = [studentFirstName, studentLastName].filter(Boolean).join(' ') || null
    const parentName  = [parentFirstName,  parentLastName ].filter(Boolean).join(' ') || null

    if (!parentEmail && !parentPhone && !studentName) {
      return NextResponse.json(
        { error: 'At least one contact field is required.' },
        { status: 400, headers: CORS }
      )
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // ── Create student record ─────────────────────────────────────────────
    const { data: student, error: studentErr } = await sb
      .from('students')
      .insert({
        full_name: studentName || 'Unknown',
        year:      year        || null,
        school:    school      || null,
        email:     studentEmail || null,
        phone:     studentPhone || null,
        status:    'trial',
      })
      .select('id')
      .single()

    if (studentErr) {
      console.error('[trial-submission] Student creation error:', studentErr)
      return NextResponse.json({ error: studentErr.message }, { status: 500, headers: CORS })
    }

    // ── Create guardian record ────────────────────────────────────────────
    if (parentName || parentEmail || parentPhone) {
      await sb.from('guardians').insert({
        student_id: student.id,
        full_name:  parentName   || null,
        email:      parentEmail  || null,
        phone:      parentPhone  || null,
        relationship: relationship || null,
      })
    }

    // ── Create trial enrolment (no class yet — assigned from trials page) ─
    await sb.from('enrolments').insert({
      student_id:       student.id,
      class_id:         null,
      status:           'trial',
      next_term_status: 'confirmed',
    })

    // ── Create trial_submissions row for admin pipeline ───────────────────
    const { data: submission, error: insertErr } = await sb
      .from('trial_submissions')
      .insert({
        student_name:         studentName,
        student_year:         year         || null,
        student_email:        studentEmail || null,
        student_phone:        studentPhone || null,
        school:               school       || null,
        subjects:             Array.isArray(subjects) ? subjects : (subjects ? [subjects] : null),
        availability:         availability || null,
        parent_name:          parentName,
        parent_email:         parentEmail  || null,
        parent_phone:         parentPhone  || null,
        relationship:         relationship || null,
        how_heard:            referredBy   || null,
        notes:                notes        || null,
        source,
        converted_student_id: student.id,
      })
      .select('id')
      .single()

    if (insertErr) {
      console.error('[trial-submission] DB error:', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500, headers: CORS })
    }

    // ── Admin notification email ──────────────────────────────────────────
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'admin@cubetuition.com.au'
    const subjectList = Array.isArray(subjects) ? subjects.join(', ') : (subjects || '—')
    const availText = availability
      ? Object.entries(availability)
          .map(([day, slots]) => `${day}: ${slots.join(', ')}`)
          .join(' | ')
      : '—'

    const emailText = [
      `New free trial submission #${submission.id}`,
      '',
      `Student:      ${studentName || '—'}, Year ${year || '?'}`,
      `School:       ${school || '—'}`,
      `Subjects:     ${subjectList}`,
      `Availability: ${availText}`,
      `Student email: ${studentEmail || '—'}`,
      `Student phone: ${studentPhone || '—'}`,
      '',
      `Parent:       ${parentName || '—'} (${relationship || '—'})`,
      `Email:        ${parentEmail || '—'}`,
      `Phone:        ${parentPhone || '—'}`,
      '',
      `Referred by:  ${referredBy || '—'}`,
      notes ? `Notes: ${notes}` : '',
      '',
      `View in portal: ${process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.cubetuition.com.au'}/tutor/trials`,
    ].filter(l => l !== null).join('\n')

    if (process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    'CUBE Portal <noreply@cubetuition.com.au>',
            to:      [adminEmail],
            subject: `New free trial: ${studentName || 'Unknown'} (Year ${year || '?'}) — ${subjectList}`,
            text:    emailText,
          }),
        })
      } catch (e) {
        console.warn('[trial-submission] Email failed (non-fatal):', e.message)
      }
    }

    return NextResponse.json({ success: true, id: submission.id }, { headers: CORS })
  } catch (err) {
    console.error('[trial-submission] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS })
  }
}

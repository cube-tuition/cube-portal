import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

/*
 * POST /api/send-end-of-term-emails
 *
 * Body: {
 *   term_id:   string,
 *   term_name: string,
 *   template:  string,  // plain text with {{placeholders}}
 *   families:  Array<{
 *     parent_name:  string,
 *     parent_email: string,
 *     students: Array<{ student_id, student_name, class_id, class_name }>
 *   }>
 * }
 *
 * For each family:
 *   - Fetches each student's PDF from Supabase Storage (term-reports/{term_id}/{student_id}_{class_id}.pdf)
 *   - Fills the email template with family-specific values
 *   - Sends via Resend with PDFs as attachments
 *
 * Env vars required:
 *   RESEND_API_KEY              — from resend.com
 *   SUPABASE_SERVICE_ROLE_KEY   — from Supabase → Settings → API
 *   RESEND_FROM_EMAIL           — e.g. reports@yourdomain.com (must be verified in Resend)
 *                                  defaults to onboarding@resend.dev for testing
 */


function followupDate() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fillTemplate(template, vars) {
  return template
    .replace(/\{\{parent_name\}\}/g,    vars.parentName   || 'there')
    .replace(/\{\{term_name\}\}/g,      vars.termName     || '')
    .replace(/\{\{student_names\}\}/g,  vars.studentNames || '')
    .replace(/\{\{possessive\}\}/g,     vars.possessive   || 'their')
    .replace(/\{\{they_have\}\}/g,      vars.theyHave     || 'they have')
    .replace(/\{\{plural\}\}/g,         vars.plural       || '')
    .replace(/\{\{followup_date\}\}/g,  vars.followupDate || followupDate())
    .replace(/\[date\]/gi,              vars.followupDate || followupDate())
}

function toHtml(plainText) {
  const escaped = plainText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paragraphs = escaped
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 16px 0;line-height:1.7;">${p.replace(/\n/g, '<br/>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`)
    .join('')
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#2A2035;background:#ffffff;">
      <div style="background:#062E63;border-radius:12px;padding:18px 24px;margin-bottom:32px;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.55);font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      </div>
      <div style="font-size:15px;">${paragraphs}</div>
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #DEE7FF;font-size:11px;color:#325099;opacity:0.6;">
        CUBE Tuition · This email was sent from the CUBE staff portal.
      </div>
    </div>
  `
}

export async function POST(request) {
  try {
    const { term_id, term_name, template, families } = await request.json()

    if (!term_id || !families?.length) {
      return Response.json({ error: 'Missing term_id or families' }, { status: 400 })
    }

    // Service-role Supabase client for private Storage access
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const results = []

    for (const family of families) {
      const attachments  = []
      const missingPDFs  = []

      for (const student of family.students) {
        const path = `${term_id}/${student.student_id}_${student.class_id}.pdf`

        // Get a short-lived signed URL then fetch the bytes
        const { data: signed } = await sb.storage
          .from('term-reports')
          .createSignedUrl(path, 120)

        if (signed?.signedUrl) {
          const fileRes = await fetch(signed.signedUrl)
          if (fileRes.ok) {
            const buffer = await fileRes.arrayBuffer()
            const safeName = student.student_name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')
            const safeTerm = term_name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')
            attachments.push({
              filename: `${safeName}_${safeTerm}_Report.pdf`,
              content:  Buffer.from(buffer).toString('base64'),
            })
          } else {
            missingPDFs.push(student.student_name)
          }
        } else {
          missingPDFs.push(student.student_name)
        }
      }

      // Build template vars — deduplicate by student_id so multi-class students aren't repeated
      const uniqueStudents = family.students.filter((s, idx, arr) => arr.findIndex(x => x.student_id === s.student_id) === idx)
      const firstNames   = uniqueStudents.map(s => s.student_name.split(' ')[0])
      const count        = firstNames.length
      const studentNames = count === 1
        ? firstNames[0]
        : firstNames.slice(0, -1).join(', ') + ' and ' + firstNames.slice(-1)

      const bodyText = fillTemplate(template, {
        parentName:   family.parent_name || 'there',
        termName:     term_name,
        studentNames,
        possessive:   'their',
        theyHave:     count === 1 ? 'they have' : 'they have',
        plural:       count > 1 ? 's' : '',
      })

      const subjectNames = firstNames.join(' & ')
      const subject = `${term_name} Report${count > 1 ? 's' : ''} — ${subjectNames} | CUBE Tuition`

      const { data: sendData, error: sendErr } = await resend.emails.send({
        from:        `CUBE Tuition <${fromEmail}>`,
        to:          [family.parent_email],
        subject,
        html:        toHtml(bodyText),
        attachments: attachments.length > 0 ? attachments : undefined,
      })

      results.push({
        family:      family.parent_name,
        email:       family.parent_email,
        students:    family.students.map(s => s.student_name),
        success:     !sendErr,
        error:       sendErr?.message || null,
        attached:    attachments.length,
        missingPDFs: missingPDFs.length > 0 ? missingPDFs : undefined,
      })
    }

    const successCount = results.filter(r => r.success).length
    return Response.json({ results, successCount, total: results.length })

  } catch (err) {
    console.error('[send-end-of-term-emails]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

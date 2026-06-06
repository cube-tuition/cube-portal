import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { generateInvoicePdfBuffer } from '../../../lib/invoicePdf'

/*
 * POST /api/send-term-start-emails
 *
 * Body: {
 *   term_id:    string,        // used to look up approved invoices
 *   term_name:  string,
 *   term_dates: string,        // e.g. "21 Jul – 26 Sep 2026 (10 weeks)"
 *   template:   string,        // plain text with {{placeholders}}
 *   families:   Array<{
 *     family_id?:   string,
 *     student_ids?: string[],
 *     parent_name:  string,
 *     parent_email: string,
 *     students: Array<{ student_name, class_name, class_day?, class_start? }>
 *   }>
 * }
 *
 * For each family, if an approved invoice exists it is generated as a PDF
 * and attached to the email. Families without an approved invoice still
 * receive the email — just without an attachment.
 */

function followupDate() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function buildClassDetails(students) {
  const unique = students.filter((s, i, a) =>
    a.findIndex(x => x.student_name === s.student_name && x.class_name === s.class_name) === i
  )
  return unique.map(s => {
    const time = [
      s.class_day,
      s.class_start && s.class_end ? `${s.class_start} - ${s.class_end}` : s.class_start,
    ].filter(Boolean).join(' ')
    const trial = s.enr_status === 'trial' ? ' (Trial)' : ''
    return `  • ${s.student_name} — ${s.class_name}${time ? ' · ' + time : ''}${trial}`
  }).join('\n')
}

function fillTemplate(template, vars) {
  return template
    .replace(/\{\{parent_name\}\}/g,    vars.parentName    || 'there')
    .replace(/\{\{term_name\}\}/g,      vars.termName      || '')
    .replace(/\{\{term_dates\}\}/g,     vars.termDates     || '')
    .replace(/\{\{term_start\}\}/g,     vars.termStart     || '')
    .replace(/\{\{student_names\}\}/g,  vars.studentNames  || '')
    .replace(/\{\{class_details\}\}/g,  vars.classDetails  || '')
    .replace(/\{\{followup_date\}\}/g,  vars.followupDate  || followupDate())
    .replace(/\[date\]/gi,              vars.followupDate  || followupDate())
    .replace(/\{\{possessive\}\}/g,     vars.possessive    || 'their')
    .replace(/\{\{they_have\}\}/g,      'they have')
    .replace(/\{\{plural\}\}/g,         vars.plural        || '')
}

function toHtml(plainText) {
  const escaped = plainText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paragraphs = escaped
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 16px 0;line-height:1.7;">${
      p.replace(/\n/g, '<br/>')
       .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    }</p>`)
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
    const { term_id, term_name, term_dates, term_start, template, families } = await request.json()

    if (!families?.length) {
      return Response.json({ error: 'Missing families' }, { status: 400 })
    }

    // ── Load approved invoices for this term ────────────────────────────────
    let invoiceByFamily  = {}
    let invoiceByStudent = {}

    if (term_id) {
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )

      // Also fetch term for PDF (name + dates)
      const { data: term } = await sb.from('terms')
        .select('name, start_date, end_date').eq('id', term_id).maybeSingle()

      const { data: invoices } = await sb.from('invoices')
        .select('*')
        .eq('term_id', term_id)
        .in('status', ['approved', 'synced_to_xero', 'sent', 'awaiting_payment', 'paid'])

      // Fetch guardians for all invoices so the PDF has parent_name/email/phone
      const allStudentIds = [...new Set((invoices || []).flatMap(inv =>
        (inv.line_items || []).filter(l => l.type === 'enrolment').map(l => l.student_id).filter(Boolean)
      ))]
      const { data: guardians } = allStudentIds.length
        ? await sb.from('guardians').select('student_id, full_name, email, phone').in('student_id', allStudentIds)
        : { data: [] }
      const guardianMap = Object.fromEntries((guardians || []).map(g => [g.student_id, g]))

      for (const inv of invoices || []) {
        // Enrich invoice with parent info for the PDF
        const firstStudentId = (inv.line_items || []).find(l => l.type === 'enrolment')?.student_id
        const guardian       = guardianMap[firstStudentId] || {}
        inv._enriched = {
          ...inv,
          parent_name:  guardian.full_name || '',
          parent_email: guardian.email     || '',
          parent_phone: guardian.phone     || '',
        }
        inv._termName  = term?.name       || term_name || ''
        inv._termDates = term_dates        || ''

        if (inv.family_id)  invoiceByFamily[inv.family_id]   = inv
        if (inv.student_id) invoiceByStudent[inv.student_id] = inv
        // Also index by each enrolment student_id for sibling matching
        for (const l of inv.line_items || []) {
          if (l.type === 'enrolment' && l.student_id) {
            invoiceByStudent[l.student_id] = inv
          }
        }
      }
    }

    // ── Send emails ─────────────────────────────────────────────────────────
    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const results   = []

    for (const family of families) {
      const uniqueStudents = family.students.filter((s, i, a) =>
        a.findIndex(x => x.student_name === s.student_name && x.class_name === s.class_name) === i
      )
      const firstNames   = uniqueStudents.map(s => s.student_name.split(' ')[0])
      const count        = firstNames.length
      const studentNames = count === 1
        ? firstNames[0]
        : firstNames.slice(0, -1).join(', ') + ' and ' + firstNames.slice(-1)

      const bodyText = fillTemplate(template, {
        parentName:   family.parent_name || 'there',
        termName:     term_name,
        termDates:    term_dates || '',
        termStart:    term_start || '',
        studentNames,
        classDetails: buildClassDetails(family.students),
        possessive:   'their',
        plural:       count > 1 ? 's' : '',
        followupDate: followupDate(),
      })

      const subject = `${term_name} — Re-enrolment Confirmation | CUBE Tuition`

      // ── Find matching invoice ──────────────────────────────────────────────
      let matchedInv = null
      if (family.family_id && invoiceByFamily[family.family_id]) {
        matchedInv = invoiceByFamily[family.family_id]
      } else if (family.student_ids?.length) {
        for (const sid of family.student_ids) {
          if (invoiceByStudent[sid]) { matchedInv = invoiceByStudent[sid]; break }
        }
      }

      // ── Generate PDF attachment if invoice found ───────────────────────────
      let attachments = []
      let invoiceAttached = false
      if (matchedInv) {
        try {
          const enriched = matchedInv._enriched || matchedInv
          // Use the family's actual parent_email from the send list if not on invoice
          if (!enriched.parent_email && family.parent_email) enriched.parent_email = family.parent_email
          if (!enriched.parent_name  && family.parent_name)  enriched.parent_name  = family.parent_name
          const pdfBuffer = await generateInvoicePdfBuffer(
            enriched,
            matchedInv._termName  || term_name,
            matchedInv._termDates || term_dates,
          )
          attachments = [{
            filename: `${matchedInv.invoice_number || 'invoice'}.pdf`,
            content:  pdfBuffer,
          }]
          invoiceAttached = true
        } catch (pdfErr) {
          console.error('[send-term-start-emails] PDF generation failed:', pdfErr.message)
          // Send email without attachment rather than failing the whole send
        }
      }

      const { data: sendData, error: sendErr } = await resend.emails.send({
        from:        `CUBE Tuition <${fromEmail}>`,
        to:          [family.parent_email],
        subject,
        html:        toHtml(bodyText),
        attachments: attachments.length ? attachments : undefined,
      })

      results.push({
        family:          family.parent_name,
        email:           family.parent_email,
        success:         !sendErr,
        error:           sendErr?.message || null,
        invoiceAttached,
        invoiceNumber:   matchedInv?.invoice_number || null,
      })
    }

    const successCount = results.filter(r => r.success).length
    const attachedCount = results.filter(r => r.invoiceAttached).length
    return Response.json({ results, successCount, attachedCount, total: results.length })

  } catch (err) {
    console.error('[send-term-start-emails]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

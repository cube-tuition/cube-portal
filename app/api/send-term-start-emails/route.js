import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { generateInvoicePdfBuffer } from '../../../lib/invoicePdf'
import { requireApiRole } from '../../../lib/apiAuth'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'

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
    // Trial marker sits on the class name (the bold line of the schedule
    // card), not after the time where it would land on the muted when-line.
    const trial = s.enr_status === 'trial' ? ' (Trial)' : ''
    return `  • ${s.student_name} — ${s.class_name}${trial}${time ? ' · ' + time : ''}`
  }).join('\n')
}

function fillTemplate(template, vars) {
  return template
    .replace(/\{\{parent_name\}\}/g,    vars.parentName    || 'there')
    .replace(/\{\{term_name\}\}/g,      vars.termName      || '')
    .replace(/\{\{term_short\}\}/g,     (vars.termName || '').replace(/\s*\d{4}\s*$/, '').trim())
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

// Render the {{class_details}} bullet lines as a stack of accented schedule
// cards — one per class, day/time called out beneath the class name. Shared
// shape with the preview (app/tutor/emails/term-start/page.js).
function scheduleCardHtml(lines) {
  const rows = lines.filter(l => l.trim()).map(l => {
    const text = l.replace(/^\s*•\s*/, '').trim()
    const i    = text.indexOf(' · ')
    const head = i === -1 ? text : text.slice(0, i)
    const when = i === -1 ? '' : text.slice(i + 3)
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 9px;"><tr>`
      + `<td style="border-left:2px solid #D5DEF0;padding:1px 0 1px 12px;">`
      + `<div style="font-size:14px;font-weight:600;color:#22324F;line-height:1.4;">${head}</div>`
      + (when ? `<div style="font-size:12.5px;font-weight:500;color:#6B7A99;margin-top:1px;">${when}</div>` : '')
      + `</td></tr></table>`
  }).join('')
  return `<div style="margin:6px 0 16px;">${rows}</div>`
}

// Split a paragraph block into consecutive runs of bullet lines vs text lines,
// so the schedule list renders even when it shares a block with an intro line.
function segmentBlock(block) {
  const segs = []
  for (const line of block.split('\n')) {
    const isB = line.trim().startsWith('•')
    const last = segs[segs.length - 1]
    if (last && last.bullets === isB) last.lines.push(line)
    else segs.push({ bullets: isB, lines: [line] })
  }
  return segs
}

function toHtml(plainText, { termName = '' } = {}) {
  const escaped = plainText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const bold = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#062E63;">$1</strong>')

  // Render blocks; runs of "•" lines (the {{class_details}} list) become a
  // highlighted schedule card — even when they share a block with an intro
  // sentence (single newline, no blank line before the bullets).
  const blocks = escaped.split(/\n\n+/).map(block =>
    segmentBlock(block).map(seg => {
      if (seg.bullets) return scheduleCardHtml(seg.lines)
      const html = seg.lines.join('\n').trim()
      return html ? `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#2A2035;">${bold(html).replace(/\n/g, '<br/>')}</p>` : ''
    }).join('')
  ).join('')

  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#EEF2FB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2FB;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <tr><td style="background:#062E63;border-radius:16px 16px 0 0;padding:26px 32px;">
    <span style="color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">CUBE</span>
    <span style="color:rgba(255,255,255,0.55);font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-left:10px;">Tuition</span>
    ${termName ? `<span style="float:right;color:#9DB6E8;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding-top:8px;">${termName}</span>` : ''}
  </td></tr>
  <tr><td style="background:#ffffff;padding:34px 32px 24px;">
    ${blocks}
  </td></tr>
  <tr><td style="background:#F0F4FF;border-radius:0 0 16px 16px;padding:16px 32px;">
    <p style="margin:0;font-size:11px;line-height:1.7;color:#325099;opacity:0.75;">
      CUBE Tuition · Chatswood<br/>
      Questions? Just reply to this email — we read every one.
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { term_id, term_name, term_dates, term_start, template, subject, families, test } = await request.json()
    const subjectTemplate = subject || '{{term_name}} — Re-enrolment Confirmation | CUBE Tuition'

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

      // A family with a personalised body uses it verbatim (its placeholders are
      // already resolved); otherwise fall back to the shared template.
      const vars = {
        parentName:   family.parent_name || 'there',
        termName:     term_name,
        termDates:    term_dates || '',
        termStart:    term_start || '',
        studentNames,
        classDetails: buildClassDetails(family.students),
        possessive:   'their',
        plural:       count > 1 ? 's' : '',
        followupDate: followupDate(),
      }
      const bodyText = fillTemplate(family.custom_body || template, vars)
      const subject  = fillTemplate(subjectTemplate, vars)

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

      const { data: sendData, error: sendErr } = await resend.emails.send(applyEmailTestMode({
        from:        `CUBE Tuition <${fromEmail}>`,
        to:          [family.parent_email],
        bcc:         [PORTAL_BCC],
        subject,
        html:        toHtml(bodyText, { termName: term_name }),
        attachments: attachments.length ? attachments : undefined,
      }, test))

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

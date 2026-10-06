import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { buildAbsenceEmailHtml, fillAbsenceVars } from '../../../lib/absenceEmail'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/send-absence-email
 *
 * Body: {
 *   caseId:   uuid,       // the absence case the email is about
 *   to:       string[],   // guardian addresses, chosen in the case panel
 *   vars:     { parentName, studentName, className, date },
 *   content:  { subject, body, boxHeading },
 *   items:    string[],   // session lines for the box (options / booking)
 *   test?:    boolean,    // deliver to staff only (applyEmailTestMode)
 * }
 *
 * Sends one family an email about one absence, then logs it on the case
 * ('email' note, signed by the sender) and — for a real send — moves a case
 * nobody had followed up yet to "awaiting reply". Staff-only; the recipients
 * must be guardians of the case's student, so this is never an open relay.
 */
export async function POST(request) {
  try {
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { caseId, to, vars, content, items, test } = await request.json()
    if (!caseId || !Array.isArray(to) || !to.length) return Response.json({ error: 'Missing case or recipients' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data: kase } = await sb.from('absence_cases').select('id, student_id, stage').eq('id', caseId).maybeSingle()
    if (!kase) return Response.json({ error: 'Case not found' }, { status: 404 })

    // Only this student's guardians.
    const { data: guardians } = await sb.from('guardians').select('email').eq('student_id', kase.student_id)
    const allowed = new Set((guardians || []).map(g => String(g.email || '').trim().toLowerCase()).filter(Boolean))
    const recipients = to.map(e => String(e || '').trim()).filter(e => allowed.has(e.toLowerCase()))
    if (!recipients.length) return Response.json({ error: 'None of those addresses belong to this student’s guardians' }, { status: 400 })

    const subject = fillAbsenceVars(content?.subject, vars).trim() || 'About your child’s lesson'
    const resend = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const { error } = await resend.emails.send(applyEmailTestMode({
      from: `CUBE Tuition <${fromEmail}>`,
      to: recipients,
      bcc: [PORTAL_BCC],
      subject,
      html: buildAbsenceEmailHtml(vars, content, items),
    }, test))
    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (!test) {
      const { data: me } = await sb.from('directors').select('full_name').eq('id', auth.user.id).maybeSingle()
      await sb.from('absence_case_notes').insert({
        case_id: kase.id, kind: 'email',
        body: `Emailed ${recipients.join(', ')}: “${subject}”${(items || []).length ? ` — ${items.join('; ')}` : ''}`,
        author_id: auth.user.id,
        author_name: me?.full_name || auth.user.email || null,
      })
      if (kase.stage === 'new') {
        await sb.from('absence_cases').update({ stage: 'contacted', updated_at: new Date().toISOString() }).eq('id', kase.id)
      }
    }
    return Response.json({ success: true, sentTo: test ? 'staff (test)' : recipients })
  } catch (err) {
    console.error('[send-absence-email]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

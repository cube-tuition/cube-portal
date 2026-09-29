import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { buildReviewEmailHtml, reviewEmailSubject, isValidReviewUrl, mergeReviewContent, REVIEW_LOG_KEY } from '../../../lib/reviewEmail'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * POST /api/send-review-emails
 *
 * Body: {
 *   content:   editable-content overrides (see lib/reviewEmail.js),
 *   reminder?: boolean,          // send the reminder variant
 *   test?:     boolean,          // true → redirect every send to CUBE staff (marked TEST)
 *   families:  Array<{ parent_name, parent_email, students: [full names] }>
 * }
 *
 * Asks each family for a Google review. Real (non-test) sends are recorded in
 * portal_settings[review_request_log] — { email: { asked, reminded } } — so the
 * page can show who has been asked and offer the reminder only to them.
 */

export async function POST(request) {
  try {
    // Staff-only: this route sends mail from CUBE's verified domain.
    const auth = await requireApiRole(request, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { content, reminder = false, test = false, families } = await request.json()
    const c = mergeReviewContent(content)
    if (!isValidReviewUrl(c.reviewUrl)) {
      return Response.json({ error: 'Set the Google review link (an https:// link) before sending.' }, { status: 400 })
    }
    if (!families?.length) return Response.json({ error: 'Missing families' }, { status: 400 })

    const resend    = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const subject   = reviewEmailSubject(content, { reminder })

    const results = []
    for (const family of families) {
      if (!family.parent_email) {
        results.push({ family: family.parent_name, email: null, success: false, error: 'No email address' })
        continue
      }
      const html = buildReviewEmailHtml({
        parentName: family.parent_name,
        studentNames: family.student_names,
      }, content, { reminder })
      const { error: sendErr } = await resend.emails.send(applyEmailTestMode({
        from: `CUBE Tuition <${fromEmail}>`,
        to: [family.parent_email],
        bcc: [PORTAL_BCC],
        subject,
        html,
      }, test))
      results.push({ family: family.parent_name, email: family.parent_email, success: !sendErr, error: sendErr?.message || null })
    }

    // Record real sends (read-merge-write, so two directors can't erase each other's log).
    let log = null
    if (!test) {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      const { data } = await admin.from('portal_settings').select('value').eq('key', REVIEW_LOG_KEY).maybeSingle()
      try { log = JSON.parse(data?.value || '{}') || {} } catch { log = {} }
      const now = new Date().toISOString()
      for (const r of results) {
        if (!r.success || !r.email) continue
        const k = r.email.toLowerCase()
        log[k] = { ...(log[k] || {}), ...(reminder ? { reminded: now } : { asked: now }) }
      }
      await admin.from('portal_settings')
        .upsert({ key: REVIEW_LOG_KEY, value: JSON.stringify(log), updated_at: now })
    }

    const successCount = results.filter(r => r.success).length
    return Response.json({ results, successCount, total: results.length, log })
  } catch (err) {
    console.error('[send-review-emails]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

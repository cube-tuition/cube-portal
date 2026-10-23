import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { PORTAL_BCC } from './emailConfig'
import { CAMPAIGN_LABELS } from './emailLogLabels'

/*
 * The sent-email log and the one-per-campaign office copy. Server only.
 *
 * A bulk route (course offers, holiday courses, discount program, review
 * requests, term start) sends each family its own email with NO office BCC,
 * records every send here (sent_emails, one row per family), and then sends
 * the office one summary: who it went to, what failed, and the email as the
 * first family saw it. A one-to-one email elsewhere still BCCs the office.
 *
 *   const campaign = startCampaign('course_offer', { subject, sentBy: auth.user.id, isTest: test })
 *   …for each family: campaign.record({ to_email, to_name, status: 'sent' | 'failed', error, resend_id, meta })
 *   await campaign.finish({ resend, fromEmail, sampleHtml })
 */
export function startCampaign(campaign, { subject, sentBy = null, isTest = false } = {}) {
  const id = randomUUID()
  const rows = []
  return {
    id,
    record(r) { rows.push({ ...r }) },
    get rows() { return rows },
    async finish({ resend, fromEmail, sampleHtml = '', label = null } = {}) {
      const sent = rows.filter(r => r.status === 'sent')
      const failed = rows.filter(r => r.status !== 'sent')
      // 1. The log. Service role: the table is read-only to signed-in users.
      try {
        const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
        if (rows.length) {
          const { error } = await admin.from('sent_emails').insert(rows.map(r => ({
            campaign_id: id, campaign, subject: r.subject || subject || '', to_email: r.to_email || null, to_name: r.to_name || null,
            status: r.status === 'sent' ? 'sent' : 'failed', error: r.error || null, resend_id: r.resend_id || null,
            is_test: !!isTest, sent_by: sentBy, meta: r.meta || {},
          })))
          if (error) console.error('[emailLog] could not record sends:', error.message)
        }
      } catch (e) { console.error('[emailLog]', e.message) }
      // 2. One office copy per campaign. A test send already delivered the
      // exact email to staff, so it needs no summary.
      if (isTest || !resend || !sent.length) return { sent: sent.length, failed: failed.length }
      try {
        const name = label || CAMPAIGN_LABELS[campaign] || campaign
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
        const row = (r, ok) => `<tr><td style="padding:3px 10px 3px 0;color:${ok ? '#166534' : '#991B1B'}">${ok ? '✓' : '✗'}</td><td style="padding:3px 10px 3px 0">${esc(r.to_name || '')}</td><td style="padding:3px 10px 3px 0;color:#555">${esc(r.to_email || '')}</td><td style="padding:3px 0;color:#991B1B">${esc(r.error || '')}</td></tr>`
        const when = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' })
        const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#2A2035;font-size:13px;line-height:1.5">
  <div style="background:#F0F4FF;border:1px solid #DEE7FF;border-radius:10px;padding:14px 18px;margin-bottom:18px">
    <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#062E63">${esc(name)} · sent to ${sent.length} ${sent.length === 1 ? 'family' : 'families'}${failed.length ? ` · ${failed.length} failed` : ''}</p>
    <p style="margin:0 0 10px;color:#555">${esc(when)} · subject: <b>${esc(subject || '')}</b></p>
    <table style="border-collapse:collapse;font-size:12px">${sent.map(r => row(r, true)).join('')}${failed.map(r => row(r, false)).join('')}</table>
    <p style="margin:10px 0 0;color:#777;font-size:11px">Every send is on record at /tutor/emails/sent. The email as the first family received it follows.</p>
  </div>
  ${sampleHtml || ''}
</div>`
        await resend.emails.send({
          from: `CUBE Tuition <${fromEmail}>`,
          to: [PORTAL_BCC],
          subject: `[Sent to ${sent.length}] ${subject || name}`,
          html,
        })
      } catch (e) { console.error('[emailLog] summary email failed:', e.message) }
      return { sent: sent.length, failed: failed.length }
    },
  }
}

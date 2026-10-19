import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { loadReminderItems, dueReminders, reminderEmail } from '../../../../lib/autoReminders'
import { PORTAL_BCC } from '../../../../lib/emailConfig'
import { recordJob } from '../../../../lib/systemHealth'

/*
 * GET /api/reminders/upcoming — emails families 24 hours before a booked level
 * test and before each trial lesson (lib/autoReminders).
 *
 * Called every 15 minutes by the database's pg_cron job "upcoming-reminders"
 * (migrations/20261019_auto_reminders.sql). Like the chat delivery route it
 * needs no secret: it only ever sends what is due, and each reminder is
 * claimed in auto_reminders (unique key) before it is sent, so an extra call
 * can never send anything twice. A failed send releases its claim and is
 * retried on the next run.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const startedAt = new Date().toISOString()
  const errors = []
  let sent = 0
  try {
    const items = await loadReminderItems(admin)
    const { data: done, error } = await admin.from('auto_reminders').select('key').in('key', items.map(i => i.key))
    if (error) throw error
    const due = dueReminders(items, { sentKeys: new Set((done || []).map(r => r.key)) })
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
    const from = `CUBE Tuition <${process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'}>`
    for (const it of due) {
      if (!resend) { errors.push('RESEND_API_KEY is not set'); break }
      // Claim it: a second caller's insert conflicts and skips.
      const { error: claimErr } = await admin.from('auto_reminders').insert({
        key: it.key, kind: it.kind, submission_id: it.submissionId, to_email: it.email, starts_at: it.startsAt.toISOString(),
      })
      if (claimErr) continue
      const { subject, html } = reminderEmail(it)
      const { error: sendErr } = await resend.emails.send({ from, to: [it.email], bcc: [PORTAL_BCC], subject, html })
        .then(r => r, e => ({ error: e }))
      if (sendErr) {
        errors.push(`${it.key}: ${sendErr.message || sendErr}`)
        await admin.from('auto_reminders').delete().eq('key', it.key)   // retry next run
        continue
      }
      sent++
      // The trial card's "Reminded" badge: first send only.
      if (it.kind === 'trial' && it.submissionId) {
        await admin.from('trial_submissions').update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', it.submissionId).is('reminder_sent_at', null)
      }
    }
  } catch (e) {
    errors.push(e?.message || String(e))
  }
  await recordJob(admin, 'upcoming_reminders', { startedAt, ok: !errors.length, detail: { sent }, error: errors.join(' · ') || null })
  return Response.json({ sent, errors }, { status: errors.length ? 500 : 200 })
}

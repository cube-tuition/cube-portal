import { Resend } from 'resend'
import { requireApiRole } from '../../../../lib/apiAuth'
import { PORTAL_BCC, applyEmailTestMode } from '../../../../lib/emailConfig'
import { serviceClient, uploadLink } from '../../../../lib/onboardingServer'
import { ONBOARDING_BUCKET, TEMPLATES, buildOnboardingEmailHtml, onboardingSubject } from '../../../../lib/onboarding'

/*
 * POST /api/onboarding/send — directors only
 * Body: { onboardingId, note?, payRatesPdf? (base64), test? }
 *
 * Emails the tutor their pack: the three CUBE documents from the bucket's
 * templates/, the Pay Rates PDF the page built from their rates, and their
 * private upload link. A test send goes to staff only (applyEmailTestMode)
 * and changes nothing on the pack.
 */
export async function POST(request) {
  const auth = await requireApiRole(request, ['admin', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  try {
    const { onboardingId, note, payRatesPdf, test } = await request.json()
    const sb = serviceClient()
    const { data: o } = await sb.from('tutor_onboarding').select('*').eq('id', onboardingId).maybeSingle()
    if (!o) return Response.json({ error: 'Onboarding pack not found.' }, { status: 404 })

    const attachments = []
    for (const t of TEMPLATES) {
      const { data: blob, error } = await sb.storage.from(ONBOARDING_BUCKET).download(t.path)
      if (error || !blob) return Response.json({ error: `Couldn’t load “${t.label}” from storage.` }, { status: 500 })
      attachments.push({ filename: t.filename, content: Buffer.from(await blob.arrayBuffer()).toString('base64') })
    }
    if (payRatesPdf) attachments.push({ filename: 'CUBE Pay Rates.pdf', content: payRatesPdf })

    const pack = { ...o, note: typeof note === 'string' ? note.trim() : o.note }
    const html = buildOnboardingEmailHtml(pack, uploadLink(o.token), attachments.map(a => a.filename.replace(/\.pdf$/, '')))
    const resend = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const { error } = await resend.emails.send(applyEmailTestMode({
      from: `CUBE Tuition <${fromEmail}>`,
      to: [o.email],
      bcc: [PORTAL_BCC],
      subject: onboardingSubject(),
      html,
      attachments,
    }, test))
    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (!test) {
      const { data: me } = await sb.from('directors').select('full_name').eq('id', auth.user.id).maybeSingle()
      await sb.from('tutor_onboarding').update({
        note: pack.note || null,
        status: o.status === 'draft' ? 'sent' : o.status,
        sent_at: new Date().toISOString(),
        sent_count: (o.sent_count || 0) + 1,
        sent_by_name: me?.full_name || auth.user.email || null,
        updated_at: new Date().toISOString(),
      }).eq('id', o.id)
    }
    return Response.json({ success: true, sentTo: test ? 'staff (test)' : o.email })
  } catch (e) {
    console.error('[onboarding/send]', e)
    return Response.json({ error: e.message || 'Send failed.' }, { status: 500 })
  }
}

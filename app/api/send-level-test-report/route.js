import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'
import { PORTAL_BCC, applyEmailTestMode } from '../../../lib/emailConfig'
import { trialOfferHtml, trialOfferText } from '../../../lib/trialInvite'
import { autoTrialSections, createTrialInvite, trialPreviewLink, sydneyToday } from '../../../lib/trialInviteServer'
import { levelTestEmailBody, levelTestEmailSubject, levelTestEmailText, levelTestEmailHtml } from '../../../lib/levelTestEmail'

/*
 * Email level-test feedback report(s) to a parent/guardian.
 * Mirrors /api/send-invoice: the client builds each PDF and posts it as base64.
 *
 * One child:  { pdf_base64, pdf_filename, lesson_id }
 * A family:   { attachments: [{ pdf_base64, pdf_filename }], lesson_ids: [...] }
 *             — brothers and sisters who sat tests together get ONE email
 *               with every child's report, rather than one email each.
 *
 * Every lesson whose report went out is stamped (time, address, and the ids
 * sent together) once Resend accepts the email, so each child's marking page
 * can say it has already gone — and with whom. Test sends are not stamped.
 *
 * When the tests came from the trial pipeline (level_test_invites), the same
 * email carries the trial invitation: the family's open requests with no class
 * get classes matched on year, subject and availability, and a link to the
 * class picker (lib/trialInvite). A real send marks those requests invited.
 */
// The family's requests still waiting for a trial class.
async function trialOffer(db, lessonIds) {
  const { data: lts } = await db.from('level_test_invites').select('submission_id').in('lesson_id', lessonIds)
  const linked = [...new Set((lts || []).map(r => r.submission_id).filter(Boolean))]
  if (!linked.length) return null
  const { data: mine } = await db.from('trial_submissions').select('parent_email').in('id', linked)
  const emails = [...new Set((mine || []).map(r => (r.parent_email || '').trim().toLowerCase()).filter(Boolean))]
  let q = db.from('trial_submissions').select('*').in('status', ['new', 'contacted']).is('trial_class_id', null)
  q = emails.length ? q.or([`id.in.(${linked.join(',')})`, ...emails.map(e => `parent_email.ilike.${e}`)].join(',')) : q.in('id', linked)
  const { data: subs } = await q
  if (!subs?.length) return null
  const sections = await autoTrialSections(db, subs, sydneyToday())
  return sections.length ? { subs: subs.filter(s => sections.some(x => x.submission_id === s.id)), sections } : null
}

// A report PDF is ~300–350 KB (≈450 KB as base64); six stays well inside
// Vercel's 4.5 MB request limit.
const MAX_ATTACHMENTS = 6

export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director', 'tutor'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const {
      email_to, student_name, test_title, comment, teacher_name, email_subject, email_body,
      pdf_base64, pdf_filename, attachments, lesson_id, lesson_ids, test,
    } = await req.json()

    const files = Array.isArray(attachments) && attachments.length
      ? attachments
      : (pdf_base64 ? [{ pdf_base64, pdf_filename }] : [])
    if (!email_to || !files.length || files.some(f => !f?.pdf_base64)) {
      return NextResponse.json({ error: 'Missing email_to or report PDF' }, { status: 400 })
    }
    if (files.length > MAX_ATTACHMENTS) {
      return NextResponse.json({ error: `At most ${MAX_ATTACHMENTS} reports per email` }, { status: 400 })
    }
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
    }

    // The page sends the rendered body it previewed (the stored template with
    // everything filled in) — what was previewed is exactly what goes out.
    // Fall back to the default template for callers that predate the editor.
    const subject = email_subject || levelTestEmailSubject({ studentName: student_name, testTitle: test_title })
    const body = email_body || levelTestEmailBody({ studentName: student_name, testTitle: test_title, comment, teacherName: teacher_name })

    const lessonIds = [...new Set((Array.isArray(lesson_ids) && lesson_ids.length ? lesson_ids : [lesson_id])
      .map(Number).filter(Number.isInteger))]
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // The trial invitation rides along (best effort — the report still goes
    // if matching classes fails).
    let offer = null, offerLink = ''
    if (lessonIds.length) {
      try {
        offer = await trialOffer(db, lessonIds)
        if (offer) {
          const s0 = offer.subs[0]
          offerLink = test ? trialPreviewLink(offer.sections) : (await createTrialInvite(db, {
            submissionIds: offer.subs.map(s => s.id), parentEmail: s0.parent_email || email_to, parentName: s0.parent_name,
            studentName: s0.student_name || student_name, sections: offer.sections, source: 'level_test',
          }))?.link || ''
        }
      } catch (e) {
        console.error('[send-level-test-report] trial offer skipped:', e.message)
        offer = null
      }
    }
    const offerName = offer?.subs[0]?.student_name || student_name

    const emailPayload = applyEmailTestMode({
      from: 'CUBE Tuition <admin@cubetuition.com.au>',
      to: [email_to],
      bcc: [PORTAL_BCC],
      subject,
      text: levelTestEmailText(body) + trialOfferText({ link: offerLink, studentName: offerName }),
      // keep-all: Korean comments wrap between words, not mid-word.
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;max-width:600px;word-break:keep-all">${
        levelTestEmailHtml(body)
      }${trialOfferHtml({ link: offerLink, sections: offer?.sections || [], studentName: offerName })}</div>`,
      attachments: files.map((f, i) => ({
        filename: f.pdf_filename || `level-test-report-${i + 1}.pdf`,
        content: f.pdf_base64,
        type: 'application/pdf',
        disposition: 'attachment',
      })),
    }, test)

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload),
    })
    if (!resendRes.ok) {
      const err = await resendRes.text()
      console.error('[send-level-test-report] Resend error:', err)
      return NextResponse.json({ error: 'Email send failed', detail: err }, { status: 500 })
    }

    // Stamp every lesson in this send. The email has already gone, so a failed
    // stamp is reported back rather than failing the request.
    const ids = lessonIds
    let stamped = false
    if (ids.length && !test) {
      const { error: e } = await db.from('lessons')
        .update({ report_emailed_at: new Date().toISOString(), report_emailed_to: email_to, report_emailed_with: ids })
        .in('id', ids).eq('lesson_type', 'level_test')
      if (e) console.error('[send-level-test-report] stamp failed:', e.message)
      stamped = !e
    }
    // The trial invitation went too: the same stamps as sending it from the
    // pipeline (first contact, first invitation — never moved by a resend).
    if (offerLink && !test) {
      const now = new Date().toISOString()
      const subIds = offer.subs.map(s => s.id)
      await db.from('trial_submissions').update({ status: 'contacted', contacted_at: now }).in('id', subIds).eq('status', 'new')
      await db.from('trial_submissions').update({ contacted_at: now }).in('id', subIds).is('contacted_at', null)
      await db.from('trial_submissions').update({ invitation_sent_at: now }).in('id', subIds).is('invitation_sent_at', null)
    }
    return NextResponse.json({ success: true, stamped, trialInvite: !!offerLink })
  } catch (err) {
    console.error('[send-level-test-report] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

import { requireApiRole } from '../../../lib/apiAuth'
import {
  adminClient, mintResetLink, sendLoginDetailsEmail, isPlaceholderEmail, siteUrl,
} from '../../../lib/passwordReset'

/*
 * Send a student their portal login — POST /api/send-login  { student_id, deliver? }
 *
 * What goes in the email is the USERNAME and a single-use link for choosing a
 * password. Not a password: Supabase keeps only a hash, so an existing one
 * cannot be looked up and sent by anyone, and mailing one would leave it
 * sitting in an inbox for as long as the message survives. The student sets
 * their own and nobody at CUBE ever sees it — the same principle the reset
 * flow already works on.
 *
 * The username is whatever auth holds, which is not always students.email —
 * the two drift, and sending the wrong one gives them a login that signs
 * nobody in.
 *
 * Delivery, same shape as /api/password-reset:
 *   POST { student_id }              → who this could go to; sends nothing
 *   POST { student_id, deliver }     → 'account' | 'guardian', then sends
 *
 * Most CUBE logins are @cubetuition.com addresses with no mailbox, so for most
 * students the parent is the only reachable address. That is offered, never
 * chosen silently: it is the student's account the parent would be opening.
 *
 * Every send is recorded in login_deliveries — who it went to and when, never
 * the link — so the monitoring page can answer "have they been given this yet?"
 */
export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { student_id, deliver } = await req.json()
    if (!student_id) return Response.json({ error: 'Missing student_id' }, { status: 400 })
    if (deliver && !['account', 'guardian'].includes(deliver)) {
      return Response.json({ error: 'Unknown delivery mode.' }, { status: 400 })
    }

    const sb = adminClient()
    const { data: student } = await sb
      .from('students').select('id, full_name').eq('id', student_id).maybeSingle()
    if (!student) return Response.json({ error: 'Student not found.' }, { status: 404 })

    // getUserById reports a missing account as an ERROR rather than {user:null},
    // so "no login yet" arrives looking like a failure. Say what it means.
    const { data: found, error: uErr } = await sb.auth.admin.getUserById(student_id)
    if (!found?.user || /not.?found/i.test(uErr?.message || '')) {
      return Response.json({
        error: `${student.full_name} has no portal login yet — create one first, then you can send it.`,
      }, { status: 409 })
    }
    if (uErr) return Response.json({ error: uErr.message }, { status: 400 })

    const username = found.user.email || null
    const deliverable = !!username && !isPlaceholderEmail(username)

    const { data: guardians } = await sb
      .from('guardians').select('full_name, email, relationship').eq('student_id', student_id)
    const guardian = (guardians || [])
      .find((g) => String(g.email || '').trim() && !isPlaceholderEmail(g.email)) || null

    const options = {
      full_name: student.full_name,
      username,
      portal: siteUrl(),
      account: { email: username, deliverable },
      guardian: guardian
        ? { email: guardian.email.trim(), name: guardian.full_name, relationship: guardian.relationship }
        : null,
      last_sign_in_at: found.user.last_sign_in_at || null,
    }
    if (!deliver) return Response.json({ options })

    if (deliver === 'account' && !deliverable) {
      return Response.json({
        error: `${username || 'That login'} cannot receive email — it has no mailbox. Send it to a parent instead.`,
      }, { status: 400 })
    }
    if (deliver === 'guardian' && !guardian) {
      return Response.json({ error: `No parent email on file for ${student.full_name}.` }, { status: 400 })
    }

    // The token has to be minted against the address the ACCOUNT uses, whoever
    // the email is eventually addressed to.
    const link = await mintResetLink(username)
    if (!link) return Response.json({ error: 'Could not create a set-password link for that account.' }, { status: 400 })

    const to = deliver === 'guardian' ? guardian.email.trim() : username
    const sent = await sendLoginDetailsEmail({
      to, link, username,
      name: deliver === 'guardian' ? guardian.full_name : student.full_name,
      guardianOf: deliver === 'guardian' ? student.full_name : null,
    })
    if (!sent.ok) return Response.json({ error: sent.error, link }, { status: 502 })

    await sb.from('login_deliveries').insert({
      person_id: student_id, kind: 'student', channel: deliver, sent_to: to,
      sent_by: auth.user?.id || null,
      sent_by_name: auth.user?.user_metadata?.full_name || auth.user?.email || null,
      purpose: 'login_details',
    })

    return Response.json({ success: true, sentTo: to, username, options })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

/*
 * GET /api/send-login — the roster view behind the monitoring section.
 *
 * For every active student: whether they have a login, what the username is,
 * whether that address can actually receive mail, whether a parent address is
 * on file, when the login was last sent to them (and to whom), and whether
 * they have ever signed in. "Received" is the honest word for a delivery, not
 * proof of reading — a first sign-in is the closest thing to that, so both are
 * reported and the page can show either.
 */
export async function GET(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const sb = adminClient()
    const [{ data: students }, { data: guardians }, { data: deliveries }] = await Promise.all([
      sb.from('students').select('id, full_name, year, email').eq('status', 'active').order('full_name'),
      sb.from('guardians').select('student_id, email'),
      sb.from('login_deliveries').select('person_id, channel, sent_to, purpose, created_at, sent_by_name')
        .eq('kind', 'student').order('created_at', { ascending: false }),
    ])

    // listUsers is paginated; walk it so a growing roll never silently truncates.
    const logins = {}
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) return Response.json({ error: error.message }, { status: 400 })
      const users = data?.users || []
      for (const u of users) logins[u.id] = u
      if (users.length < 1000) break
    }

    const guardianOf = {}
    for (const g of guardians || []) {
      const e = String(g.email || '').trim()
      if (e && !isPlaceholderEmail(e) && !guardianOf[g.student_id]) guardianOf[g.student_id] = e
    }
    const lastSend = {}
    for (const d of deliveries || []) if (!lastSend[d.person_id]) lastSend[d.person_id] = d

    const rows = (students || []).map((s) => {
      const u = logins[s.id]
      const username = u?.email || null
      const sent = lastSend[s.id] || null
      return {
        id: s.id, name: s.full_name, year: s.year,
        hasLogin: !!u,
        username,
        deliverable: !!username && !isPlaceholderEmail(username),
        guardianEmail: guardianOf[s.id] || null,
        lastSignInAt: u?.last_sign_in_at || null,
        sentAt: sent?.created_at || null,
        sentTo: sent?.sent_to || null,
        sentChannel: sent?.channel || null,
        sentBy: sent?.sent_by_name || null,
      }
    })
    return Response.json({ rows, portal: siteUrl() })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

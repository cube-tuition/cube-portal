import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * Creating a student's portal login — POST /api/student-login  { student_id }
 *
 * A student row and its auth account are joined only by convention:
 * students.id must equal auth.users.id. Nothing in the database enforces it —
 * there is no foreign key and no trigger — so an account created by hand with
 * a fresh id leaves the student silently unable to sign in, while every table
 * that keys on students.id (enrolments, attendance, workbook answers) keeps
 * pointing at a row nobody can log in as.
 *
 * This route is the one supported way to close that gap: it creates the auth
 * user with the student's OWN id, so the pairing cannot drift.
 *
 * The login address is the student's email when they have a real one, and a
 * generated @cubetuition.com placeholder otherwise, matching the accounts that
 * already exist. A placeholder cannot receive mail, so such an account can only
 * ever be recovered by staff — which is worth knowing before handing one out.
 *
 * The initial password is returned ONCE, in this response. It is never stored,
 * so if it is not passed on it can only be replaced, not retrieved.
 */

// No look-alike characters (0/O, 1/l/I) — these get read aloud and copied by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function generatePassword(len = 14) {
  const bytes = randomBytes(len * 2)
  let out = ''
  for (let i = 0; out.length < len && i < bytes.length; i++) {
    // Reject above the largest whole multiple of the alphabet so every
    // character stays equally likely (modulo alone would favour the first few).
    const max = 256 - (256 % ALPHABET.length)
    if (bytes[i] >= max) continue
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

const isPlaceholder = (e) => /@cubetuition\.com$/i.test(String(e || '').trim())

/** first.last → firstlast, stripped of anything not a letter or digit. */
function placeholderFor(fullName, taken) {
  const base = String(fullName || 'student').toLowerCase().replace(/[^a-z0-9]/g, '') || 'student'
  let candidate = `${base}@cubetuition.com`
  let n = 2
  while (taken.has(candidate.toLowerCase())) candidate = `${base}${n++}@cubetuition.com`
  return candidate
}

/*
 * GET /api/student-login  →  { logins: { <student_id>: {email, placeholder, last_sign_in_at} } }
 *
 * auth.users is not reachable from the browser (the auth schema is not exposed
 * through PostgREST), so the student grid asks the server who actually has a
 * login. Any student id missing from the map has no account.
 */
export async function GET(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // listUsers is paginated; walk it so a growing roll never silently truncates.
    const logins = {}
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) return Response.json({ error: error.message }, { status: 400 })
      const users = data?.users || []
      for (const u of users) {
        logins[u.id] = {
          email: u.email || null,
          placeholder: isPlaceholder(u.email),
          last_sign_in_at: u.last_sign_in_at || null,
        }
      }
      if (users.length < 1000) break
    }
    return Response.json({ logins })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const { student_id } = await req.json()
    if (!student_id) return Response.json({ error: 'Missing student_id' }, { status: 400 })

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const { data: student, error: sErr } = await sb
      .from('students').select('id, full_name, email').eq('id', student_id).maybeSingle()
    if (sErr)     return Response.json({ error: sErr.message }, { status: 400 })
    if (!student) return Response.json({ error: 'No such student.' }, { status: 404 })

    // Already has a login? Say so rather than trying again — createUser would
    // fail on the duplicate id anyway, with a much less useful message.
    const { data: existing } = await sb.auth.admin.getUserById(student_id)
    if (existing?.user) {
      return Response.json({
        error: `${student.full_name} already has a login (${existing.user.email}).`,
      }, { status: 409 })
    }

    // Their own address if it is a real one; otherwise a placeholder that does
    // not collide with an account already using it.
    const own = String(student.email || '').trim().toLowerCase()
    let email = own && !isPlaceholder(own) ? own : null
    let usedPlaceholder = false

    if (!email) {
      const { data: allStudents } = await sb.from('students').select('email')
      const taken = new Set((allStudents || [])
        .map(s => String(s.email || '').trim().toLowerCase()).filter(Boolean))
      email = placeholderFor(student.full_name, taken)
      usedPlaceholder = true
    }

    const password = generatePassword()

    const { data: created, error: cErr } = await sb.auth.admin.createUser({
      id: student.id,                 // the whole point: the ids must match
      email,
      password,
      email_confirm: true,            // no verification mail; placeholders could never receive one
      app_metadata: { role: 'student' },
    })
    if (cErr) {
      // Two students sharing one address is the common case here — siblings on a
      // parent's email. Say which address, so it is obvious what to fix.
      if (/already been registered|already exists|duplicate/i.test(cErr.message || '')) {
        return Response.json({
          error: `${email} is already the login for another account. Give ${student.full_name} their own address first.`,
        }, { status: 409 })
      }
      return Response.json({ error: cErr.message }, { status: 400 })
    }

    // Guard against a future API change silently assigning a different id —
    // that would produce an account the student can sign into but which owns
    // none of their data.
    if (created?.user?.id !== student.id) {
      if (created?.user?.id) await sb.auth.admin.deleteUser(created.user.id)
      return Response.json({
        error: 'The account was created with the wrong id and has been removed. Nothing was changed.',
      }, { status: 500 })
    }

    // Keep students.email in step, so the record and the login agree.
    if (usedPlaceholder && own !== email) {
      await sb.from('students').update({ email }).eq('id', student.id)
    }

    return Response.json({
      success: true,
      email,
      password,                       // shown once, never stored
      usedPlaceholder,
      full_name: student.full_name,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

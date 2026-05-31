import { supabase } from './supabase'
import { T_ADMINS, T_TUTORS, T_STUDENTS } from './tables'

/**
 * Returns { user, profile, role } for the currently signed-in user.
 *
 * - role   comes from auth app_metadata (server-set, not a DB column)
 * - profile is fetched from the correct table based on role:
 *     admin / director → directors
 *     tutor            → tutors
 *     *                → students
 *
 * Falls back to email-based lookup if the UUID doesn't match any row
 * (handles accounts created before UUID alignment was enforced).
 *
 * profile has `role` merged in so existing code using `profile.role` keeps working.
 */
export async function getAuthProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, profile: null, role: null }

  const role  = user.app_metadata?.role ?? 'student'
  const table = (role === 'admin' || role === 'director') ? T_ADMINS
              : role === 'tutor' ? T_TUTORS
              : T_STUDENTS

  // Primary lookup — match on auth UUID
  let { data: profile } = await supabase.from(table).select('*').eq('id', user.id).maybeSingle()

  // Fallback — match on email (handles any lingering UUID mismatches)
  if (!profile && user.email) {
    const { data: byEmail } = await supabase.from(table).select('*').eq('email', user.email).maybeSingle()
    profile = byEmail ?? null
  }

  return {
    user,
    profile: profile ? { ...profile, role } : null,
    role,
  }
}

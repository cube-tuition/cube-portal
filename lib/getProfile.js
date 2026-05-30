import { supabase } from './supabase'
import { T_ADMINS, T_TUTORS, T_STUDENTS } from './tables'

/**
 * Returns { user, profile, role } for the currently signed-in user.
 *
 * - role   comes from auth app_metadata (server-set, not a DB column)
 * - profile is fetched from the correct table based on role:
 *     admin  → admins
 *     tutor  → tutors
 *     *      → students
 *
 * profile has `role` merged in so existing code using `profile.role` keeps working.
 */
export async function getAuthProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, profile: null, role: null }

  const role  = user.app_metadata?.role ?? 'student'
  const table = role === 'admin' ? T_ADMINS : role === 'tutor' ? T_TUTORS : T_STUDENTS

  const { data: profile } = await supabase.from(table).select('*').eq('id', user.id).single()

  return {
    user,
    profile: profile ? { ...profile, role } : null,
    role,
  }
}

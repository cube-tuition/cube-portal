/**
 * requireStudent(user, router)
 * ─────────────────────────────────────────────────────────────────────────────
 * Call this at the top of every student-only page load.
 * Returns true  → user is a student, safe to continue loading.
 * Returns false → already redirecting (tutor/admin → /tutor, unauthed → /).
 *
 * Usage:
 *   const { data: { user } } = await supabase.auth.getUser()
 *   if (!requireStudent(user, router)) return
 */
export function requireStudent(user, router) {
  if (!user) {
    router.replace('/')
    return false
  }
  const role = user.app_metadata?.role ?? 'student'
  if (role === 'tutor' || role === 'admin' || role === 'director') {
    router.replace('/tutor')
    return false
  }
  return true
}

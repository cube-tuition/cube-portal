import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Persist the session in localStorage and auto-refresh the access token. These
// are the supabase-js defaults, but we set them explicitly (and give a named
// storageKey) so home-screen PWAs reliably restore the session on cold start.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'cube-portal-auth',
  },
})

// iOS home-screen web apps are terminated when backgrounded and cold-start on
// return; refresh the session the moment the app becomes visible again so the
// token is renewed before any page's auth guard runs.
if (typeof window !== 'undefined') {
  const refresh = () => { if (document.visibilityState === 'visible') supabase.auth.getSession() }
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('focus', refresh)
}

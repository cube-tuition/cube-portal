'use client'
import { supabase } from './supabase'

/*
 * fetch() wrapper that attaches the current user's Supabase access token as
 * `Authorization: Bearer <token>`, so privileged server API routes can verify
 * the caller (see lib/apiAuth.js).
 *
 * Usage is identical to fetch():
 *   const res = await authedFetch('/api/approve-invoice', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ invoice_id }),
 *   })
 *
 * If there's no active session the request is sent without the header and the
 * route will respond 401.
 */
export async function authedFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { ...(options.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  const res = await fetch(url, { ...options, headers })

  // A 401 with a token attached means the token the tab is holding is stale —
  // typically after the machine slept through the refresh window. One explicit
  // refresh-and-retry recovers that case silently. If the refresh itself fails
  // the session is truly gone (revoked server-side) and no retry can help;
  // the original 401 is returned and the route's error says to log in again.
  if (res.status === 401 && session?.access_token) {
    const { data, error } = await supabase.auth.refreshSession()
    const fresh = data?.session?.access_token
    if (!error && fresh) {
      return fetch(url, { ...options, headers: { ...headers, Authorization: `Bearer ${fresh}` } })
    }
  }
  return res
}

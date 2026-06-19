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
  return fetch(url, { ...options, headers })
}

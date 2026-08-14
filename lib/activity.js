import { supabase } from './supabase'

/*
 * Portal usage heartbeat.
 *
 * One RPC call records "this user was here today" (portal_activity: visits,
 * logins, last_seen — keyed on auth.uid() server-side, so nothing can be
 * recorded on someone else's behalf).
 *
 * The heartbeat is throttled per tab session: navigating around the portal is
 * one visit, not one write per page. A fresh password sign-in calls with
 * { login: true }, which bypasses the throttle and bumps the login counter.
 *
 * Tracking must never break the portal, so every failure path is swallowed.
 */

const STAMP_KEY = 'cube:activity-ping'
const EVERY_MS = 30 * 60 * 1000   // at most one visit ping per half hour per tab

export function recordPortalActivity({ login = false } = {}) {
  try {
    if (!login) {
      const last = Number(sessionStorage.getItem(STAMP_KEY) || 0)
      if (Date.now() - last < EVERY_MS) return
    }
    sessionStorage.setItem(STAMP_KEY, String(Date.now()))
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      await supabase.rpc('record_portal_activity', { p_login: login })
    })().catch(() => {})
  } catch { /* storage blocked, offline — never surface this */ }
}

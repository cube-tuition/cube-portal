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

/*
 * Per-page tracking — which pages a person actually opens.
 *
 * Called on every route change, so unlike the visit heartbeat this is NOT
 * throttled by time across the session: opening the same page again an hour
 * later is a real second view and should count. What it does suppress is the
 * same path firing twice in quick succession, which React re-renders and
 * back/forward navigation both cause.
 *
 * The server collapses ids in the path (/workbook/<uuid> -> /workbook/:id), so
 * what lands in the table is a route, not a URL, and no booklet or class id is
 * stored against a student's name.
 */
const PAGE_KEY = 'cube:page-ping'
const SAME_PAGE_MS = 20 * 1000

export function recordPageView(path) {
  try {
    if (!path) return
    let seen = {}
    try { seen = JSON.parse(sessionStorage.getItem(PAGE_KEY) || '{}') } catch { seen = {} }
    const now = Date.now()
    if (now - Number(seen[path] || 0) < SAME_PAGE_MS) return
    // Keep the map small on long sessions — it only exists to debounce.
    if (Object.keys(seen).length > 40) seen = {}
    seen[path] = now
    sessionStorage.setItem(PAGE_KEY, JSON.stringify(seen))
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      await supabase.rpc('record_page_view', { p_path: path })
    })().catch(() => {})
  } catch { /* tracking must never break navigation */ }
}

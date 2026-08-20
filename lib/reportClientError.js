import { supabase } from './supabase'

/*
 * Report a client-side crash to /api/client-error (→ the client_errors table,
 * shown on the monitoring page). Called by the error boundaries in app/.
 *
 * Rules of engagement: this runs while the page is already broken, so it must
 * never throw, never block rendering the fallback UI, and never loop — the
 * same error is reported once per browser session, not once per render of the
 * boundary.
 */
export function reportClientError(error, { global: isGlobal = false } = {}) {
  try {
    const message = String(error?.message || error || 'Unknown error')
    const key = `cube:err:${message.slice(0, 120)}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch { /* storage blocked — report anyway */ }

    // The session token is a nice-to-have (ties the row to a student); the
    // report must go out even when auth itself is what broke.
    const send = (token) => {
      try {
        fetch('/api/client-error', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            route: window.location.pathname + window.location.search,
            message,
            stack: String(error?.stack || '').split('\n').slice(0, 12).join('\n'),
            digest: error?.digest || null,
            global: isGlobal,
          }),
          keepalive: true,   // survives the user navigating away in disgust
        }).catch(() => {})
      } catch { /* never let reporting crash the crash page */ }
    }

    supabase.auth.getSession()
      .then(({ data }) => send(data?.session?.access_token || null))
      .catch(() => send(null))
  } catch { /* absolute last resort: drop the report */ }
}

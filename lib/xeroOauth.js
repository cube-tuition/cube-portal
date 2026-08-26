/*
 * Shared bits for the Xero OAuth handshake.
 *
 * Lives in lib/ rather than in one of the route files because Next.js route
 * modules are only meant to export request handlers (GET/POST/…) plus a few
 * known config keys — exporting an extra constant from a route and importing it
 * elsewhere can fail route-type validation at build time.
 */

// Name of the httpOnly cookie holding the per-attempt CSRF nonce that
// /api/xero/auth mints and /api/xero/callback verifies.
export const XERO_STATE_COOKIE = 'xero_oauth_state'

// Cookie attributes shared by the set (in auth) and the clear (in callback), so
// the two can't drift — a clear with a different path silently leaves the
// cookie in place.
export const XERO_STATE_COOKIE_PATH = '/api/xero'

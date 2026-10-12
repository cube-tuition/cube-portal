import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

/*
 * Server-only helpers for the onboarding routes: a service-role client (the
 * tables and the bucket are directors-only, and the tutor's upload page has no
 * login — it is let in by its token, checked here) and the token itself.
 */
export const serviceClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// 32 random bytes, base64url — the upload link is the credential.
export const newToken = () => randomBytes(32).toString('base64url')

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.cubetuition.com.au').replace(/\/+$/, '')
export const uploadLink = (token) => `${siteUrl()}/onboarding/${token}`

// Look up an onboarding pack by its link token. Tokens are long random strings;
// anything else is refused before touching the database.
export async function onboardingByToken(sb, token) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(token || ''))) return null
  const { data } = await sb.from('tutor_onboarding').select('*').eq('token', token).maybeSingle()
  return data || null
}

export const safeName = (s) => String(s || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'file'

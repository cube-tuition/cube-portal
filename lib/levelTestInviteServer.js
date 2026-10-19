import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

/*
 * Server-only helpers for the level test invitation routes. The invites table
 * is directors-only; the parent's form has no login and is let in by the
 * token in their email link, checked here.
 */
export const serviceClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// 32 random bytes, base64url — the form link is the credential.
export const newInviteToken = () => randomBytes(32).toString('base64url')

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.cubetuition.com.au').replace(/\/+$/, '')
export const inviteLink = (token) => `${siteUrl()}/level-test/${token}`

export const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())

export async function inviteByToken(sb, token) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(token || ''))) return null
  const { data } = await sb.from('level_test_invites').select('*').eq('token', token).maybeSingle()
  return data || null
}

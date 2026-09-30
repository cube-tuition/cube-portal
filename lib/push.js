import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import { sendApns, apnsConfigured } from './apns'

/*
 * Web push to the directors' phones (the standalone Messages app), server-side.
 * Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto:).
 * Fails soft: a webhook must never 500 because a phone was unreachable. A
 * subscription that the browser has dropped (404/410) is deleted.
 */
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

// The directors' phones running the native app: device tokens whose owner is
// an admin or director (tutors and students get no office alerts).
async function directorDeviceTokens(admin) {
  const { data: rows } = await admin.from('device_push_tokens').select('token, user_id, platform').eq('platform', 'ios')
  const out = []
  for (const r of rows || []) {
    const { data } = await admin.auth.admin.getUserById(r.user_id)
    const role = data?.user?.app_metadata?.role
    if (role === 'admin' || role === 'director') out.push(r.token)
  }
  return out
}

export async function sendPushToAll({ title, body, url = '/messages', tag }) {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  // Native iPhone app first — independent of whether web push is configured.
  let native = 0
  if (apnsConfigured()) {
    try {
      const tokens = await directorDeviceTokens(admin)
      const res = await sendApns(tokens, { title, body, url, tag })
      native = res.sent
      if (res.dead.length) await admin.from('device_push_tokens').delete().in('token', res.dead)
    } catch { /* fail soft */ }
  }
  if (!pushConfigured()) return { sent: native }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@cubetuition.com.au', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth')
  const payload = JSON.stringify({ title, body, url, tag })
  let sent = native
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
      sent += 1
      await admin.from('push_subscriptions').update({ last_used: new Date().toISOString() }).eq('id', s.id)
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', s.id)
    }
  }))
  return { sent }
}

// A push to particular staff members' phones — a direct message, or an
// @mention. Native app tokens per user, plus any web-push subscriptions they
// hold. Fails soft like sendPushToAll.
export async function sendPushToUsers(userIds, { title, body, url = '/tutor/chat', tag = 'chat' }) {
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return { sent: 0 }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  let sent = 0
  if (apnsConfigured()) {
    try {
      const { data: rows } = await admin.from('device_push_tokens').select('token').eq('platform', 'ios').in('user_id', ids)
      const res = await sendApns((rows || []).map(r => r.token), { title, body, url, tag })
      sent += res.sent
      if (res.dead.length) await admin.from('device_push_tokens').delete().in('token', res.dead)
    } catch { /* fail soft */ }
  }
  if (!pushConfigured()) return { sent }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@cubetuition.com.au', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ids)
  const payload = JSON.stringify({ title, body, url, tag })
  await Promise.all((subs || []).map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 }); sent += 1 }
    catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', s.id) }
  }))
  return { sent }
}

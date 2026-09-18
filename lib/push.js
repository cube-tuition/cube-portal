import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

/*
 * Web push to the directors' phones (the standalone Messages app), server-side.
 * Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto:).
 * Fails soft: a webhook must never 500 because a phone was unreachable. A
 * subscription that the browser has dropped (404/410) is deleted.
 */
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

export async function sendPushToAll({ title, body, url = '/messages', tag }) {
  if (!pushConfigured()) return { sent: 0 }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@cubetuition.com.au', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth')
  const payload = JSON.stringify({ title, body, url, tag })
  let sent = 0
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

'use client'
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/*
 * NativePushRegistrar — registers this device for push notifications when the
 * portal is running inside the CUBE Tuition mobile app (Capacitor wrapper).
 *
 * The app loads the live portal in a native webview and injects the Capacitor
 * bridge (window.Capacitor) with the PushNotifications plugin. On the plain
 * website there is no bridge, so this component is a no-op — safe to mount
 * globally in the root layout.
 *
 * Flow: wait for a signed-in session → ask notification permission → register
 * with APNs/FCM → save the device token to device_push_tokens (RLS: own rows).
 * Tokens are keyed by token string, so re-registering or switching accounts on
 * the same device simply re-points the token at the current user.
 */
export default function NativePushRegistrar() {
  const started = useRef(false)

  useEffect(() => {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null
    if (!cap?.isNativePlatform?.()) return
    const PN = cap.Plugins?.PushNotifications
    if (!PN) return

    const register = async (userId) => {
      if (started.current) return
      started.current = true
      try {
        let { receive } = await PN.checkPermissions()
        if (receive === 'prompt') ({ receive } = await PN.requestPermissions())
        if (receive !== 'granted') return
        await PN.addListener('registration', async ({ value }) => {
          await supabase.from('device_push_tokens').upsert(
            { token: value, user_id: userId, platform: cap.getPlatform() },
            { onConflict: 'token' },
          )
        })
        await PN.register()
      } catch {
        started.current = false // allow a retry on next auth change
      }
    }

    // Register for whoever is signed in now, and again on future sign-ins.
    supabase.auth.getUser().then(({ data }) => { if (data?.user) register(data.user.id) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) register(session.user.id)
    })
    return () => sub?.subscription?.unsubscribe?.()
  }, [])

  return null
}

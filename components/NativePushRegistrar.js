'use client'
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { rememberPushToken } from '../lib/nativeApp'

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
 * the same device simply re-points the token at the current user: every
 * sign-in re-saves the token for that account, and signing out deletes it
 * (see signOutEverywhere in lib/nativeApp.js).
 */
export default function NativePushRegistrar() {
  const started = useRef(false)
  const userRef = useRef(null)    // who is signed in right now
  const tokenRef = useRef(null)   // this device's token, once APNs hands it over

  useEffect(() => {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null
    if (!cap?.isNativePlatform?.()) return
    const PN = cap.Plugins?.PushNotifications
    if (!PN) return

    const save = async () => {
      if (!tokenRef.current || !userRef.current) return
      await supabase.from('device_push_tokens').upsert(
        { token: tokenRef.current, user_id: userRef.current, platform: cap.getPlatform() },
        { onConflict: 'token' },
      )
    }
    const register = async (userId) => {
      userRef.current = userId
      if (started.current) { save(); return }   // a later sign-in on this device: re-point the token
      started.current = true
      try {
        let { receive } = await PN.checkPermissions()
        if (receive === 'prompt') ({ receive } = await PN.requestPermissions())
        if (receive !== 'granted') return
        await PN.addListener('registration', async ({ value }) => {
          tokenRef.current = value
          rememberPushToken(value)
          await save()
        })
        // Tapping a notification opens the page it points at (a text thread,
        // the calls list) inside the app.
        await PN.addListener('pushNotificationActionPerformed', ({ notification }) => {
          const url = notification?.data?.url
          if (url && url.startsWith('/')) window.location.href = url
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

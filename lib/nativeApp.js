'use client'
import { useEffect, useState } from 'react'

/*
 * "Is this page running inside the CUBE Tuition iPhone app?"
 *
 * The app is a Capacitor shell that loads the live portal, and Capacitor
 * injects window.Capacitor before any page script runs. The root layout sets
 * <html data-app="ios"> from that as early as possible (see APP_FLAG_SCRIPT),
 * so app-only styling applies on first paint; components use these helpers.
 *
 * App-only layout without JavaScript: Tailwind's `app:` variant (globals.css)
 *   <div className="app:hidden">desktop-only</div>
 *   <nav className="hidden app:flex">app-only</nav>
 */

export function isNativeApp() {
  if (typeof window === 'undefined') return false
  try { return !!window.Capacitor?.isNativePlatform?.() } catch { return false }
}

/** React hook: false during server render, then the real answer. */
export function useIsNativeApp() {
  const [native, setNative] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setNative(isNativeApp()))
    return () => cancelAnimationFrame(id)
  }, [])
  return native
}

// Runs inline in <head>, before first paint.
export const APP_FLAG_SCRIPT =
  "try{if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){document.documentElement.dataset.app=(window.Capacitor.getPlatform&&window.Capacitor.getPlatform())||'native'}}catch(e){}"

/*
 * This device's push token, kept by NativePushRegistrar so that signing out
 * can release it. Without this a token stays pointed at whoever signed in
 * last on the phone, and that person's notifications land on the wrong phone.
 */
let pushToken = null
export const rememberPushToken = (t) => { pushToken = t }
export const currentPushToken = () => pushToken

/** Sign out, first dropping this device's push token (while still allowed to). */
export async function signOutEverywhere(supabase) {
  if (pushToken) {
    try { await supabase.from('device_push_tokens').delete().eq('token', pushToken) } catch { /* best effort */ }
  }
  await supabase.auth.signOut()
}

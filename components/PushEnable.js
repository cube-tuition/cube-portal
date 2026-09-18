'use client'
import { useEffect, useState } from 'react'
import { authedFetch } from '../lib/authedFetch'

/*
 * "Notify me" for the Messages app: registers the service worker, asks the
 * browser for notification permission, subscribes with the VAPID public key
 * and stores the subscription. Shows the current state as a small button.
 * On iPhone this only works once the app is on the home screen (Apple's rule),
 * so the button explains that instead of failing silently.
 */
const b64ToU8 = (b64) => { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))) }

export default function PushEnable({ className = '' }) {
  const [state, setState] = useState('checking')   // checking | unsupported | ios-install | off | on | busy | denied | error
  const [err, setErr] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    let dead = false
    ;(async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
      let next
      if (!supported) next = isIOS && !standalone ? 'ios-install' : 'unsupported'
      else if (Notification.permission === 'denied') next = 'denied'
      else {
        try { const reg = await navigator.serviceWorker.register('/messages-sw.js'); const sub = await reg.pushManager.getSubscription(); next = sub ? 'on' : 'off' }
        catch { next = 'unsupported' }
      }
      if (!dead) setState(next)
    })()
    return () => { dead = true }
  }, [])

  const enable = async () => {
    setState('busy'); setErr('')
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setState('denied'); return }
      const keyRes = await authedFetch('/api/push/subscribe')
      const { publicKey } = await keyRes.json()
      if (!publicKey) throw new Error('Notifications are not configured on the server yet.')
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) })
      const res = await authedFetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save the subscription')
      setState('on')
    } catch (e) { setErr(e.message); setState('error') }
  }
  const disable = async () => {
    setState('busy')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) { await authedFetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe() }
      setState('off')
    } catch (e) { setErr(e.message); setState('error') }
  }

  const btn = `text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition ${className}`
  if (state === 'checking') return null
  if (state === 'on') return <button onClick={disable} className={`${btn} bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]`} title="Tap to turn notifications off on this device">🔔 On</button>
  if (state === 'ios-install') return <span className={`${btn} bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]`} title="On iPhone, notifications work once the app is on the home screen">Add to Home Screen for alerts</span>
  if (state === 'unsupported') return null
  if (state === 'denied') return <span className={`${btn} bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]`} title="Notifications are blocked in the browser settings for this site">Alerts blocked</span>
  return (
    <button onClick={enable} disabled={state === 'busy'} className={`${btn} bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099] disabled:opacity-50`} title={err || 'Get a notification on this device when a family texts or calls'}>
      {state === 'busy' ? '…' : state === 'error' ? '🔔 Retry' : '🔔 Notify me'}
    </button>
  )
}

'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

/*
 * Where a password actually gets chosen.
 *
 * Reached two ways:
 *   1. From a reset link, which carries a single-use recovery token in the URL
 *      fragment (#token=…). The fragment is used because browsers never send it
 *      to a server, so the token stays out of access and proxy logs.
 *   2. By a signed-in user who just wants to change their password.
 *
 * The token is redeemed once, on mount, and swapped for a session — after which
 * setting the password is an ordinary authenticated call. React runs effects
 * twice in development, so redemption is guarded by a ref: a second call with
 * the same token would fail, the token being deliberately single-use, and the
 * page would tell a student with a perfectly good link that it had expired.
 */

const MIN_LENGTH = 8

export default function ResetPasswordPage() {
  const router = useRouter()
  const redeemed = useRef(false)

  // 'checking' → 'ready' (token redeemed) | 'signed-in' (no token, has session)
  //            → 'invalid' (no/!expired token) ; 'done' after the password is set
  const [stage, setStage]       = useState('checking')
  const [account, setAccount]   = useState(null)     // email of the account being changed
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [reveal, setReveal]     = useState(false)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    if (redeemed.current) return
    redeemed.current = true

    ;(async () => {
      const hash  = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '')
      const token = new URLSearchParams(hash).get('token')

      // Take the token out of the address bar straight away, so it isn't left
      // sitting in a shared browser's history or on screen over a shoulder.
      if (token && typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname)
      }

      if (!token) {
        // No token — but someone already signed in can still change their own.
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          setAccount(session.user.email || null)
          setStage('signed-in')
        } else {
          setStage('invalid')
        }
        return
      }

      const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'recovery' })
      if (error || !data?.user) {
        setStage('invalid')
        return
      }
      setAccount(data.user.email || null)
      setStage('ready')
    })()
  }, [])

  const submit = useCallback(async () => {
    setError('')
    if (password.length < MIN_LENGTH) {
      setError(`Please use at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords don\'t match.')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setError(error.message || 'That password couldn\'t be saved. Please try another.')
        return
      }
      setStage('done')
      // They already hold a session, so send them where they belong.
      const { data: { session } } = await supabase.auth.getSession()
      const role = session?.user?.app_metadata?.role ?? 'student'
      const dest = (role === 'tutor' || role === 'admin' || role === 'director') ? '/tutor' : '/dashboard'
      setTimeout(() => router.replace(dest), 1600)
    } catch (e) {
      setError(`Couldn't reach the server: ${e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }, [password, confirm, router])

  const field = 'w-full bg-[#F8FAFF] border border-[#DEE7FF] text-[#2A2035] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099] transition'

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#2A2035]">
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-2xl md:text-[1.65rem] font-bold tracking-tight text-[#062E63] font-display">CUBE</span>
            <span className="hidden sm:inline-block text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold pt-0.5">
              Tuition Portal
            </span>
          </Link>
        </div>
      </header>

      <section className="flex-1 bg-gradient-to-br from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF]">
        <div className="max-w-md mx-auto px-6 py-16 md:py-24">
          <div className="bg-white rounded-2xl border border-[#DEE7FF] shadow-[0_8px_30px_-12px_rgba(50,80,153,0.18)] p-7 md:p-8">

            {stage === 'checking' && (
              <p className="text-sm text-[#2A2035]/60 text-center py-6">Checking your link…</p>
            )}

            {stage === 'invalid' && (
              <>
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-2 font-display">
                  Password reset
                </p>
                <h2 className="text-xl font-semibold mb-4 font-display">This link can&apos;t be used</h2>
                <p className="text-sm text-[#2A2035]/70 leading-relaxed mb-2">
                  Reset links work <strong>once</strong>, and only for a short time. This one has
                  already been used, has expired, or was incomplete — a few email apps cut long
                  links in half.
                </p>
                <p className="text-sm text-[#2A2035]/70 leading-relaxed mb-6">
                  Nothing has changed on your account. Ask your CUBE tutor for a fresh link, or
                  request one from the login page.
                </p>
                <Link
                  href="/"
                  className="block w-full text-center bg-[#325099] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#062E63] transition"
                >
                  Back to login
                </Link>
              </>
            )}

            {(stage === 'ready' || stage === 'signed-in') && (
              <>
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-2 font-display">
                  {stage === 'ready' ? 'Password reset' : 'Change password'}
                </p>
                <h2 className="text-xl font-semibold mb-2 font-display">Choose a new password</h2>
                {account && (
                  <p className="text-xs text-[#2A2035]/55 mb-6 break-all">
                    For <span className="font-semibold text-[#2A2035]/75">{account}</span>
                  </p>
                )}

                <label className="block text-xs font-semibold text-[#2A2035]/70 mb-2">New password</label>
                <input
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  className={`${field} mb-3`}
                  placeholder={`At least ${MIN_LENGTH} characters`}
                />

                <label className="block text-xs font-semibold text-[#2A2035]/70 mb-2">Type it again</label>
                <input
                  type={reveal ? 'text' : 'password'}
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  className={field}
                  placeholder="Confirm your new password"
                />

                <label className="flex items-center gap-2 mt-3 mb-4 text-xs text-[#2A2035]/60 cursor-pointer select-none">
                  <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
                  Show what I&apos;m typing
                </label>

                {error && (
                  <div className="rounded-xl px-4 py-3 mb-4 text-sm bg-[#FDECEC] text-[#B23A3A]">{error}</div>
                )}

                <button
                  onClick={submit}
                  disabled={saving}
                  className="w-full bg-[#325099] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#062E63] disabled:opacity-60 transition"
                >
                  {saving ? 'Saving…' : 'Save new password'}
                </button>

                <p className="text-xs text-[#2A2035]/55 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-3 mt-5 leading-relaxed">
                  Pick something you don&apos;t use on any other website. CUBE staff can never see your
                  password — only reset it — so this stays between you and the portal.
                </p>
              </>
            )}

            {stage === 'done' && (
              <div className="text-center py-4">
                <div className="text-3xl mb-3">✅</div>
                <h2 className="text-xl font-semibold mb-2 font-display">Password saved</h2>
                <p className="text-sm text-[#2A2035]/70 leading-relaxed">
                  You&apos;re signed in. Taking you to your portal…
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">
            © CUBE Tuition · Chatswood
          </p>
        </div>
      </footer>
    </div>
  )
}

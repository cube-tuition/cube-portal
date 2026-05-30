'use client'
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async () => {
    setLoading(true)
    setError('')

    // Catch missing env vars early — most common "nothing happens" cause.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setError('Portal isn\'t configured yet (missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Add them to .env.local and restart the dev server.')
      setLoading(false)
      return
    }

    if (!email || !password) {
      setError('Please enter your email and password.')
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message || "That didn't work — check your email and password and try again.")
      } else if (!data?.user) {
        setError("Signed in but no user came back from Supabase — check that the account exists.")
      } else {
        // Route by role from app_metadata — no DB query needed
        const role = data.user.app_metadata?.role ?? 'student'
        const dest = (role === 'tutor' || role === 'admin' || role === 'director') ? '/tutor' : '/dashboard'
        router.replace(dest)
      }
    } catch (e) {
      // Network errors, malformed URL, etc. — surface them instead of silently failing.
      setError(`Couldn't reach Supabase: ${e?.message || e}`)
      console.error('Login error:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#2A2035]">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-2xl md:text-[1.65rem] font-bold tracking-tight text-[#062E63] font-display">
              CUBE
            </span>
            <span className="hidden sm:inline-block text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold pt-0.5">
              Tuition Portal
            </span>
          </Link>
          <a
            href="https://cubetuition.com.au"
            className="text-xs md:text-sm font-semibold text-[#062E63] hover:text-[#325099] transition"
          >
            ← Back to cubetuition.com.au
          </a>
        </div>
      </header>

      {/* Hero + form, side-by-side on md+ */}
      <section className="flex-1 bg-gradient-to-br from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF]">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-14 md:py-24 grid md:grid-cols-2 gap-12 items-center">
          {/* Left — welcome copy */}
          <div>
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-4 font-display">
              Hey, welcome back
            </p>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-5 font-display">
              Your week at CUBE,
              <br />
              all in one place.
            </h1>
            <p className="text-base text-[#2A2035]/70 leading-relaxed max-w-md mb-8">
              Check your timetable, see how your quizzes are tracking, grab
              your booklets, or sign in to a free drop-in help session.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Timetable', emoji: '📅' },
                { label: 'Quiz tracker', emoji: '📈' },
                { label: 'Booklets', emoji: '📚' },
                { label: 'Drop-in help', emoji: '🙋' },
              ].map((p) => (
                <span
                  key={p.label}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#062E63] bg-white/70 border border-[#DEE7FF] px-3 py-1.5 rounded-full"
                >
                  <span>{p.emoji}</span>
                  {p.label}
                </span>
              ))}
            </div>
          </div>

          {/* Right — login card */}
          <div className="w-full max-w-md md:ml-auto">
            <div className="bg-white rounded-2xl border border-[#DEE7FF] shadow-[0_8px_30px_-12px_rgba(50,80,153,0.18)] p-7 md:p-8">
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-2 font-display">
                Student Login
              </p>
              <h2 className="text-xl font-semibold text-[#2A2035] mb-6 font-display">
                Sign in to your portal
              </h2>

              <label className="block text-xs font-semibold text-[#2A2035]/70 mb-2">
                Email
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-[#F8FAFF] border border-[#DEE7FF] text-[#2A2035] rounded-xl px-4 py-3 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099] transition"
              />

              <label className="block text-xs font-semibold text-[#2A2035]/70 mb-2">
                Password
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-[#F8FAFF] border border-[#DEE7FF] text-[#2A2035] rounded-xl px-4 py-3 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099] transition"
              />

              {error && (
                <div className="rounded-xl px-4 py-3 mb-4 text-sm bg-[#FDECEC] text-[#B23A3A]">
                  {error}
                </div>
              )}

              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full bg-[#325099] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#062E63] disabled:opacity-60 transition"
              >
                {loading ? 'Signing you in…' : 'Log in'}
              </button>

              <p className="text-xs text-[#2A2035]/50 text-center mt-5">
                Trouble logging in? Just ask your CUBE tutor — they'll sort it.
              </p>
            </div>
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

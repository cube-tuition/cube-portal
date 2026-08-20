'use client'
import { useEffect } from 'react'
import { reportClientError } from '../lib/reportClientError'

/*
 * Route error boundary — catches a crash anywhere below the root layout and
 * shows a way forward instead of a page that silently never loads. Every catch
 * is reported to client_errors, so a broken page surfaces on the monitoring
 * page the same day rather than living on student word of mouth: the Aug 14
 * workbook crash ran for five days precisely because nothing did this.
 */
export default function Error({ error, reset }) {
  useEffect(() => { reportClientError(error) }, [error])

  return (
    <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-[#DEE7FF] p-8 text-center">
        <div className="text-4xl mb-3">😵</div>
        <h1 className="text-lg font-bold text-[#2A2035] mb-2">Something broke on this page</h1>
        <p className="text-sm text-[#2A2035]/60 mb-6">
          It&rsquo;s not you — the error has been reported to CUBE automatically.
          Try again, and if it keeps happening, tell your teacher what you were opening.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => reset()}
            className="px-5 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition">
            Try again
          </button>
          {/* A full page load on purpose: <Link/> would navigate within the
              same React tree that just crashed, and the crash may live in
              shared state a soft navigation carries along. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="px-5 py-2 rounded-xl border border-[#DEE7FF] text-sm font-semibold text-[#325099] hover:bg-[#F8FAFF] transition">
            Go home
          </a>
        </div>
      </div>
    </div>
  )
}

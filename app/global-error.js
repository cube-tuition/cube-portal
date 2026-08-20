'use client'
import { useEffect } from 'react'
import { reportClientError } from '../lib/reportClientError'

/*
 * Last-resort boundary — only reached when the ROOT LAYOUT itself crashes, so
 * it must render its own <html>/<body> and can rely on nothing else. Styling
 * is inline for the same reason. Ordinary page crashes stop at app/error.js.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => { reportClientError(error, { global: true }) }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#F8FAFF', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 420, background: '#fff', border: '1px solid #DEE7FF', borderRadius: 16, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>😵</div>
          <h1 style={{ fontSize: 17, color: '#2A2035', margin: '0 0 8px' }}>The portal hit a problem</h1>
          <p style={{ fontSize: 13, color: 'rgba(42,32,53,.6)', margin: '0 0 20px' }}>
            The error has been reported to CUBE automatically. Try again in a moment.
          </p>
          <button onClick={() => reset()}
            style={{ padding: '9px 20px', borderRadius: 10, border: 0, background: '#325099', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}

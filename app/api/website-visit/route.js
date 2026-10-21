import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/*
 * POST /api/website-visit — the public website's pageview beacon.
 *
 * Called from cubetuition.com.au (separate repo: cube-website) on every route
 * change. Body: { path, first } where `first` marks the browser's first hit of
 * the day (its own localStorage flag), which is what the daily-visitors count
 * sums. Aggregates straight into website_visits via record_website_visit —
 * no per-visitor rows, no IPs, no cookies: deliberately basic analytics.
 *
 * Public and CORS-open like /api/trial-submission; the damage ceiling is a
 * wrong number on an internal dashboard, so validation just keeps the table
 * clean (real paths only, bots skipped).
 */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

const BOT_UA = /bot|crawler|spider|crawling|preview|headless|lighthouse|pingdom|facebookexternalhit/i

export async function POST(req) {
  try {
    const ua = req.headers.get('user-agent') || ''
    if (BOT_UA.test(ua)) return NextResponse.json({ ok: true, skipped: 'bot' }, { headers: CORS })

    const { path, first } = await req.json().catch(() => ({}))
    // A real site path: leading slash, no protocol smuggling, query stripped.
    const clean = String(path || '').split('?')[0].split('#')[0]
    if (!clean.startsWith('/') || clean.startsWith('//') || clean.length > 200) {
      return NextResponse.json({ error: 'Bad path' }, { status: 400, headers: CORS })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { error } = await sb.rpc('record_website_visit', { p_path: clean, p_first: !!first })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS })
    return NextResponse.json({ ok: true }, { headers: CORS })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS })
  }
}

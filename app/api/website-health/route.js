import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'

/*
 * GET /api/website-health  (directors/admins)
 *
 * On-demand health snapshot of the PUBLIC website (cubetuition.com.au — a
 * separate repo) and everything it depends on from this portal:
 *   • reachability + latency of its key pages,
 *   • the data feeds it renders (website_timetable view, public courses),
 *   • the enquiry pulse (trial submissions arriving through its form —
 *     a long silence usually means the form or its API route broke).
 *
 * Checked when the monitoring page loads, not on a cron: the page IS the
 * check, and a director looking at it is the one who can act.
 */

const SITE = 'https://www.cubetuition.com.au'
const PAGES = [
  { label: 'Home', url: `${SITE}/` },
  { label: 'Free trial form', url: `${SITE}/free-trial-form` },
  { label: 'Timetable', url: `${SITE}/timetable` },
]

async function checkPage({ label, url }) {
  const started = Date.now()
  try {
    const res = await fetch(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(8000) })
    return { label, url, ok: res.ok, status: res.status, ms: Date.now() - started }
  } catch (e) {
    return { label, url, ok: false, status: null, ms: Date.now() - started, error: e.name === 'TimeoutError' ? 'Timed out after 8s' : e.message }
  }
}

export async function GET(req) {
  try {
    const auth = await requireApiRole(req, ['admin', 'director'])
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const since = new Date(Date.now() - 8 * 7 * 86400000).toISOString()
    const sydneyDay = (offset = 0) => new Date(Date.now() + offset * 86400000)
      .toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })

    const [pages, timetable, courses, recent, latest, visitsRes] = await Promise.all([
      Promise.all(PAGES.map(checkPage)),
      sb.from('website_timetable').select('*', { count: 'exact', head: true }),
      sb.from('courses').select('*', { count: 'exact', head: true }),
      sb.from('trial_submissions').select('submitted_at, source').gte('submitted_at', since),
      sb.from('trial_submissions')
        .select('student_name, student_year, subjects, source, submitted_at')
        .order('submitted_at', { ascending: false }).limit(5),
      sb.from('website_visits').select('day, path, views, uniques').gte('day', sydneyDay(-29)),
    ])

    // Weekly enquiry counts, oldest → newest (8 buckets ending today).
    const weeks = Array.from({ length: 8 }, () => 0)
    const now = Date.now()
    for (const s of recent.data || []) {
      const ago = Math.floor((now - new Date(s.submitted_at).getTime()) / (7 * 86400000))
      if (ago >= 0 && ago < 8) weeks[7 - ago]++
    }

    // Traffic (beacon aggregates): 30 daily totals oldest → newest, top pages.
    const visits = visitsRes.data || []
    const dayKeys = Array.from({ length: 30 }, (_, i) => sydneyDay(i - 29))
    const byDay = Object.fromEntries(dayKeys.map(d => [d, { day: d, views: 0, uniques: 0 }]))
    const byPath = {}
    for (const v of visits) {
      if (byDay[v.day]) { byDay[v.day].views += v.views; byDay[v.day].uniques += v.uniques }
      byPath[v.path] = (byPath[v.path] || 0) + v.views
    }
    const daily = dayKeys.map(d => byDay[d])
    const today = daily[29], last7 = daily.slice(23)
    const traffic = {
      daily,
      today: { views: today.views, uniques: today.uniques },
      week: {
        views: last7.reduce((s, d) => s + d.views, 0),
        uniques: last7.reduce((s, d) => s + d.uniques, 0),
      },
      topPages: Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([path, views]) => ({ path, views })),
      tracking: visits.length > 0,
    }

    return Response.json({
      checkedAt: new Date().toISOString(),
      pages,
      feeds: {
        timetableRows: timetable.count ?? null,
        courses: courses.count ?? null,
      },
      enquiries: {
        weekly: weeks,
        lastAt: latest.data?.[0]?.submitted_at || null,
        recent: latest.data || [],
      },
      traffic,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

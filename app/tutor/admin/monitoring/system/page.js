'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import { WATCHED_JOBS } from '../../../../../lib/systemHealth'

/*
 * System — /tutor/admin/monitoring/system (admin only)
 *
 * The portal's own health: the latest morning check (lib/systemHealth), every
 * scheduled job's recent runs (job_runs) and the crashes people hit in the
 * last week (client_errors). The Action Centre's System card links here.
 */

const JOB_LABELS = { ...WATCHED_JOBS, health_check: 'Morning system check' }
const fmt = (iso) => new Date(iso).toLocaleString('en-AU', {
  timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
})
const SEV = {
  red:   'bg-rose-50 border-rose-200 text-rose-800',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
}

export default function SystemPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [runs, setRuns] = useState(null)
  const [errors, setErrors] = useState([])
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    (async () => {
      const { profile: p, role } = await getAuthProfile()
      if (!p || role !== 'admin') { router.replace('/tutor'); return }
      setProfile(p)
      const since = new Date(Date.now() - 7 * 86400000).toISOString()
      const [{ data: r, error: e1 }, { data: ce, error: e2 }] = await Promise.all([
        supabase.from('job_runs').select('id, job, started_at, finished_at, ok, detail, error').order('finished_at', { ascending: false }).limit(60),
        supabase.from('client_errors').select('at, route, message').gte('at', since).order('at', { ascending: false }).limit(500),
      ])
      if (e1 || e2) setLoadError((e1 || e2).message)
      setRuns(r || [])
      setErrors(ce || [])
    })()
  }, [router])

  const lastCheck = useMemo(() => (runs || []).find(r => r.job === 'health_check'), [runs])
  const problems = lastCheck?.detail?.problems || []
  const jobs = useMemo(() => {
    const by = {}
    for (const r of runs || []) if (r.job !== 'health_check') (by[r.job] ||= []).push(r)
    return Object.keys({ ...WATCHED_JOBS, ...by }).map(job => ({ job, runs: by[job] || [] }))
  }, [runs])
  const crashGroups = useMemo(() => {
    const m = new Map()
    for (const e of errors) {
      const g = m.get(e.message) || { message: e.message, routes: new Set(), n: 0, last: e.at }
      g.n++; g.routes.add(String(e.route || '').split('?')[0])
      m.set(e.message, g)
    }
    return [...m.values()].sort((a, b) => b.n - a.n)
  }, [errors])

  if (!profile || !runs) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-5xl mx-auto px-4 pt-5 pb-16 md:px-6 md:pt-10 space-y-4 md:space-y-6">
        <div className="rounded-2xl px-5 py-5 md:px-7 md:py-6 border bg-[#EEF3FF] border-[#DEE7FF]">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🩺</span>
            <div>
              <h1 className="text-2xl font-bold text-[#062E63]">System</h1>
              <p className="text-xs text-[#2A2035]/55 mt-0.5">
                Checked every morning: the scheduled jobs, the invoice queue and crashes in the portal. Problems are pushed to the directors&rsquo; phones.
              </p>
            </div>
          </div>
        </div>
        {loadError && <p className="px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700">{loadError}</p>}

        {/* Latest morning check */}
        <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#DEE7FF] flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-[#062E63]">Morning check</p>
            <p className="text-[11px] text-[#2A2035]/45">{lastCheck ? `last run ${fmt(lastCheck.finished_at)}` : 'not run yet — the first one is tomorrow morning'}</p>
          </div>
          {lastCheck && !problems.length && (
            <p className="px-5 py-4 text-sm font-semibold text-[#065F46]">✓ All clear.</p>
          )}
          {problems.length > 0 && (
            <ul className="p-3 space-y-2">
              {problems.map((p, i) => (
                <li key={i} className={`rounded-xl border px-4 py-3 ${SEV[p.severity] || SEV.amber}`}>
                  <p className="text-sm font-semibold">{p.title}</p>
                  {p.detail && <p className="text-xs mt-0.5 opacity-80">{p.detail}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Scheduled jobs */}
        <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
          <p className="px-5 py-3 border-b border-[#DEE7FF] text-sm font-bold text-[#062E63]">Scheduled jobs</p>
          <ul className="divide-y divide-[#F0F4FF]">
            {jobs.map(({ job, runs: rs }) => (
              <li key={job} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#2A2035]">{JOB_LABELS[job] || job}</p>
                  {rs[0]
                    ? <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${rs[0].ok ? 'bg-[#ECFDF5] text-[#065F46]' : 'bg-rose-100 text-rose-700'}`}>
                        {rs[0].ok ? '✓ ok' : '✕ failed'} · {fmt(rs[0].finished_at)}
                      </span>
                    : <span className="text-[11px] text-[#2A2035]/40">no runs recorded yet</span>}
                </div>
                {rs[0] && !rs[0].ok && rs[0].error && <p className="text-xs text-rose-700 mt-1">{rs[0].error}</p>}
                {rs.length > 1 && (
                  <p className="text-[11px] text-[#2A2035]/45 mt-1">
                    Last {Math.min(rs.length, 14)}: {rs.slice(0, 14).map(r => (r.ok ? '●' : '✕')).join(' ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Crashes */}
        <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#DEE7FF] flex items-center justify-between">
            <p className="text-sm font-bold text-[#062E63]">Crashes in the last 7 days</p>
            <p className="text-[11px] text-[#2A2035]/45">{errors.length} total</p>
          </div>
          {!crashGroups.length && <p className="px-5 py-4 text-sm text-[#2A2035]/50">None recorded.</p>}
          <ul className="divide-y divide-[#F0F4FF]">
            {crashGroups.map((g, i) => (
              <li key={i} className="px-5 py-3">
                <p className="text-sm font-mono text-[#2A2035] break-words">{g.message}</p>
                <p className="text-[11px] text-[#2A2035]/50 mt-0.5">
                  ×{g.n} · last {fmt(g.last)} · {[...g.routes].slice(0, 3).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

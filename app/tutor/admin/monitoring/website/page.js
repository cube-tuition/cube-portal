'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthProfile } from '../../../../../lib/getProfile'
import { authedFetch } from '../../../../../lib/authedFetch'
import TutorNav from '../../../../../components/TutorNav'

/*
 * Website monitoring — /tutor/admin/monitoring/website (admin only)
 *
 * The public site (cubetuition.com.au) lives in its own repo, but everything
 * it shows and collects flows through this portal. This page answers, in one
 * look: is the site up, are its data feeds populated, and is the enquiry form
 * still delivering? The check runs when the page loads (and on Re-check) —
 * see /api/website-health.
 */

const fmtAgo = (iso) => {
  if (!iso) return '—'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${Math.max(mins, 0)} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} days ago`
}
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'

export default function WebsiteMonitoringPage() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    setChecking(true); setError('')
    try {
      const res = await authedFetch('/api/website-health')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Health check failed')
      setData(body)
    } catch (e) { setError(e.message) }
    finally { setChecking(false) }
  }, [])

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setStaff(profile)
      load()
    })()
  }, [router, load])

  if (!staff) return <div className="min-h-screen bg-[#F8FAFF]" />

  const daysSinceEnquiry = data?.enquiries?.lastAt
    ? Math.floor((Date.now() - new Date(data.enquiries.lastAt).getTime()) / 86400000) : null
  // Two quiet weeks on the enquiry form is unusual enough to check the form.
  const enquiryStale = daysSinceEnquiry != null && daysSinceEnquiry > 14
  const weekly = data?.enquiries?.weekly || []
  const weekMax = Math.max(...weekly, 1)

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin />
      <div className="max-w-5xl mx-auto px-4 pt-5 pb-16 md:px-6 md:pt-8">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
          <div>
            <h1 className="text-2xl font-bold font-display text-[#062E63]">Website</h1>
            <p className="text-sm text-[#325099]/60 mt-1">
              cubetuition.com.au — uptime, the data it renders, and whether enquiries are still coming through.
              {data && <span className="text-[#2A2035]/40"> · checked {fmtAgo(data.checkedAt)}</span>}
            </p>
          </div>
          <button onClick={load} disabled={checking}
            className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-4 py-2 rounded-full transition disabled:opacity-40">
            {checking ? 'Checking…' : '↻ Re-check'}
          </button>
        </div>

        {error && <p className="text-sm text-[#B23A3A] mb-4">{error}</p>}
        {!data && !error && (
          <div className="grid sm:grid-cols-3 gap-3 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl border border-[#DEE7FF]" />)}
          </div>
        )}

        {data && (
          <div className="space-y-5">
            {/* Traffic — the site's own pageview beacon, aggregated per day */}
            {data.traffic && (
              <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4 md:p-5">
                <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                  <p className="text-xs font-bold tracking-wider uppercase text-[#325099]/60">Traffic — last 30 days</p>
                  {!data.traffic.tracking && (
                    <p className="text-xs text-[#B45309] font-semibold">No visits recorded yet — tracking starts once the site ships its beacon.</p>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div className="rounded-xl border border-[#F0F4FF] p-3">
                    <p className="text-xl font-bold text-[#062E63]">{data.traffic.today.views}</p>
                    <p className="text-xs text-[#2A2035]/55">views today</p>
                  </div>
                  <div className="rounded-xl border border-[#F0F4FF] p-3">
                    <p className="text-xl font-bold text-[#062E63]">{data.traffic.today.uniques}</p>
                    <p className="text-xs text-[#2A2035]/55">visitors today</p>
                  </div>
                  <div className="rounded-xl border border-[#F0F4FF] p-3">
                    <p className="text-xl font-bold text-[#062E63]">{data.traffic.week.views}</p>
                    <p className="text-xs text-[#2A2035]/55">views · 7 days</p>
                  </div>
                  <div className="rounded-xl border border-[#F0F4FF] p-3">
                    <p className="text-xl font-bold text-[#062E63]">{data.traffic.week.uniques}</p>
                    <p className="text-xs text-[#2A2035]/55">visitors · 7 days</p>
                  </div>
                </div>
                {/* 30 daily bars, oldest → newest */}
                {(() => {
                  const dayMax = Math.max(...data.traffic.daily.map(d => d.views), 1)
                  return (
                    <div className="flex items-end gap-[3px] h-20 mb-1">
                      {data.traffic.daily.map((d) => (
                        <div key={d.day} className="flex-1 rounded-t-sm bg-[#BACBFF] hover:bg-[#325099] transition-colors"
                          title={`${new Date(d.day + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} · ${d.views} views · ${d.uniques} visitors`}
                          style={{ height: `${Math.max((d.views / dayMax) * 72, d.views ? 5 : 2)}px` }} />
                      ))}
                    </div>
                  )
                })()}
                <p className="text-[10px] text-[#2A2035]/40 mb-3">views per day · hover a bar for the date · newest on the right</p>
                {data.traffic.topPages.length > 0 && (
                  <div className="divide-y divide-[#F4F7FF]">
                    {data.traffic.topPages.map((p) => (
                      <div key={p.path} className="py-1.5 flex items-baseline gap-3 text-xs">
                        <code className="text-[#062E63] font-semibold">{p.path}</code>
                        <span className="ml-auto text-[#2A2035]/50 tabular-nums">{p.views} views</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Uptime of the key pages */}
            <div className="grid sm:grid-cols-3 gap-3">
              {data.pages.map((p) => (
                <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer"
                  className={`bg-white rounded-2xl border p-4 hover:shadow-sm transition ${p.ok ? 'border-[#F0F4FF]' : 'border-[#FECACA] bg-[#FEF2F2]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-[#062E63]">{p.label}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.ok ? 'bg-[#ECFDF5] text-[#047857] border border-[#D1FAE5]' : 'bg-[#FEF2F2] text-[#B23A3A] border border-[#FECACA]'}`}>
                      {p.ok ? 'UP' : 'DOWN'}
                    </span>
                  </div>
                  <p className="text-xs text-[#2A2035]/55 mt-2">
                    {p.ok
                      ? <>HTTP {p.status} · <span className={p.ms > 3000 ? 'text-[#B45309] font-semibold' : ''}>{p.ms} ms</span></>
                      : (p.error || `HTTP ${p.status ?? '—'}`)}
                  </p>
                </a>
              ))}
            </div>

            {/* The data the site renders from this portal */}
            <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4 md:p-5">
              <p className="text-xs font-bold tracking-wider uppercase text-[#325099]/60 mb-3">Data feeds the site renders</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className={`rounded-xl border p-3 ${data.feeds.timetableRows === 0 ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[#F0F4FF]'}`}>
                  <p className="text-xl font-bold text-[#062E63]">{data.feeds.timetableRows ?? '—'}</p>
                  <p className="text-xs text-[#2A2035]/55">rows in the public timetable view{data.feeds.timetableRows === 0 && ' — the site’s timetable page is showing EMPTY'}</p>
                </div>
                <div className={`rounded-xl border p-3 ${data.feeds.courses === 0 ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[#F0F4FF]'}`}>
                  <p className="text-xl font-bold text-[#062E63]">{data.feeds.courses ?? '—'}</p>
                  <p className="text-xs text-[#2A2035]/55">courses readable by the public site</p>
                </div>
              </div>
            </div>

            {/* Enquiry pulse */}
            <div className={`bg-white rounded-2xl border p-4 md:p-5 ${enquiryStale ? 'border-[#FDE2B8]' : 'border-[#F0F4FF]'}`}>
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                <p className="text-xs font-bold tracking-wider uppercase text-[#325099]/60">Enquiry pulse — trial form submissions</p>
                <p className={`text-xs ${enquiryStale ? 'text-[#B45309] font-bold' : 'text-[#2A2035]/50'}`}>
                  last enquiry {fmtAgo(data.enquiries.lastAt)}{enquiryStale && ' — unusually quiet, check the form end-to-end'}
                </p>
              </div>
              {/* 8 weekly bars, oldest → newest */}
              <div className="flex items-end gap-1.5 h-20 mb-1">
                {weekly.map((n, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-[#2A2035]/45 tabular-nums">{n || ''}</span>
                    <div className="w-full rounded-t-md bg-[#BACBFF]" style={{ height: `${Math.max((n / weekMax) * 56, n ? 6 : 2)}px`, opacity: i === 7 ? 1 : 0.7 }} />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[#2A2035]/40 mb-4">per week · last 8 weeks · newest on the right</p>
              <div className="divide-y divide-[#F4F7FF]">
                {data.enquiries.recent.map((s, i) => (
                  <div key={i} className="py-2 flex items-baseline gap-3 text-xs flex-wrap">
                    <span className="font-semibold text-[#062E63]">{s.student_name || 'Unknown'}</span>
                    <span className="text-[#2A2035]/50">Year {String(s.student_year || '?').replace(/^year\s*/i, '')}</span>
                    <span className="text-[#2A2035]/50">{Array.isArray(s.subjects) ? s.subjects.join(', ') : s.subjects || ''}</span>
                    <span className="ml-auto text-[#2A2035]/40">{s.source === 'website_form' ? 'website' : s.source} · {fmtDate(s.submitted_at)}</span>
                  </div>
                ))}
                {!data.enquiries.recent.length && <p className="py-2 text-xs text-[#2A2035]/40">No enquiries recorded yet.</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

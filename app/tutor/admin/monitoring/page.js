'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import AnalyticsDashboard from '../../../../components/analytics/AnalyticsDashboard'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../../lib/terms'
import { classesForTerm } from '../../../../lib/classes'
import { T_ENROLMENTS, T_QUIZ_RESULTS, T_STUDENTS } from '../../../../lib/tables'
import { sydneyToday, addDays } from '../../../../lib/portalAnalytics'

/*
 * Portal Analytics — /tutor/admin/monitoring (admin only)
 *
 * This file is auth + data. All the reading of that data — filters, KPIs,
 * scores, tables, the drawer — lives in AnalyticsDashboard, which takes raw
 * rows so it can also be rendered by a harness for visual checks.
 *
 * Fetch horizon: 140 days of activity/page views (enough for a term view plus
 * an equal previous period), 35 days of the event stream, and the current
 * term's tutor-recorded marks (homework grades + RQ scores).
 */
/*
 * Client crashes from the last fortnight, grouped by route + message so one
 * broken page reads as one line with a count — not two hundred rows. Renders
 * nothing when there is nothing to report, so the page stays clean in the
 * (usual) case of zero crashes.
 */
function CrashStrip({ crashes, students }) {
  if (!crashes?.length) return null
  const nameOf = Object.fromEntries((students || []).map(s => [s.id, s.full_name]))
  const groups = {}
  for (const c of crashes) {
    const key = `${c.route}::${c.message}`
    const g = (groups[key] ||= { route: c.route, message: c.message, n: 0, latest: c.at, who: new Set(), global: false })
    g.n++
    if (c.at > g.latest) g.latest = c.at
    if (c.user_id) g.who.add(nameOf[c.user_id] || 'a signed-in user')
    if (c.global) g.global = true
  }
  const rows = Object.values(groups).sort((a, b) => b.latest.localeCompare(a.latest))
  const fmt = (iso) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 pt-4">
      <div className="bg-white rounded-2xl border border-[#FDE68A] overflow-hidden">
        <p className="px-4 py-2.5 text-xs font-bold text-[#92400E] bg-[#FFFBEB] border-b border-[#FDE68A]">
          ⚠ Portal crashes · last 14 days · {crashes.length} report{crashes.length === 1 ? '' : 's'}
        </p>
        <div className="divide-y divide-[#F4F7FF]">
          {rows.slice(0, 8).map((g, i) => (
            <div key={i} className="px-4 py-2.5 text-xs flex items-baseline gap-3 flex-wrap">
              <span className="font-bold text-[#B23A3A] tabular-nums shrink-0">{g.n}×</span>
              <code className="text-[#062E63] font-semibold">{g.route}</code>
              <span className="text-[#2A2035]/70 flex-1 min-w-[200px]">{g.message}{g.global ? ' (root layout)' : ''}</span>
              <span className="text-[#2A2035]/40 shrink-0">
                {g.who.size ? `${[...g.who].slice(0, 3).join(', ')}${g.who.size > 3 ? ` +${g.who.size - 3}` : ''} · ` : ''}latest {fmt(g.latest)}
              </span>
            </div>
          ))}
          {rows.length > 8 && <p className="px-4 py-2 text-[11px] text-[#2A2035]/40">…and {rows.length - 8} more distinct errors</p>}
        </div>
      </div>
    </div>
  )
}

export default function MonitoringPage() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setStaff(profile)
      try {
        const today = sydneyToday()
        const terms = await fetchAllTerms()
        const term = getCurrentTerm(terms)
        const horizon = addDays(today, -140)

        const { data: classes } = await classesForTerm(term?.id, 'id, class_name, teacher, day_of_week')
        const classIds = (classes || []).map(c => c.id)

        const [studentsRes, enrRes, viewsRes, actRes, evRes, quizRes, crashRes] = await Promise.all([
          supabase.from(T_STUDENTS).select('id, full_name, year').eq('status', 'active'),
          classIds.length
            ? supabase.from(T_ENROLMENTS).select('student_id, class_id, status')
                .in('class_id', classIds).in('status', ['active', 'trial'])
            : { data: [] },
          supabase.from('portal_page_views').select('user_id, day, path, views').gte('day', horizon),
          supabase.from('portal_activity').select('user_id, day').eq('role', 'student').gte('day', horizon),
          supabase.from('portal_events').select('id, user_id, ts, event, path')
            .gte('ts', addDays(today, -35) + 'T00:00:00+10:00')
            .order('ts', { ascending: false }).limit(20000),
          term
            ? supabase.from(T_QUIZ_RESULTS)
                .select('student_id, subject, week, score, max_score, homework_grade, quiz_date')
                .gte('quiz_date', term.start_date).lte('quiz_date', term.end_date)
            : { data: [] },
          // Client crashes, reported by the error boundaries. Two weeks is
          // enough to catch "has been broken for days" — the failure mode that
          // went unseen in August.
          supabase.from('client_errors').select('at, route, message, user_id, global')
            .gte('at', addDays(today, -14) + 'T00:00:00+10:00')
            .order('at', { ascending: false }).limit(200),
        ])
        setData({
          students: studentsRes.data ?? [],
          classes: classes ?? [],
          enrolments: enrRes.data ?? [],
          views: viewsRes.data ?? [],
          activity: actRes.data ?? [],
          events: evRes.data ?? [],
          quizzes: quizRes.data ?? [],
          crashes: crashRes.data ?? [],
          term, today,
        })
      } catch (e) { setError(e.message || 'Failed to load analytics') }
    })()
  }, [router])

  if (!staff) return <div className="min-h-screen bg-[#F8FAFF]" />

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin />
      <div className="max-w-7xl mx-auto px-6 md:px-10 pt-8 pb-2">
        <h1 className="text-2xl font-bold font-display text-[#062E63]">Portal Analytics</h1>
        <p className="text-sm text-[#325099]/60 mt-1 mb-1">
          Monitor student activity, feature adoption and engagement across the CUBE Student Portal.
          {data?.term ? ` · ${formatTermLabel(data.term)}` : ''}
        </p>
      </div>
      {error ? (
        <p className="max-w-7xl mx-auto px-6 md:px-10 py-6 text-sm text-[#B23A3A]">{error}</p>
      ) : !data ? (
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-6 space-y-4 animate-pulse">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl border border-[#DEE7FF]" />)}
          </div>
          <div className="h-64 bg-white rounded-2xl border border-[#DEE7FF]" />
          <div className="h-80 bg-white rounded-2xl border border-[#DEE7FF]" />
        </div>
      ) : (
        <>
          <CrashStrip crashes={data.crashes} students={data.students} />
          <AnalyticsDashboard {...data} />
        </>
      )}
    </div>
  )
}

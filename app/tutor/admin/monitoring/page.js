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

        const [studentsRes, enrRes, viewsRes, actRes, evRes, quizRes] = await Promise.all([
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
        ])
        setData({
          students: studentsRes.data ?? [],
          classes: classes ?? [],
          enrolments: enrRes.data ?? [],
          views: viewsRes.data ?? [],
          activity: actRes.data ?? [],
          events: evRes.data ?? [],
          quizzes: quizRes.data ?? [],
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
        <AnalyticsDashboard {...data} />
      )}
    </div>
  )
}

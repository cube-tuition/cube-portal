'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts'

export default function Analytics() {
  const [bySubject, setBySubject] = useState([])
  const [overTime, setOverTime] = useState([])
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data } = await supabase
        .from('results')
        .select('score, created_at, exams(name, max_score, exam_date, subjects(name))')
        .eq('student_id', user.id)
        .order('created_at', { ascending: true })

      if (!data) return

      // Group by subject → average %
      const subjectMap = {}
      data.forEach(r => {
        const subj = r.exams?.subjects?.name || 'Unknown'
        const pct = Math.round((r.score / r.exams?.max_score) * 100)
        if (!subjectMap[subj]) subjectMap[subj] = []
        subjectMap[subj].push(pct)
      })
      const subjectData = Object.entries(subjectMap).map(([name, scores]) => ({
        name,
        average: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      }))
      setBySubject(subjectData)

      // Over time
      const timeData = data.map(r => ({
        name: r.exams?.name,
        score: Math.round((r.score / r.exams?.max_score) * 100)
      }))
      setOverTime(timeData)
    }
    load()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-blue-700 text-white px-8 py-4 flex gap-6 items-center">
        <h1 className="text-xl font-bold mr-auto">CUBE Tuition Portal</h1>
        <Link href="/dashboard" className="hover:underline">Home</Link>
        <Link href="/results" className="hover:underline">Results</Link>
        <Link href="/analytics" className="hover:underline">Analytics</Link>
        <Link href="/timetable" className="hover:underline">Timetable</Link>
      </nav>

      <div className="max-w-4xl mx-auto p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-8">📊 My Analytics</h2>

        <div className="bg-white rounded-2xl shadow p-6 mb-8">
          <h3 className="font-bold text-gray-700 mb-4">Average Score by Subject</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={bySubject}>
              <XAxis dataKey="name" />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="average" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <h3 className="font-bold text-gray-700 mb-4">Performance Over Time</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={overTime}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip formatter={(v) => `${v}%`} />
              <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function Dashboard() {
  const [student, setStudent] = useState(null)
  const [recentResults, setRecentResults] = useState([])
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile } = await supabase
        .from('students')
        .select('*')
        .eq('id', user.id)
        .single()
      setStudent(profile)

      const { data: results } = await supabase
        .from('results')
        .select('score, exams(name, max_score, exam_date)')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false })
        .limit(3)
      setRecentResults(results || [])
    }
    load()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (!student) return <div className="min-h-screen flex items-center justify-center">Loading...</div>

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-blue-700 text-white px-8 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">CUBE Tuition Portal</h1>
        <div className="flex gap-6 items-center">
          <Link href="/dashboard" className="hover:underline">Home</Link>
          <Link href="/results" className="hover:underline">Results</Link>
          <Link href="/analytics" className="hover:underline">Analytics</Link>
          <Link href="/timetable" className="hover:underline">Timetable</Link>
          <button onClick={handleLogout} className="bg-white text-blue-700 px-4 py-1 rounded-lg font-semibold">Logout</button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Welcome back, {student.full_name} 👋</h2>
        <p className="text-gray-500 mb-8">Year {student.year_level}</p>

        {/* Quick links */}
        <div className="grid grid-cols-3 gap-6 mb-10">
          {[
            { label: 'My Results', href: '/results', emoji: '📝' },
            { label: 'Analytics', href: '/analytics', emoji: '📊' },
            { label: 'Timetable', href: '/timetable', emoji: '📅' },
          ].map(card => (
            <Link key={card.href} href={card.href}
              className="bg-white rounded-2xl shadow p-6 text-center hover:shadow-md transition">
              <div className="text-4xl mb-3">{card.emoji}</div>
              <div className="font-semibold text-gray-700">{card.label}</div>
            </Link>
          ))}
        </div>

        {/* Recent results */}
        <div className="bg-white rounded-2xl shadow p-6">
          <h3 className="text-lg font-bold text-gray-700 mb-4">Recent Exam Results</h3>
          {recentResults.length === 0 ? (
            <p className="text-gray-400">No results yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Exam</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Score</th>
                  <th className="pb-2">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {recentResults.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2">{r.exams?.name}</td>
                    <td className="py-2">{r.exams?.exam_date}</td>
                    <td className="py-2">{r.score} / {r.exams?.max_score}</td>
                    <td className="py-2 font-semibold text-blue-600">
                      {Math.round((r.score / r.exams?.max_score) * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
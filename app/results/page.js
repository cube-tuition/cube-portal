'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function Results() {
  const [results, setResults] = useState([])
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data } = await supabase
        .from('results')
        .select('score, created_at, exams(name, max_score, exam_date, subjects(name))')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false })
      setResults(data || [])
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
        <h2 className="text-2xl font-bold text-gray-800 mb-6">📝 My Exam Results</h2>
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-blue-50 text-gray-600">
              <tr>
                <th className="text-left px-6 py-3">Exam</th>
                <th className="text-left px-6 py-3">Subject</th>
                <th className="text-left px-6 py-3">Date</th>
                <th className="text-left px-6 py-3">Score</th>
                <th className="text-left px-6 py-3">%</th>
                <th className="text-left px-6 py-3">Grade</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const pct = Math.round((r.score / r.exams?.max_score) * 100)
                const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : 'D'
                const gradeColor = pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-500'
                return (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="px-6 py-3">{r.exams?.name}</td>
                    <td className="px-6 py-3">{r.exams?.subjects?.name}</td>
                    <td className="px-6 py-3">{r.exams?.exam_date}</td>
                    <td className="px-6 py-3">{r.score} / {r.exams?.max_score}</td>
                    <td className="px-6 py-3 font-semibold">{pct}%</td>
                    <td className={`px-6 py-3 font-bold ${gradeColor}`}>{grade}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {results.length === 0 && (
            <p className="text-center text-gray-400 py-8">No results found.</p>
          )}
        </div>
      </div>
    </div>
  )
}
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function Timetable() {
  const [schedule, setSchedule] = useState([])
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data } = await supabase
        .from('timetable')
        .select('*')
        .eq('student_id', user.id)
      setSchedule(data || [])
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
        <h2 className="text-2xl font-bold text-gray-800 mb-6">📅 My Timetable</h2>
        <div className="grid gap-4">
          {DAYS.map(day => {
            const classes = schedule.filter(s => s.day_of_week === day)
            return (
              <div key={day} className="bg-white rounded-2xl shadow p-5">
                <h3 className="font-bold text-blue-700 mb-3">{day}</h3>
                {classes.length === 0 ? (
                  <p className="text-gray-400 text-sm">No classes</p>
                ) : (
                  classes.map((c, i) => (
                    <div key={i} className="flex items-center gap-4 bg-blue-50 rounded-lg px-4 py-2 mb-2">
                      <span className="text-sm text-gray-500">{c.start_time} – {c.end_time}</span>
                      <span className="font-semibold text-gray-800">{c.subject}</span>
                      <span className="text-sm text-gray-500 ml-auto">📍 {c.location}</span>
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
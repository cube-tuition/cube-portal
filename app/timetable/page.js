'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import { useRouter } from 'next/navigation'
import PortalNav from '../../components/PortalNav'
import { normalizeDay } from '../../lib/format'
import { T_STUDENTS, T_TIMETABLE } from '../../lib/tables'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const SUBJECT_COLOR = {
  Maths:     { bg: '#DEE7FF', fg: '#062E63' },
  Math:      { bg: '#DEE7FF', fg: '#062E63' },
  English:   { bg: '#FCE7F3', fg: '#9D174D' },
  EALD:      { bg: '#FCE7F3', fg: '#9D174D' },
  SpeakDev:  { bg: '#EDE9FE', fg: '#5B21B6' },
  Chemistry: { bg: '#D1FAE5', fg: '#065F46' },
  Chem:      { bg: '#D1FAE5', fg: '#065F46' },
  Physics:   { bg: '#E0E7FF', fg: '#3730A3' },
  Biology:   { bg: '#D1FAE5', fg: '#065F46' },
  Economics: { bg: '#FEF3C7', fg: '#92400E' },
  Econ:      { bg: '#FEF3C7', fg: '#92400E' },
  Science:   { bg: '#D1FAE5', fg: '#065F46' },
}
const pickSubjectColor = (name = '') => {
  const lower = name.toLowerCase()
  const keys = Object.keys(SUBJECT_COLOR).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    if (lower.includes(k.toLowerCase())) return SUBJECT_COLOR[k]
  }
  return { bg: '#DEE7FF', fg: '#062E63' }
}

export default function Timetable() {
  const [student, setStudent] = useState(null)
  const [schedule, setSchedule] = useState([])
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!requireStudent(user, router)) return

      const { data: profile } = await supabase
        .from(T_STUDENTS)
        .select('*')
        .eq('id', user.id)
        .single()
      setStudent(profile)

      const { data } = await supabase
        .from(T_TIMETABLE)
        .select('*')
        .eq('student_id', user.id)
      setSchedule(data || [])
    }
    load()
  }, [])

  const todayName = DAYS[(new Date().getDay() + 6) % 7] // Monday-indexed

  return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student?.full_name} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-3 font-display">
            Your week
          </p>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Timetable
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            Every CUBE class you're enrolled in, by day.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {DAYS.map(day => {
            const classes = schedule.filter(s => normalizeDay(s.day_of_week) === day)
            const isToday = day === todayName
            return (
              <div
                key={day}
                className={`bg-white rounded-2xl border ${isToday ? 'border-[#BACBFF]' : 'border-[#DEE7FF]'} p-5 relative`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-[#2A2035] font-display">
                    {day}
                  </h3>
                  {isToday && (
                    <span className="text-[10px] tracking-widest uppercase font-bold bg-[#062E63] text-white px-2.5 py-1 rounded-full">
                      Today
                    </span>
                  )}
                </div>
                {classes.length === 0 ? (
                  <p className="text-xs text-[#2A2035]/40">No classes</p>
                ) : (
                  <div className="space-y-2">
                    {classes.map((c, i) => {
                      const col = pickSubjectColor(c.subject)
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-[#F8FAFF] border border-[#DEE7FF]"
                        >
                          <span
                            className="w-1 h-9 rounded-full shrink-0"
                            style={{ background: col.fg }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#2A2035] truncate">{c.subject}</p>
                            <div className="flex gap-3 text-[11px] text-[#2A2035]/60 mt-0.5">
                              <span className="tabular-nums">{c.start_time}–{c.end_time}</span>
                              {c.location && <span>📍 {c.location}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">
            © CUBE Tuition · Chatswood
          </p>
        </div>
      </footer>
    </div>
  )
}

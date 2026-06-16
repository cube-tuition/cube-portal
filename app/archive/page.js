'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import {
  fetchAllTerms,
  getCurrentTerm,
  getPastTerms,
  formatTermLabel,
  formatTermRange,
  filterByTerm,
} from '../../lib/terms'
import PortalNav from '../../components/PortalNav'
import { T_STUDENTS, T_QUIZ_RESULTS, T_RESULTS, T_ATTENDANCE } from '../../lib/tables'

export default function ArchivePage() {
  const [student, setStudent] = useState(null)
  const [terms, setTerms] = useState([])
  const [currentTerm, setCurrentTerm] = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [results, setResults] = useState([])
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!requireStudent(user, router)) return

      const { data: profile } = await supabase
        .from(T_STUDENTS).select('*').eq('id', user.id).single()
      setStudent(profile)

      const all = await fetchAllTerms()
      setTerms(all)
      setCurrentTerm(getCurrentTerm(all))

      const [{ data: qz }, { data: ex }, { data: at }] = await Promise.all([
        supabase.from(T_QUIZ_RESULTS).select('subject, score, max_score, quiz_date').eq('student_id', user.id),
        supabase.from(T_RESULTS).select('score, exams(name, max_score, exam_date)').eq('student_id', user.id),
        supabase.from(T_ATTENDANCE).select('class_id, session_date, status').eq('student_id', user.id),
      ])
      setQuizzes(qz || [])
      setResults(ex || [])
      setAttendance(at || [])
      setLoading(false)
    }
    load()
  }, [])

  const past = useMemo(
    () => getPastTerms(terms, currentTerm?.id),
    [terms, currentTerm]
  )

  return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student?.full_name} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-3 font-display">
            Past Terms
          </p>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Past Terms
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            Everything from every term you&rsquo;ve been at CUBE — quizzes, homework, exams, attendance — all kept here for whenever you need it.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {loading ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center text-sm text-[#2A2035]/50">
            Loading your history…
          </div>
        ) : past.length === 0 ? (
          <div className="rounded-2xl border border-[#DEE7FF] bg-white p-12 text-center">
            <div className="text-4xl mb-2">🌱</div>
            <p className="text-sm font-semibold text-[#2A2035]">No past terms yet.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">
              Once this term wraps up, it&rsquo;ll show up here so you can always look back.
            </p>
            <Link
              href="/results"
              className="inline-block mt-5 bg-[#325099] text-white text-xs font-semibold px-4 py-2 rounded-full hover:bg-[#062E63] transition"
            >
              See current term →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {past.map(t => {
              const tq = filterByTerm(quizzes, 'quiz_date', t)
              const tr = filterByTerm(results, 'exams.exam_date', t)
              const ta = filterByTerm(attendance, 'session_date', t)

              const quizAvg = tq.length
                ? Math.round(tq.reduce((s, q) => s + (q.score / q.max_score) * 100, 0) / tq.length)
                : null
              const attended = ta.filter(a => {
                const s = (a.status || 'present').toLowerCase()
                return s === 'present' || s === 'late'
              }).length
              const attPct = ta.length ? Math.round((attended / ta.length) * 100) : null

              return (
                <Link
                  key={t.id}
                  href={`/archive/${t.id}`}
                  className="group bg-white rounded-2xl border border-[#DEE7FF] p-6 hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition flex flex-col"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                        Term · Year {t.year}
                      </p>
                      <h3 className="text-xl font-bold text-[#2A2035] font-display">
                        {formatTermLabel(t)}
                      </h3>
                      <p className="text-xs text-[#2A2035]/50 mt-1">
                        {formatTermRange(t)}
                      </p>
                    </div>
                    <span className="text-[#325099] text-lg transition-transform group-hover:translate-x-0.5">→</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-auto">
                    <ArchiveStat label="Quiz avg" value={quizAvg !== null ? `${quizAvg}%` : '—'} />
                    <ArchiveStat label="Exams"    value={String(tr.length)} />
                    <ArchiveStat label="Attendance" value={attPct !== null ? `${attPct}%` : '—'} />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
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

function ArchiveStat({ label, value }) {
  return (
    <div className="rounded-xl bg-[#F8FAFF] border border-[#DEE7FF] px-3 py-2.5">
      <p className="text-[9px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-0.5">
        {label}
      </p>
      <p className="text-base font-bold text-[#2A2035] font-display tabular-nums leading-none">
        {value}
      </p>
    </div>
  )
}

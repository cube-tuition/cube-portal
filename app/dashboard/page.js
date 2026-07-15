'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PortalNav from '../../components/PortalNav'
import { normalizeDay } from '../../lib/format'
import { fetchAllTerms, getEnrolmentTerm, formatTermLabel } from '../../lib/terms'
import { T_STUDENTS, T_LESSONS } from '../../lib/tables'
import { enrolledClassesForTerm } from '../../lib/classes'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

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
  // Iterate longest-first so e.g. "Chemistry" beats "Chem" if both match
  const keys = Object.keys(SUBJECT_COLOR).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    if (lower.includes(k.toLowerCase())) return SUBJECT_COLOR[k]
  }
  return { bg: '#DEE7FF', fg: '#062E63' }
}

function greeting() {
  const h = new Date().getHours()
  if (h < 5)  return 'Burning the midnight oil'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Late one tonight'
}

export default function Dashboard() {
  const [student, setStudent] = useState(null)
  const [authedUser, setAuthedUser] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [todayClasses, setTodayClasses] = useState([])
  const [allClasses, setAllClasses] = useState([])
  const [currentTerm, setCurrentTerm] = useState(null)
  const [makeupLessons, setMakeupLessons] = useState([])
  const router = useRouter()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!requireStudent(user, router)) return
      setAuthedUser(user)

      const { data: profile, error: profileErr } = await supabase
        .from(T_STUDENTS)
        .select('*')
        .eq('id', user.id)
        .single()
      if (profileErr || !profile) {
        setProfileError(profileErr || { message: 'No matching row in students table.' })
        return
      }
      setStudent(profile)

      // Current term — drives the term chip in the hero
      const terms = await fetchAllTerms()
      const term = getEnrolmentTerm(terms)
      setCurrentTerm(term)

      // Classes are per-term rows (the term transition copies each class into
      // the next term), so scope to the current term or every class shows twice.
      const { data: classData } = await enrolledClassesForTerm(
        user.id, term?.id, 'class_name, day_of_week, start_time, end_time, teacher, room')

      const classes = classData?.map(d => d.classes) || []
      setAllClasses(classes)

      const todayName = DAYS[new Date().getDay()]
      setTodayClasses(classes.filter(c =>
        normalizeDay(c.day_of_week).toLowerCase().includes(todayName.toLowerCase())
      ))

      // Fetch makeup lessons for this student (±6 weeks)
      const now = new Date()
      const sixWeeksAgo = new Date(now); sixWeeksAgo.setDate(now.getDate() - 42)
      const sixWeeksAhead = new Date(now); sixWeeksAhead.setDate(now.getDate() + 42)
      const { data: makeupData } = await supabase
        .from(T_LESSONS)
        .select(`id, lesson_date, start_time, end_time, room, classes(class_name), makeup_source_lesson_id`)
        .eq('is_makeup', true)
        .eq('makeup_student_id', user.id)
        .gte('lesson_date', sixWeeksAgo.toISOString().slice(0, 10))
        .lte('lesson_date', sixWeeksAhead.toISOString().slice(0, 10))
        .order('lesson_date', { ascending: true })
      setMakeupLessons(makeupData || [])
    }
    load()
  }, [])

  if (profileError) return (
    <div className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-[#DEE7FF] p-8 text-center">
        <div className="text-4xl mb-3">🔑</div>
        <h1 className="text-lg font-semibold text-[#2A2035] font-display mb-2">
          You're signed in, but we couldn't load your student profile.
        </h1>
        <p className="text-sm text-[#2A2035]/60 mb-4">
          {profileError.message || 'Unknown error.'}
        </p>
        <p className="text-xs text-[#2A2035]/50 mb-5">
          Auth user id: <span className="font-mono">{authedUser?.id}</span>
          <br />
          Likely fix: add a row in <span className="font-mono">students</span> with this id, or check RLS policies.
        </p>
        <button
          onClick={async () => { await supabase.auth.signOut(); router.push('/') }}
          className="text-xs font-semibold bg-[#325099] text-white px-4 py-2 rounded-full hover:bg-[#062E63] transition"
        >
          Sign out
        </button>
      </div>
    </div>
  )

  if (!student) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">
        Loading…
      </div>
    </div>
  )

  const todayName = DAYS[new Date().getDay()]
  const firstName = (student.full_name || '').split(' ')[0] || 'there'

  return (
    <div className="min-h-screen bg-white">
      <PortalNav studentName={student.full_name} />

      {/* HERO */}
      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-12 md:py-16">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">
              {greeting()}, {firstName}
            </p>
            {currentTerm && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#062E63] bg-white border border-[#DEE7FF] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#325099]" />
                {formatTermLabel(currentTerm)}
              </span>
            )}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display">
            Ready when you are. <span className="inline-block">👋</span>
          </h1>
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            {student.school} · Year {student.year}
          </p>

          {/* Stat strip */}
          <div className="grid grid-cols-2 gap-3 mt-8 max-w-xl">
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Today</p>
              <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">
                {todayClasses.length}
                <span className="text-sm font-medium text-[#2A2035]/50 ml-1">class{todayClasses.length === 1 ? '' : 'es'}</span>
              </p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Classes</p>
              <p className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">
                {allClasses.length}
                <span className="text-sm font-medium text-[#2A2035]/50 ml-1">enrolled</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* QUICK NAV CARDS */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-4 font-display">
          Jump in
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          {[
            { label: 'Results & Analytics', href: '/results', emoji: '📈', desc: 'Exam scores, quiz tracker & trends', accent: '#DEE7FF' },
            { label: 'Resources',           href: '/resources', emoji: '📚', desc: 'Term booklets & study materials',     accent: '#FEF3C7' },
            { label: 'Drop-in Help',        href: '/dropin',    emoji: '🙋', desc: 'Book a free exam & HW help session',  accent: '#D1FAE5' },
          ].map(card => (
            <Link
              key={card.href}
              href={card.href}
              className="group bg-white rounded-2xl border border-[#DEE7FF] p-5 flex items-center gap-4 hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition"
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                style={{ background: card.accent }}
              >
                {card.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#2A2035] font-display">{card.label}</p>
                <p className="text-xs text-[#2A2035]/50 mt-0.5">{card.desc}</p>
              </div>
              <span className="text-[#325099] transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          ))}
        </div>

        {/* MAIN ROW */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          {/* TODAY'S CLASSES */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                  Today
                </p>
                <h2 className="text-lg font-semibold text-[#2A2035] font-display">
                  {todayName}'s Classes
                </h2>
              </div>
              <span className="text-[10px] tracking-widest uppercase font-semibold text-[#325099]/60">
                {todayClasses.length} scheduled
              </span>
            </div>
            {todayClasses.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-2">🎉</div>
                <p className="text-sm font-semibold text-[#2A2035]">No classes today!</p>
                <p className="text-xs text-[#2A2035]/50 mt-1">Day off — make it count.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayClasses.map((c, i) => {
                  const col = pickSubjectColor(c.class_name)
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-xl px-4 py-3 border border-[#DEE7FF] bg-[#F8FAFF]"
                    >
                      <div
                        className="w-1 h-10 rounded-full shrink-0"
                        style={{ background: col.fg }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-[#2A2035]">{c.class_name}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-[#2A2035]/60">
                          <span>🕐 {c.start_time}–{c.end_time}</span>
                          {c.teacher && <span>👤 {c.teacher}</span>}
                          {c.room && <span>📍 {c.room}</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* MY CLASSES */}
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
                  All week
                </p>
                <h2 className="text-lg font-semibold text-[#2A2035] font-display">My Classes</h2>
              </div>
            </div>
            {allClasses.length === 0 ? (
              <p className="text-sm text-center text-[#2A2035]/50 py-8">No classes scheduled yet.</p>
            ) : (
              <div className="divide-y divide-[#DEE7FF]">
                {[...allClasses]
                  .sort((a, b) => DAY_ORDER.indexOf(normalizeDay(a.day_of_week)) - DAY_ORDER.indexOf(normalizeDay(b.day_of_week)))
                  .map((c, i) => {
                    const col = pickSubjectColor(c.class_name)
                    return (
                      <div key={i} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-3">
                          <span
                            className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                            style={{ background: col.bg, color: col.fg }}
                          >
                            {c.class_name}
                          </span>
                          {c.room && <span className="text-[11px] text-[#2A2035]/50">{c.room}</span>}
                        </div>
                        <span className="text-xs font-medium text-[#325099]">
                          {normalizeDay(c.day_of_week)} · {c.start_time}
                        </span>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        </div>

        {/* MAKEUP LESSONS */}
        {makeupLessons.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#C4B5FD] p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-[#7C3AED]" />
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#7C3AED] font-semibold font-display">
                Makeup Lessons
              </p>
            </div>
            <div className="space-y-2">
              {makeupLessons.map(lesson => {
                const dateStr = lesson.lesson_date
                  ? new Date(lesson.lesson_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
                  : '—'
                const isPast = lesson.lesson_date && lesson.lesson_date < new Date().toISOString().slice(0, 10)
                return (
                  <div
                    key={lesson.id}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 border"
                    style={{ background: '#FAF5FF', borderColor: '#DDD6FE' }}
                  >
                    <div className="w-1 h-10 rounded-full shrink-0" style={{ background: '#7C3AED' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm text-[#2A2035]">
                          {lesson.classes?.class_name || 'Makeup Lesson'}
                        </p>
                        <span
                          className="text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full"
                          style={{ background: '#EDE9FE', color: '#5B21B6' }}
                        >
                          {isPast ? 'Completed' : 'Upcoming'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-[#2A2035]/60">
                        <span>📅 {dateStr}</span>
                        {lesson.start_time && <span>🕐 {lesson.start_time}–{lesson.end_time}</span>}
                        {lesson.room && <span>📍 {lesson.room}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
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
